import type { ImpressionCanvas } from "./wasm/impression_core";
import type { GPUContext } from "./gpu";
import {
  uploadLayerTexture,
  createLayerTexture,
  createGradientLayerTexture,
  createWetMediaLayerTexture,
  uploadGradientTexture,
  updateLayerOpacity,
  updateLayerBlendMode,
  removeLayerTexture,
  removeWetMediaLayer,
  clearWetMediaTextures,
  dispatchWetMediaDeposit,
  setWetMediaHasWetPaint,
  setWetMediaMediumType,
  stepWetMediaSimulation,
  hasAnyWetPaint,
  getWetMediaLayerIndices,
  uploadSelectionTexture,
  clearSelectionTexture,
} from "./gpu";
import type { Storage, DocumentMeta } from "./storage";
import type { SerializableBrushSettings } from "./hooks/useBrushSettings";

export interface PersistenceOptions {
  storage: Storage;
  documentMeta: DocumentMeta;
}

export class Engine {
  private canvas: ImpressionCanvas;
  private gpu: GPUContext;
  private wasmMemory: WebAssembly.Memory;
  private activeLayer: number = 0;
  private needsRender: boolean = true;
  private _canvasVisible: boolean = true;

  private storage: Storage | null = null;
  private documentMeta: DocumentMeta | null = null;
  private nextSequence: number = 0;
  /** True when there are unflushed operations in the oplog. */
  private _dirty: boolean = false;
  /** Called after syncAllLayers so consumers can re-read layer state. */
  private _onLayersChanged?: () => void;
  /** Simulation frames elapsed per wet media layer since last stroke, for deterministic replay. */
  private wetMediaSimFrames: Map<number, number> = new Map();

  constructor(
    canvas: ImpressionCanvas,
    gpu: GPUContext,
    wasmMemory: WebAssembly.Memory,
  ) {
    this.canvas = canvas;
    this.gpu = gpu;
    this.wasmMemory = wasmMemory;
  }

  /** Register a callback fired whenever layer state changes (undo, redo, loadChunk). */
  setOnLayersChanged(cb: () => void): void {
    this._onLayersChanged = cb;
  }

  enablePersistence(opts: PersistenceOptions & { startSequence?: number }): void {
    this.storage = opts.storage;
    this.documentMeta = opts.documentMeta;
    this.nextSequence = opts.startSequence ?? 0;
  }

  /** Whether there are unflushed operations that would be lost on tab close. */
  get dirty(): boolean {
    return this._dirty;
  }

  getActiveLayer(): number {
    return this.activeLayer;
  }

  setActiveLayer(index: number): void {
    this.activeLayer = index;
  }

  addLayer(): number {
    const layerIndex = this.canvas.add_layer();
    createLayerTexture(this.gpu, this.canvas.width(), this.canvas.height());
    this._dirty = true;
    this.flushAll();
    return layerIndex;
  }

  removeLayer(index: number): boolean {
    const isWet = this.isWetMediaLayer(index);
    const removed = this.canvas.remove_layer(index);
    if (removed) {
      if (isWet) removeWetMediaLayer(index);
      removeLayerTexture(this.gpu, index);
      if (this.activeLayer >= this.canvas.layer_count()) {
        this.activeLayer = Math.max(0, this.canvas.layer_count() - 1);
      }
      this.needsRender = true;
      this._dirty = true;
      this.flushAll();
    }
    return removed;
  }

  // Adjustment layer methods

  addGradientMapLayer(gradientId: string): number {
    const layerIndex = this.canvas.add_adjustment_layer(0, gradientId);
    createGradientLayerTexture(this.gpu);
    this.needsRender = true;
    this._dirty = true;
    this.flushAll();
    return layerIndex;
  }

  addWetMediaLayer(): number {
    const layerIndex = this.canvas.add_wet_media_layer();
    createWetMediaLayerTexture(this.gpu, this.canvas.width(), this.canvas.height());
    this.needsRender = true;
    this._dirty = true;
    this.flushAll();
    return layerIndex;
  }

  isWetMediaLayer(layer: number): boolean {
    return this.canvas.layer_kind(layer) === 2;
  }

  isAdjustmentLayer(layer: number): boolean {
    return this.canvas.is_adjustment_layer(layer);
  }

  /** Layer kind: 0 = Raster, 1 = GradientMap, 2 = WetMedia */
  getLayerKind(layer: number): number {
    return this.canvas.layer_kind(layer);
  }

  getGradientMapGradientId(layer: number): string | undefined {
    return this.canvas.gradient_map_gradient_id(layer);
  }

  setGradientMapGradient(layer: number, gradientId: string): void {
    this.canvas.set_gradient_map_gradient(layer, gradientId);
    this.needsRender = true;
    this._dirty = true;
    this.flushAll();
  }

  /** Upload rasterized gradient data (256×1 RGBA) for an adjustment layer. */
  uploadGradientData(layer: number, data: Uint8Array): void {
    uploadGradientTexture(this.gpu, layer, data);
    this.needsRender = true;
  }

  /** Send all brush settings to WASM and begin a stroke.
   *  Settings are recorded in the oplog automatically by stroke_begin. */
  strokeBegin(layer: number, x: number, y: number, pressure: number, settings: SerializableBrushSettings): void {
    this.canvas.set_all_brush_settings(settings);
    // Record accumulated simulation frames before starting a new wet media stroke
    if (settings.brush_model === "WetMedia" && this.isWetMediaLayer(layer)) {
      this.recordSimFrames(layer);
      setWetMediaMediumType(layer, settings.wet_media.medium_type);
    }
    this.canvas.stroke_begin(layer, x, y, pressure);
    this._dirty = true;
    if (settings.brush_model === "WetMedia" && this.isWetMediaLayer(layer)) {
      this.dispatchWetMediaFootprints(layer);
    } else {
      this.syncLayer(layer);
    }
  }

  strokeMove(layer: number, x: number, y: number, pressure: number): void {
    this.canvas.stroke_move(layer, x, y, pressure);
    this._dirty = true;
    if (this.isWetMediaLayer(layer)) {
      this.dispatchWetMediaFootprints(layer);
    } else {
      this.syncLayer(layer);
    }
  }

  strokeEnd(): void {
    this.canvas.stroke_end();
    this.flushAll();
  }

  /** Read wet media footprints from WASM and dispatch GPU deposit for each. */
  private dispatchWetMediaFootprints(layer: number): void {
    const count = this.canvas.wet_media_footprint_count();
    if (count === 0) return;

    const canvasWidth = this.canvas.width();
    const canvasHeight = this.canvas.height();

    for (let i = 0; i < count; i++) {
      const maskPtr = this.canvas.wet_media_footprint_mask_ptr(i);
      const maskLen = this.canvas.wet_media_footprint_mask_len(i);
      if (maskLen === 0) continue;

      // Read mask from WASM memory (f32 array)
      const maskData = new Float32Array(this.wasmMemory.buffer, maskPtr, maskLen);

      // Read params (flat array of 13 f32s)
      const paramsArray = this.canvas.wet_media_footprint_params(i) as number[];
      if (!paramsArray || paramsArray.length < 15) continue;

      dispatchWetMediaDeposit(this.gpu, layer, maskData, {
        originX: paramsArray[0],
        originY: paramsArray[1],
        paintR: paramsArray[2],
        paintG: paramsArray[3],
        paintB: paramsArray[4],
        paintLoad: paramsArray[5],
        velocityX: paramsArray[6],
        velocityY: paramsArray[7],
        mixingStrength: paramsArray[8],
        paintThickness: paramsArray[9],
        wetness: paramsArray[10],
        maskWidth: paramsArray[11],
        maskHeight: paramsArray[12],
        canvasWidth,
        canvasHeight,
        canvasTextureStrength: paramsArray[13],
        viscosity: paramsArray[14],
      });
    }

    this.canvas.wet_media_clear_footprints();
    setWetMediaHasWetPaint(layer, true);
    this.needsRender = true;
  }

  /** Record accumulated simulation frame count for a wet media layer into the oplog.
   *  Called before starting a new stroke so replay can reproduce the simulation. */
  private recordSimFrames(layer: number): void {
    const frames = this.wetMediaSimFrames.get(layer) ?? 0;
    if (frames === 0) return;
    // layer_id returns f64 from WASM (since JS doesn't have u64)
    const layerId = this.canvas.layer_id(layer);
    const hi = Math.floor(layerId / 0x100000000) >>> 0;
    const lo = (layerId % 0x100000000) >>> 0;
    this.canvas.record_wet_media_sim_step(hi, lo, frames);
    this.wetMediaSimFrames.set(layer, 0);
  }

  /** Run per-frame simulation for all wet media layers.
   *  Called from the render loop when wet paint exists. */
  stepWetMediaSimulation(): void {
    if (!hasAnyWetPaint()) return;
    const w = this.canvas.width();
    const h = this.canvas.height();
    for (const idx of getWetMediaLayerIndices()) {
      stepWetMediaSimulation(this.gpu, idx, w, h);
      // Track frames for deterministic replay
      this.wetMediaSimFrames.set(idx, (this.wetMediaSimFrames.get(idx) ?? 0) + 1);
    }
    this.needsRender = true;
  }

  private syncLayer(layer: number): void {
    if (!this.canvas.is_layer_dirty(layer)) return;
    if (this.canvas.is_adjustment_layer(layer) || this.isWetMediaLayer(layer)) {
      this.canvas.clear_layer_dirty(layer);
      this.needsRender = true;
      return;
    }

    const ptr = this.canvas.layer_pixels_ptr(layer);
    const len = this.canvas.layer_pixels_len(layer);
    // Re-create the view each time since WASM memory can grow
    const pixels = new Uint8Array(this.wasmMemory.buffer, ptr, len);
    const width = this.canvas.width();
    const height = this.canvas.height();

    // Read dirty bounds for partial texture upload
    const dx = this.canvas.layer_dirty_x(layer);
    const dy = this.canvas.layer_dirty_y(layer);
    const dw = this.canvas.layer_dirty_width(layer);
    const dh = this.canvas.layer_dirty_height(layer);

    if (dw > 0 && dh > 0 && (dw < width || dh < height)) {
      uploadLayerTexture(this.gpu, layer, pixels, width, height, {
        x: dx, y: dy, w: dw, h: dh,
      });
    } else {
      uploadLayerTexture(this.gpu, layer, pixels, width, height);
    }

    updateLayerOpacity(this.gpu, layer, this.canvas.layer_opacity(layer));
    this.canvas.clear_layer_dirty(layer);
    this.needsRender = true;
  }

  getCanvasVisible(): boolean {
    return this._canvasVisible;
  }

  setCanvasVisible(visible: boolean): void {
    this._canvasVisible = visible;
    this.canvas.set_canvas_visible(visible);
    this.needsRender = true;
  }

  getBackgroundColor(): [number, number, number] {
    return [
      this.canvas.background_r(),
      this.canvas.background_g(),
      this.canvas.background_b(),
    ];
  }

  getLayerCount(): number {
    return this.canvas.layer_count();
  }

  consumeNeedsRender(): boolean {
    const val = this.needsRender;
    this.needsRender = false;
    return val;
  }

  // Brush settings

  /** Register a custom brush tip image in the WASM tip registry.
   *  This is separate from brush settings — tip pixel data must be
   *  registered before a stroke references the tip ID. */
  registerBrushTip(id: string, pixels: Uint8Array, width: number, height: number): void {
    this.canvas.register_brush_tip(id, pixels, width, height);
  }

  setBackgroundColor(r: number, g: number, b: number): void {
    this.canvas.set_background_color(r, g, b);
  }

  setLayerOpacity(layer: number, opacity: number): void {
    this.canvas.set_layer_opacity(layer, opacity);
    updateLayerOpacity(this.gpu, layer, opacity);
    this.needsRender = true;
    this._dirty = true;
    this.flushAll();
  }

  getLayerOpacity(layer: number): number {
    return this.canvas.layer_opacity(layer);
  }

  getLayerBlendMode(layer: number): number {
    return this.canvas.layer_blend_mode(layer);
  }

  setLayerBlendMode(layer: number, mode: number): void {
    this.canvas.set_layer_blend_mode(layer, mode);
    updateLayerBlendMode(this.gpu, layer, mode);
    this.needsRender = true;
    this._dirty = true;
    this.flushAll();
  }

  getLayerVisible(layer: number): boolean {
    return this.canvas.layer_visible(layer);
  }

  getLayerName(layer: number): string {
    return this.canvas.layer_name(layer);
  }

  renameLayer(layer: number, name: string): void {
    this.canvas.rename_layer(layer, name);
    this._dirty = true;
    this.flushAll();
  }

  setLayerVisible(layer: number, visible: boolean): void {
    this.canvas.set_layer_visible(layer, visible);
    this.needsRender = true;
    this._dirty = true;
    this.flushAll();
  }

  moveLayer(fromIndex: number, toIndex: number): void {
    this.canvas.move_layer(fromIndex, toIndex);
    this.syncAllLayers();
    this._dirty = true;
    this.flushAll();
  }

  // Selection methods

  selectionRect(x: number, y: number, w: number, h: number, mode: number): void {
    this.canvas.selection_rect(x, y, w, h, mode);
    this.syncSelection();
  }

  selectionLassoBegin(): void {
    this.canvas.selection_lasso_begin();
  }

  selectionLassoPoint(x: number, y: number): void {
    this.canvas.selection_lasso_point(x, y);
  }

  selectionLassoEnd(mode: number): void {
    this.canvas.selection_lasso_end(mode);
    this.syncSelection();
  }

  selectAll(): void {
    this.canvas.select_all();
    this.syncSelection();
  }

  deselect(): void {
    this.canvas.deselect();
    clearSelectionTexture(this.gpu);
    this.needsRender = true;
  }

  hasSelection(): boolean {
    return this.canvas.has_selection();
  }

  private syncSelection(): void {
    if (!this.canvas.is_selection_dirty()) return;

    const ptr = this.canvas.selection_mask_ptr();
    const len = this.canvas.selection_mask_len();
    if (len === 0) return;

    const pixels = new Uint8Array(this.wasmMemory.buffer, ptr, len);
    const width = this.canvas.width();
    const height = this.canvas.height();

    uploadSelectionTexture(this.gpu, pixels, width, height);
    this.canvas.clear_selection_dirty();
    this.needsRender = true;
  }

  /** Clear the selected region on the active layer, or the whole layer if no selection. */
  clearActiveLayer(layer: number): void {
    this.canvas.clear_layer(layer);
    this.syncLayer(layer);
  }

  // Undo/redo

  canUndo(): boolean {
    return this.canvas.can_undo();
  }

  canRedo(): boolean {
    return this.canvas.can_redo();
  }

  activeOperationCount(): number {
    return this.canvas.active_operation_count();
  }

  undo(): boolean {
    const result = this.canvas.undo();
    if (result) {
      this.replayWetMediaEvents();
      this.syncAllLayers();
    }
    return result;
  }

  redo(): boolean {
    const result = this.canvas.redo();
    if (result) {
      this.replayWetMediaEvents();
      this.syncAllLayers();
    }
    return result;
  }

  /** After undo/redo, replay wet media GPU operations (deposits + sim steps)
   *  that were accumulated during Rust's replay_active. */
  private replayWetMediaEvents(): void {
    const eventCount = this.canvas.wet_media_replay_event_count();
    if (eventCount === 0) return;

    const canvasWidth = this.canvas.width();
    const canvasHeight = this.canvas.height();

    // Clear all wet media GPU textures before replaying
    for (const idx of getWetMediaLayerIndices()) {
      clearWetMediaTextures(this.gpu, idx);
    }

    // Replay events in order
    for (let i = 0; i < eventCount; i++) {
      const eventType = this.canvas.wet_media_replay_event_type(i);

      if (eventType === 0) {
        // Deposit event
        const layerIdx = this.canvas.wet_media_replay_deposit_layer(i);
        if (layerIdx === 0xFFFFFFFF) continue;

        const maskPtr = this.canvas.wet_media_replay_deposit_mask_ptr(i);
        const maskLen = this.canvas.wet_media_replay_deposit_mask_len(i);
        if (maskLen === 0) continue;

        const maskData = new Float32Array(this.wasmMemory.buffer, maskPtr, maskLen);
        const paramsArray = this.canvas.wet_media_replay_deposit_params(i) as number[];
        if (!paramsArray || paramsArray.length < 15) continue;

        dispatchWetMediaDeposit(this.gpu, layerIdx, maskData, {
          originX: paramsArray[0],
          originY: paramsArray[1],
          paintR: paramsArray[2],
          paintG: paramsArray[3],
          paintB: paramsArray[4],
          paintLoad: paramsArray[5],
          velocityX: paramsArray[6],
          velocityY: paramsArray[7],
          mixingStrength: paramsArray[8],
          paintThickness: paramsArray[9],
          wetness: paramsArray[10],
          maskWidth: paramsArray[11],
          maskHeight: paramsArray[12],
          canvasWidth,
          canvasHeight,
          canvasTextureStrength: paramsArray[13],
          viscosity: paramsArray[14],
        });
        setWetMediaHasWetPaint(layerIdx, true);
      } else if (eventType === 1) {
        // SimStep event
        const params = this.canvas.wet_media_replay_sim_step_params(i) as number[];
        if (!params || params.length < 2) continue;
        const layerIdx = params[0];
        const frames = params[1];
        if (layerIdx === 0xFFFFFFFF) continue;

        for (let f = 0; f < frames; f++) {
          stepWetMediaSimulation(this.gpu, layerIdx, canvasWidth, canvasHeight);
        }
      }
    }

    // Clear replay events and reset sim frame counters
    this.canvas.wet_media_clear_replay_events();
    this.wetMediaSimFrames.clear();
  }

  /** Re-upload layer textures after replay, skipping unchanged layers. */
  private syncAllLayers(): void {
    const count = this.canvas.layer_count();
    const width = this.canvas.width();
    const height = this.canvas.height();

    // Ensure GPU has the right number of layer texture slots
    while (this.gpu.layerTextures.length > count) {
      removeLayerTexture(this.gpu, this.gpu.layerTextures.length - 1);
    }
    while (this.gpu.layerTextures.length < count) {
      const idx = this.gpu.layerTextures.length;
      const kind = this.canvas.layer_kind(idx);
      if (kind === 1) {
        createGradientLayerTexture(this.gpu);
      } else if (kind === 2) {
        createWetMediaLayerTexture(this.gpu, width, height);
      } else {
        createLayerTexture(this.gpu, width, height);
      }
    }

    for (let i = 0; i < count; i++) {
      const kind = this.canvas.layer_kind(i);
      if (kind === 1 /* GradientMap */ || kind === 2 /* WetMedia */) {
        // Non-raster layers: sync opacity/blend, skip pixel upload
        updateLayerOpacity(this.gpu, i, this.canvas.layer_opacity(i));
        updateLayerBlendMode(this.gpu, i, this.canvas.layer_blend_mode(i));
        this.canvas.clear_layer_dirty(i);
        continue;
      }

      if (this.canvas.is_layer_dirty(i)) {
        const ptr = this.canvas.layer_pixels_ptr(i);
        const len = this.canvas.layer_pixels_len(i);
        const pixels = new Uint8Array(this.wasmMemory.buffer, ptr, len);
        uploadLayerTexture(this.gpu, i, pixels, width, height);
        this.canvas.clear_layer_dirty(i);
      }
      // Always sync opacity and blend mode (cheap uniform updates)
      updateLayerOpacity(this.gpu, i, this.canvas.layer_opacity(i));
      updateLayerBlendMode(this.gpu, i, this.canvas.layer_blend_mode(i));
    }

    this.needsRender = true;
    this._onLayersChanged?.();
  }

  // Persistence

  pendingOperationCount(): number {
    return this.canvas.pending_operation_count();
  }

  async flushAll(): Promise<void> {
    if (!this.storage || !this.documentMeta) return;
    if (this.canvas.pending_operation_count() === 0) return;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.storage || !this.documentMeta) return;
    const len = this.canvas.flush_pending_operations();
    if (len === 0) return;

    const ptr = this.canvas.flush_data_ptr();
    const data = new Uint8Array(this.wasmMemory.buffer, ptr, len).slice();
    await this.storage.appendOpLogEntry(
      this.documentMeta.id,
      this.nextSequence++,
      data,
    );
    this.documentMeta.modified_at = Date.now();
    await this.storage.updateDocument(this.documentMeta);
    this._dirty = false;
  }

  /** Embed a document resource (brush tip or gradient) if not already saved. */
  async embedResource(
    resourceType: "brush-tip" | "gradient",
    resourceId: string,
    data: unknown,
  ): Promise<void> {
    if (!this.storage || !this.documentMeta) return;
    const existing = await this.storage.getDocumentResource(
      this.documentMeta.id,
      resourceType,
      resourceId,
    );
    if (existing) return;
    await this.storage.saveDocumentResource({
      document_id: this.documentMeta.id,
      resource_type: resourceType,
      resource_id: resourceId,
      data,
    });
  }

  /** Load a serialized chunk of operations into the canvas. */
  loadChunk(data: Uint8Array): boolean {
    const result = this.canvas.load_chunk(data);
    if (result) {
      this.syncAllLayers();
      // Replay wet media GPU deposits accumulated during load_chunk
      this.replayWetMediaEvents();
    }
    return result;
  }

  sampleColor(x: number, y: number): [number, number, number] {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    return [
      this.canvas.sample_color_r(ix, iy),
      this.canvas.sample_color_g(ix, iy),
      this.canvas.sample_color_b(ix, iy),
    ];
  }
}
