import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock WebGPU globals not available in happy-dom
(globalThis as any).GPUTextureUsage = {
  TEXTURE_BINDING: 0x04,
  COPY_DST: 0x08,
  RENDER_ATTACHMENT: 0x10,
};
(globalThis as any).GPUShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
};
(globalThis as any).GPUBufferUsage = {
  UNIFORM: 0x0040,
  COPY_DST: 0x0008,
};

import { Engine } from "../engine";

function createMockCanvas() {
  return {
    add_layer: vi.fn().mockReturnValue(0),
    width: vi.fn().mockReturnValue(100),
    height: vi.fn().mockReturnValue(100),
    layer_pixels_ptr: vi.fn().mockReturnValue(0),
    layer_pixels_len: vi.fn().mockReturnValue(40000),
    is_layer_dirty: vi.fn().mockReturnValue(true),
    clear_layer_dirty: vi.fn(),
    layer_count: vi.fn().mockReturnValue(1),
    layer_opacity: vi.fn().mockReturnValue(1.0),
    background_r: vi.fn().mockReturnValue(255),
    background_g: vi.fn().mockReturnValue(255),
    background_b: vi.fn().mockReturnValue(255),
    stroke_begin: vi.fn(),
    stroke_move: vi.fn(),
    stroke_end: vi.fn(),
    set_brush_size: vi.fn(),
    set_brush_spacing: vi.fn(),
    set_brush_color: vi.fn(),
    set_brush_opacity: vi.fn(),
    set_brush_flow: vi.fn(),
    set_background_color: vi.fn(),
    remove_layer: vi.fn().mockReturnValue(true),
  };
}

function createMockGPU() {
  const mockTexture = {
    createView: vi.fn().mockReturnValue({}),
    destroy: vi.fn(),
  };
  return {
    device: {
      createTexture: vi.fn().mockReturnValue(mockTexture),
      createBuffer: vi.fn().mockReturnValue({ size: 4, destroy: vi.fn() }),
      createBindGroup: vi.fn().mockReturnValue({}),
      queue: {
        writeTexture: vi.fn(),
        writeBuffer: vi.fn(),
      },
    },
    sampler: {},
    bindGroupLayout: {},
    layerTextures: [] as unknown[],
    layerBindGroups: [] as unknown[],
    opacityBuffers: [] as unknown[],
  };
}

describe("Engine", () => {
  let engine: Engine;
  let mockCanvas: ReturnType<typeof createMockCanvas>;
  let mockGPU: ReturnType<typeof createMockGPU>;
  let mockMemory: WebAssembly.Memory;

  beforeEach(() => {
    mockCanvas = createMockCanvas();
    mockGPU = createMockGPU();
    mockMemory = new WebAssembly.Memory({ initial: 1 });
    engine = new Engine(
      mockCanvas as never,
      mockGPU as never,
      mockMemory,
    );
  });

  it("should forward strokeBegin to canvas", () => {
    // Need to add a layer first so syncLayer has a texture to upload to
    engine.addLayer();
    engine.strokeBegin(0, 10, 20, 0.8);
    expect(mockCanvas.stroke_begin).toHaveBeenCalledWith(0, 10, 20, 0.8);
  });

  it("should forward strokeMove to canvas", () => {
    engine.addLayer();
    engine.strokeMove(0, 30, 40, 0.5);
    expect(mockCanvas.stroke_move).toHaveBeenCalledWith(0, 30, 40, 0.5);
  });

  it("should forward strokeEnd to canvas", () => {
    engine.strokeEnd();
    expect(mockCanvas.stroke_end).toHaveBeenCalled();
  });

  it("should sync dirty layers to GPU", () => {
    engine.addLayer();
    mockCanvas.is_layer_dirty.mockReturnValue(true);
    engine.strokeBegin(0, 10, 20, 1.0);
    expect(mockCanvas.clear_layer_dirty).toHaveBeenCalledWith(0);
  });

  it("should not sync clean layers", () => {
    engine.addLayer();
    mockCanvas.is_layer_dirty.mockReturnValue(false);
    engine.strokeMove(0, 10, 20, 1.0);
    expect(mockCanvas.clear_layer_dirty).not.toHaveBeenCalled();
  });

  it("should return background color", () => {
    expect(engine.getBackgroundColor()).toEqual([255, 255, 255]);
  });

  it("should forward brush settings", () => {
    engine.setBrushSize(30);
    expect(mockCanvas.set_brush_size).toHaveBeenCalledWith(30);

    engine.setBrushColor(255, 0, 0);
    expect(mockCanvas.set_brush_color).toHaveBeenCalledWith(255, 0, 0);

    engine.setBrushOpacity(0.5);
    expect(mockCanvas.set_brush_opacity).toHaveBeenCalledWith(0.5);

    engine.setBrushFlow(0.3);
    expect(mockCanvas.set_brush_flow).toHaveBeenCalledWith(0.3);
  });

  it("should track active layer", () => {
    expect(engine.getActiveLayer()).toBe(0);
    engine.setActiveLayer(2);
    expect(engine.getActiveLayer()).toBe(2);
  });

  it("should remove a layer", () => {
    engine.addLayer();
    engine.addLayer();
    mockCanvas.remove_layer = vi.fn().mockReturnValue(true);
    mockCanvas.layer_count.mockReturnValue(1);

    const result = engine.removeLayer(0);
    expect(result).toBe(true);
    expect(mockCanvas.remove_layer).toHaveBeenCalledWith(0);
  });

  it("should adjust active layer index on removal", () => {
    engine.addLayer();
    engine.addLayer();
    engine.setActiveLayer(2);
    mockCanvas.remove_layer = vi.fn().mockReturnValue(true);
    mockCanvas.layer_count.mockReturnValue(1);

    engine.removeLayer(2);
    expect(engine.getActiveLayer()).toBeLessThanOrEqual(1);
  });

  it("should set layer opacity on WASM and GPU", () => {
    engine.addLayer();
    mockCanvas.set_layer_opacity = vi.fn();

    engine.setLayerOpacity(0, 0.5);

    expect(mockCanvas.set_layer_opacity).toHaveBeenCalledWith(0, 0.5);
    // Should write opacity to the GPU buffer
    expect(mockGPU.device.queue.writeBuffer).toHaveBeenCalled();
  });
});
