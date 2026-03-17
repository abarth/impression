import type { ImpressionCanvas } from "./wasm/impression_core";
import type { GPUContext } from "./gpu";
import {
  uploadLayerTexture,
  createLayerTexture,
  updateLayerOpacity,
  updateLayerBlendMode,
  removeLayerTexture,
  uploadSelectionTexture,
  clearSelectionTexture,
} from "./gpu";
import type { Storage, DocumentMeta } from "./storage";

export interface PersistenceOptions {
  storage: Storage;
  documentMeta: DocumentMeta;
  batchSize?: number;
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
  private nextChunkIndex: number = 0;
  private batchSize: number = 1000;

  constructor(
    canvas: ImpressionCanvas,
    gpu: GPUContext,
    wasmMemory: WebAssembly.Memory,
  ) {
    this.canvas = canvas;
    this.gpu = gpu;
    this.wasmMemory = wasmMemory;
  }

  enablePersistence(opts: PersistenceOptions & { startChunkIndex?: number }): void {
    this.storage = opts.storage;
    this.documentMeta = opts.documentMeta;
    this.batchSize = opts.batchSize ?? 1000;
    this.nextChunkIndex = opts.startChunkIndex ?? 0;
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
    return layerIndex;
  }

  removeLayer(index: number): boolean {
    const removed = this.canvas.remove_layer(index);
    if (removed) {
      removeLayerTexture(this.gpu, index);
      if (this.activeLayer >= this.canvas.layer_count()) {
        this.activeLayer = Math.max(0, this.canvas.layer_count() - 1);
      }
      this.needsRender = true;
    }
    return removed;
  }

  strokeBegin(layer: number, x: number, y: number, pressure: number): void {
    this.canvas.stroke_begin(layer, x, y, pressure);
    this.syncLayer(layer);
  }

  strokeMove(layer: number, x: number, y: number, pressure: number): void {
    this.canvas.stroke_move(layer, x, y, pressure);
    this.syncLayer(layer);
  }

  strokeEnd(): void {
    this.canvas.stroke_end();
    this.flushAll();
  }

  private syncLayer(layer: number): void {
    if (!this.canvas.is_layer_dirty(layer)) return;

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

    if (dw > 0 && dh > 0 && dw < width && dh < height) {
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
  setBrushSize(size: number): void {
    this.canvas.set_brush_size(size);
  }

  setBrushSpacing(spacing: number): void {
    this.canvas.set_brush_spacing(spacing);
  }

  setBrushColor(r: number, g: number, b: number): void {
    this.canvas.set_brush_color(r, g, b);
  }

  setBrushOpacity(opacity: number): void {
    this.canvas.set_brush_opacity(opacity);
  }

  setBrushFlow(flow: number): void {
    this.canvas.set_brush_flow(flow);
  }

  setBrushBlendMode(mode: number): void {
    this.canvas.set_brush_blend_mode(mode);
  }

  setBackgroundColor(r: number, g: number, b: number): void {
    this.canvas.set_background_color(r, g, b);
  }

  setLayerOpacity(layer: number, opacity: number): void {
    this.canvas.set_layer_opacity(layer, opacity);
    updateLayerOpacity(this.gpu, layer, opacity);
    this.needsRender = true;
  }

  getLayerBlendMode(layer: number): number {
    return this.canvas.layer_blend_mode(layer);
  }

  setLayerBlendMode(layer: number, mode: number): void {
    this.canvas.set_layer_blend_mode(layer, mode);
    updateLayerBlendMode(this.gpu, layer, mode);
    this.needsRender = true;
  }

  getLayerVisible(layer: number): boolean {
    return this.canvas.layer_visible(layer);
  }

  setLayerVisible(layer: number, visible: boolean): void {
    this.canvas.set_layer_visible(layer, visible);
    this.needsRender = true;
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
    if (result) this.syncAllLayers();
    return result;
  }

  redo(): boolean {
    const result = this.canvas.redo();
    if (result) this.syncAllLayers();
    return result;
  }

  /** Re-upload all layer textures after replay. */
  private syncAllLayers(): void {
    const count = this.canvas.layer_count();
    const width = this.canvas.width();
    const height = this.canvas.height();

    // Ensure GPU has enough layer textures
    while (this.gpu.layerTextures.length > count) {
      removeLayerTexture(this.gpu, this.gpu.layerTextures.length - 1);
    }
    while (this.gpu.layerTextures.length < count) {
      createLayerTexture(this.gpu, width, height);
    }

    // Upload each layer
    for (let i = 0; i < count; i++) {
      const ptr = this.canvas.layer_pixels_ptr(i);
      const len = this.canvas.layer_pixels_len(i);
      const pixels = new Uint8Array(this.wasmMemory.buffer, ptr, len);
      uploadLayerTexture(this.gpu, i, pixels, width, height);
      updateLayerOpacity(this.gpu, i, this.canvas.layer_opacity(i));
      updateLayerBlendMode(this.gpu, i, this.canvas.layer_blend_mode(i));
      this.canvas.clear_layer_dirty(i);
    }

    this.needsRender = true;
  }

  // Persistence

  pendingOperationCount(): number {
    return this.canvas.pending_operation_count();
  }

  async maybeFlush(): Promise<void> {
    if (!this.storage || !this.documentMeta) return;
    if (this.canvas.pending_operation_count() < this.batchSize) return;
    await this.flush();
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
    await this.storage.appendChunk(
      this.documentMeta.id,
      this.nextChunkIndex++,
      data,
    );
    this.documentMeta.modified_at = Date.now();
    await this.storage.updateDocument(this.documentMeta);
  }

  /** Load a serialized chunk of operations into the canvas. */
  loadChunk(data: Uint8Array): boolean {
    const result = this.canvas.load_chunk(data);
    if (result) {
      this.syncAllLayers();
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
