import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerManager } from "../hooks/useLayerManager";

function createMockEngine(layers: Array<{
  name: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: number;
  kind?: number;
  gradientId?: string;
}>) {
  let _onLayersChanged: (() => void) | undefined;
  return {
    addLayer: vi.fn(),
    removeLayer: vi.fn().mockReturnValue(true),
    setActiveLayer: vi.fn(),
    getLayerCount: vi.fn(() => layers.length),
    getLayerName: vi.fn((i: number) => layers[i]?.name ?? ""),
    getLayerVisible: vi.fn((i: number) => layers[i]?.visible ?? true),
    getLayerOpacity: vi.fn((i: number) => layers[i]?.opacity ?? 1.0),
    getLayerBlendMode: vi.fn((i: number) => layers[i]?.blendMode ?? 0),
    getLayerKind: vi.fn((i: number) => layers[i]?.kind ?? 0),
    getGradientMapGradientId: vi.fn((i: number) => layers[i]?.gradientId),
    setLayerOpacity: vi.fn(),
    setLayerBlendMode: vi.fn(),
    setLayerVisible: vi.fn(),
    setBackgroundColor: vi.fn(),
    setCanvasVisible: vi.fn(),
    renameLayer: vi.fn(),
    moveLayer: vi.fn(),
    addGradientMapLayer: vi.fn().mockReturnValue(1),
    setOnLayersChanged: vi.fn((cb: () => void) => { _onLayersChanged = cb; }),
    /** Simulate the engine firing onLayersChanged (e.g., after undo/redo). */
    fireLayersChanged: () => _onLayersChanged?.(),
  };
}

describe("syncLayersFromEngine", () => {
  it("should sync layers from engine on init", () => {
    const engine = createMockEngine([
      { name: "Layer 1" },
      { name: "Gradient Map", kind: 1, gradientId: "grad-1" },
      { name: "Layer 3" },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));

    expect(result.current.layers).toHaveLength(3);
    expect(result.current.layers[0].name).toBe("Layer 1");
    expect(result.current.layers[0].kind).toBe("raster");
    expect(result.current.layers[1].name).toBe("Gradient Map");
    expect(result.current.layers[1].kind).toBe("gradient-map");
    const gradLayer = result.current.layers[1];
    if (gradLayer.kind === "gradient-map") {
      expect(gradLayer.gradientId).toBe("grad-1");
    } else {
      expect.unreachable("Expected gradient-map layer");
    }
    expect(result.current.layers[2].name).toBe("Layer 3");
    expect(result.current.layers[2].kind).toBe("raster");
  });

  it("should start with empty layers when no engine", () => {
    const { result } = renderHook(() => useLayerManager(null));
    expect(result.current.layers).toHaveLength(0);
  });

  it("should sync layer properties (opacity, visibility, blend mode)", () => {
    const engine = createMockEngine([
      { name: "Layer 1", opacity: 0.5, visible: false, blendMode: 2 },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));

    expect(result.current.layers[0].opacity).toBe(0.5);
    expect(result.current.layers[0].visible).toBe(false);
    expect(result.current.layers[0].blendMode).toBe(2);
  });

  it("should clamp active index when engine has fewer layers", () => {
    const engine = createMockEngine([
      { name: "Layer 1" },
      { name: "Layer 2" },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));

    act(() => {
      result.current.selectLayer(1);
    });
    expect(result.current.activeIndex).toBe(1);

    // Simulate engine having only 1 layer (after undo removed one)
    engine.getLayerCount.mockReturnValue(1);
    act(() => {
      result.current.syncLayersFromEngine();
    });

    expect(result.current.layers).toHaveLength(1);
    expect(result.current.activeIndex).toBe(0);
  });

  it("should be callable after undo to rebuild layer list", () => {
    const engine = createMockEngine([
      { name: "Layer 1" },
      { name: "Layer 2" },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers).toHaveLength(2);

    // Simulate an undo that removed Layer 2 — engine now returns 1 layer
    engine.getLayerCount.mockReturnValue(1);
    engine.getLayerName.mockImplementation((i: number) =>
      i === 0 ? "Layer 1" : "",
    );

    act(() => {
      result.current.syncLayersFromEngine();
    });

    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].name).toBe("Layer 1");
  });

  it("moveLayer should call syncLayersFromEngine and engine.moveLayer", () => {
    const engine = createMockEngine([
      { name: "Layer 1" },
      { name: "Layer 2" },
      { name: "Layer 3" },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers).toHaveLength(3);

    // After moveLayer(0, 2), engine returns reordered layers
    engine.getLayerName.mockImplementation((i: number) =>
      ["Layer 2", "Layer 3", "Layer 1"][i] ?? "",
    );

    act(() => {
      result.current.moveLayer(0, 2);
    });

    expect(engine.moveLayer).toHaveBeenCalledWith(0, 2);
    expect(result.current.layers[0].name).toBe("Layer 2");
    expect(result.current.layers[1].name).toBe("Layer 3");
    expect(result.current.layers[2].name).toBe("Layer 1");
  });
});

describe("onLayersChanged callback", () => {
  it("should register callback on engine init", () => {
    const engine = createMockEngine([{ name: "Layer 1" }]);

    renderHook(() => useLayerManager(engine as never));

    expect(engine.setOnLayersChanged).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should auto-sync layers when callback fires (simulating undo)", () => {
    const engine = createMockEngine([
      { name: "Layer 1" },
      { name: "Layer 2" },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers).toHaveLength(2);

    // Simulate undo removing a layer — engine state changes, then fires callback
    engine.getLayerCount.mockReturnValue(1);
    engine.getLayerName.mockImplementation((i: number) =>
      i === 0 ? "Layer 1" : "",
    );

    act(() => {
      engine.fireLayersChanged();
    });

    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].name).toBe("Layer 1");
  });

  it("should auto-sync when redo adds a layer back", () => {
    const engine = createMockEngine([{ name: "Layer 1" }]);

    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers).toHaveLength(1);

    // Simulate redo adding Layer 2 back
    engine.getLayerCount.mockReturnValue(2);
    engine.getLayerName.mockImplementation((i: number) =>
      ["Layer 1", "Layer 2"][i] ?? "",
    );

    act(() => {
      engine.fireLayersChanged();
    });

    expect(result.current.layers).toHaveLength(2);
    expect(result.current.layers[1].name).toBe("Layer 2");
  });
});

describe("addLayer uses syncLayersFromEngine", () => {
  it("should sync from engine and set active layer after addLayer", () => {
    const engine = createMockEngine([{ name: "Layer 1" }]);

    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers).toHaveLength(1);

    // After addLayer, engine will have 2 layers
    engine.getLayerCount.mockReturnValue(2);
    engine.getLayerName.mockImplementation((i: number) =>
      ["Layer 1", "Layer 2"][i] ?? "",
    );

    act(() => {
      result.current.addLayer();
    });

    expect(engine.addLayer).toHaveBeenCalled();
    expect(result.current.layers).toHaveLength(2);
    expect(result.current.activeIndex).toBe(1);
    expect(engine.setActiveLayer).toHaveBeenCalledWith(1);
  });
});

describe("removeLayer uses syncLayersFromEngine", () => {
  it("should sync from engine after removeLayer", () => {
    const engine = createMockEngine([
      { name: "Layer 1" },
      { name: "Layer 2" },
    ]);

    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers).toHaveLength(2);

    // After removeLayer, engine will have 1 layer
    engine.getLayerCount.mockReturnValue(1);
    engine.getLayerName.mockImplementation((i: number) =>
      i === 0 ? "Layer 1" : "",
    );

    act(() => {
      result.current.removeLayer(1);
    });

    expect(engine.removeLayer).toHaveBeenCalledWith(1);
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.activeIndex).toBe(0);
  });
});
