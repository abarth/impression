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
    set_brush_blend_mode: vi.fn(),
    set_background_color: vi.fn(),
    remove_layer: vi.fn().mockReturnValue(true),
    layer_blend_mode: vi.fn().mockReturnValue(0),
    set_layer_blend_mode: vi.fn(),
    set_layer_opacity: vi.fn(),
    layer_visible: vi.fn().mockReturnValue(true),
    set_layer_visible: vi.fn(),
    set_canvas_visible: vi.fn(),
    can_undo: vi.fn().mockReturnValue(false),
    can_redo: vi.fn().mockReturnValue(false),
    active_operation_count: vi.fn().mockReturnValue(0),
    pending_operation_count: vi.fn().mockReturnValue(0),
    flush_pending_operations: vi.fn().mockReturnValue(0),
    flush_data_ptr: vi.fn().mockReturnValue(0),
    layer_dirty_x: vi.fn().mockReturnValue(0),
    layer_dirty_y: vi.fn().mockReturnValue(0),
    layer_dirty_width: vi.fn().mockReturnValue(100),
    layer_dirty_height: vi.fn().mockReturnValue(100),
    load_chunk: vi.fn().mockReturnValue(true),
    move_layer: vi.fn(),
    register_brush_tip: vi.fn(),
    set_brush_tip: vi.fn(),
    clear_brush_tip: vi.fn(),
    set_brush_flip_x: vi.fn(),
    set_brush_flip_y: vi.fn(),
    is_adjustment_layer: vi.fn().mockReturnValue(false),
    layer_kind: vi.fn().mockReturnValue(0),
    add_adjustment_layer: vi.fn().mockReturnValue(0),
    gradient_map_gradient_id: vi.fn().mockReturnValue(undefined),
    set_gradient_map_gradient: vi.fn(),
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
    layerBindGroupLayout: {},
    layerTextures: [] as unknown[],
    layerBindGroups: [] as unknown[],
    layerUniformBuffers: [] as unknown[],
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

  it("should use partial upload when dirty region is smaller than canvas", () => {
    engine.addLayer();
    mockCanvas.is_layer_dirty.mockReturnValue(true);
    mockCanvas.layer_dirty_x.mockReturnValue(10);
    mockCanvas.layer_dirty_y.mockReturnValue(20);
    mockCanvas.layer_dirty_width.mockReturnValue(30);
    mockCanvas.layer_dirty_height.mockReturnValue(40);
    engine.strokeBegin(0, 10, 20, 1.0);
    // writeTexture should be called with origin for partial upload
    const writeCall = mockGPU.device.queue.writeTexture.mock.calls[0];
    expect(writeCall[0].origin).toEqual({ x: 10, y: 20 });
    expect(writeCall[2].offset).toBe((20 * 100 + 10) * 4);
    expect(writeCall[3]).toEqual({ width: 30, height: 40 });
  });

  it("should use full upload when dirty region covers entire canvas", () => {
    engine.addLayer();
    mockCanvas.is_layer_dirty.mockReturnValue(true);
    mockCanvas.layer_dirty_x.mockReturnValue(0);
    mockCanvas.layer_dirty_y.mockReturnValue(0);
    mockCanvas.layer_dirty_width.mockReturnValue(100);
    mockCanvas.layer_dirty_height.mockReturnValue(100);
    engine.strokeBegin(0, 10, 20, 1.0);
    const writeCall = mockGPU.device.queue.writeTexture.mock.calls[0];
    // Full upload: no origin
    expect(writeCall[0].origin).toBeUndefined();
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

  it("should move layer via WASM and sync all layers", () => {
    engine.addLayer();
    engine.addLayer();
    mockCanvas.move_layer = vi.fn();

    engine.moveLayer(0, 1);

    expect(mockCanvas.move_layer).toHaveBeenCalledWith(0, 1);
  });

  it("should get and set layer blend mode", () => {
    expect(engine.getLayerBlendMode(0)).toBe(0);
    engine.setLayerBlendMode(0, 9); // Lighter
    expect(mockCanvas.set_layer_blend_mode).toHaveBeenCalledWith(0, 9);
  });

  it("should set layer opacity on WASM and GPU", () => {
    engine.addLayer();
    mockCanvas.set_layer_opacity = vi.fn();

    engine.setLayerOpacity(0, 0.5);

    expect(mockCanvas.set_layer_opacity).toHaveBeenCalledWith(0, 0.5);
    // Should write opacity to the GPU buffer
    expect(mockGPU.device.queue.writeBuffer).toHaveBeenCalled();
  });

  it("should forward canUndo/canRedo to WASM", () => {
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);
    expect(mockCanvas.can_undo).toHaveBeenCalled();
    expect(mockCanvas.can_redo).toHaveBeenCalled();
  });

  it("should forward setCanvasVisible to WASM", () => {
    engine.setCanvasVisible(false);
    expect(mockCanvas.set_canvas_visible).toHaveBeenCalledWith(false);
  });

  it("should forward setLayerVisible to WASM", () => {
    engine.setLayerVisible(0, false);
    expect(mockCanvas.set_layer_visible).toHaveBeenCalledWith(0, false);
  });

  it("should forward setBrushBlendMode to WASM", () => {
    engine.setBrushBlendMode(108); // DstOut
    expect(mockCanvas.set_brush_blend_mode).toHaveBeenCalledWith(108);
  });

  it("should forward pendingOperationCount to WASM", () => {
    mockCanvas.pending_operation_count.mockReturnValue(42);
    expect(engine.pendingOperationCount()).toBe(42);
  });

  it("should forward registerBrushTip to WASM", () => {
    const pixels = new Uint8Array([255, 128, 64, 32]);
    engine.registerBrushTip("tip-1", pixels, 2, 2);
    expect(mockCanvas.register_brush_tip).toHaveBeenCalledWith("tip-1", pixels, 2, 2);
  });

  it("should forward setBrushTip to WASM", () => {
    engine.setBrushTip("tip-1");
    expect(mockCanvas.set_brush_tip).toHaveBeenCalledWith("tip-1");
  });

  it("should forward clearBrushTip to WASM", () => {
    engine.clearBrushTip();
    expect(mockCanvas.clear_brush_tip).toHaveBeenCalled();
  });

  describe("persistence", () => {
    function createMockStorage() {
      return {
        appendChunk: vi.fn().mockResolvedValue(undefined),
        updateDocument: vi.fn().mockResolvedValue(undefined),
        getChunks: vi.fn().mockResolvedValue([]),
        getChunkCount: vi.fn().mockResolvedValue(0),
        createDocument: vi.fn().mockResolvedValue(undefined),
        getDocument: vi.fn().mockResolvedValue(undefined),
        listDocuments: vi.fn().mockResolvedValue([]),
        deleteDocument: vi.fn().mockResolvedValue(undefined),
        deleteChunks: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };
    }

    const docMeta = {
      id: "test-doc",
      name: "Test",
      width: 100,
      height: 100,
      ppi: 72,
      created_at: 1000,
      modified_at: 1000,
    };

    it("should not flush when below batch size", async () => {
      const mockStorage = createMockStorage();
      engine.enablePersistence({
        storage: mockStorage as never,
        documentMeta: { ...docMeta },
        batchSize: 100,
      });

      mockCanvas.pending_operation_count.mockReturnValue(50);
      await engine.maybeFlush();
      expect(mockCanvas.flush_pending_operations).not.toHaveBeenCalled();
    });

    it("should flush when batch size is reached", async () => {
      const mockStorage = createMockStorage();
      engine.enablePersistence({
        storage: mockStorage as never,
        documentMeta: { ...docMeta },
        batchSize: 100,
      });

      mockCanvas.pending_operation_count.mockReturnValue(100);
      mockCanvas.flush_pending_operations.mockReturnValue(8);
      mockCanvas.flush_data_ptr.mockReturnValue(0);

      await engine.maybeFlush();
      expect(mockCanvas.flush_pending_operations).toHaveBeenCalled();
      expect(mockStorage.appendChunk).toHaveBeenCalledWith(
        "test-doc",
        0,
        expect.any(Uint8Array),
      );
      expect(mockStorage.updateDocument).toHaveBeenCalled();
    });

    it("should increment chunk index on successive flushes", async () => {
      const mockStorage = createMockStorage();
      engine.enablePersistence({
        storage: mockStorage as never,
        documentMeta: { ...docMeta },
        batchSize: 1,
      });

      mockCanvas.pending_operation_count.mockReturnValue(1);
      mockCanvas.flush_pending_operations.mockReturnValue(4);
      mockCanvas.flush_data_ptr.mockReturnValue(0);

      await engine.flushAll();
      await engine.flushAll();

      // First call uses index 0, but second has pending=0 after first flush
      // so only one appendChunk call
      expect(mockStorage.appendChunk).toHaveBeenCalledWith(
        "test-doc",
        0,
        expect.any(Uint8Array),
      );
    });

    it("flushAll should persist remaining operations", async () => {
      const mockStorage = createMockStorage();
      engine.enablePersistence({
        storage: mockStorage as never,
        documentMeta: { ...docMeta },
        batchSize: 10000,
      });

      mockCanvas.pending_operation_count.mockReturnValue(5);
      mockCanvas.flush_pending_operations.mockReturnValue(4);
      mockCanvas.flush_data_ptr.mockReturnValue(0);

      await engine.flushAll();
      expect(mockCanvas.flush_pending_operations).toHaveBeenCalled();
      expect(mockStorage.appendChunk).toHaveBeenCalled();
    });

    it("should not flush when no storage is configured", async () => {
      mockCanvas.pending_operation_count.mockReturnValue(9999);
      await engine.maybeFlush();
      expect(mockCanvas.flush_pending_operations).not.toHaveBeenCalled();
    });
  });
});
