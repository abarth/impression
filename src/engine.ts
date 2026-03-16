import type { ImpressionCanvas } from "./wasm/impression_core";
import type { GPUContext } from "./gpu";
import { uploadLayerTexture, createLayerTexture, updateLayerOpacity, removeLayerTexture } from "./gpu";

export class Engine {
  private canvas: ImpressionCanvas;
  private gpu: GPUContext;
  private wasmMemory: WebAssembly.Memory;
  private activeLayer: number = 0;
  private needsRender: boolean = true;

  constructor(
    canvas: ImpressionCanvas,
    gpu: GPUContext,
    wasmMemory: WebAssembly.Memory,
  ) {
    this.canvas = canvas;
    this.gpu = gpu;
    this.wasmMemory = wasmMemory;
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
  }

  private syncLayer(layer: number): void {
    if (!this.canvas.is_layer_dirty(layer)) return;

    const ptr = this.canvas.layer_pixels_ptr(layer);
    const len = this.canvas.layer_pixels_len(layer);
    // Re-create the view each time since WASM memory can grow
    const pixels = new Uint8Array(this.wasmMemory.buffer, ptr, len);
    const width = this.canvas.width();
    const height = this.canvas.height();

    uploadLayerTexture(this.gpu, layer, pixels, width, height);
    updateLayerOpacity(this.gpu, layer, this.canvas.layer_opacity(layer));
    this.canvas.clear_layer_dirty(layer);
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

  setBackgroundColor(r: number, g: number, b: number): void {
    this.canvas.set_background_color(r, g, b);
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
