import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerManager } from "../hooks/useLayerManager";
import { useColorState } from "../hooks/useColorState";

function createMockEngine(layerCount = 1) {
  return {
    addLayer: vi.fn(),
    removeLayer: vi.fn().mockReturnValue(true),
    setActiveLayer: vi.fn(),
    getLayerCount: vi.fn().mockReturnValue(layerCount),
    getLayerName: vi.fn((i: number) => `Layer ${i + 1}`),
    getLayerVisible: vi.fn().mockReturnValue(true),
    getLayerOpacity: vi.fn().mockReturnValue(1.0),
    getLayerBlendMode: vi.fn().mockReturnValue(0),
    getLayerKind: vi.fn().mockReturnValue(0),
    getGradientMapGradientId: vi.fn(),
    setLayerOpacity: vi.fn(),
    setLayerBlendMode: vi.fn(),
    setLayerVisible: vi.fn(),
    setBackgroundColor: vi.fn(),
    setCanvasVisible: vi.fn(),
    renameLayer: vi.fn(),
  };
}

describe("Canvas color in useLayerManager", () => {
  it("should initialize canvasColor to white", () => {
    const { result } = renderHook(() => useLayerManager(null));
    expect(result.current.canvasColor).toBe("#ffffff");
  });

  it("should update canvasColor and call engine.setBackgroundColor", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useLayerManager(engine as never));

    act(() => {
      result.current.setCanvasColor("#ff0000");
    });

    expect(result.current.canvasColor).toBe("#ff0000");
    expect(engine.setBackgroundColor).toHaveBeenCalledWith(255, 0, 0);
  });

  it("should sync canvas color to engine on mount", () => {
    const engine = createMockEngine();
    renderHook(() => useLayerManager(engine as never));

    // White (#ffffff) synced on mount
    expect(engine.setBackgroundColor).toHaveBeenCalledWith(255, 255, 255);
  });
});

describe("Canvas visibility in useLayerManager", () => {
  it("should initialize canvasVisible to true", () => {
    const { result } = renderHook(() => useLayerManager(null));
    expect(result.current.canvasVisible).toBe(true);
  });

  it("should toggle canvasVisible and call engine.setCanvasVisible", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useLayerManager(engine as never));

    act(() => {
      result.current.toggleCanvasVisible();
    });

    expect(result.current.canvasVisible).toBe(false);
    expect(engine.setCanvasVisible).toHaveBeenCalledWith(false);

    act(() => {
      result.current.toggleCanvasVisible();
    });

    expect(result.current.canvasVisible).toBe(true);
    expect(engine.setCanvasVisible).toHaveBeenCalledWith(true);
  });
});

describe("Layer visibility in useLayerManager", () => {
  it("should initialize layers as visible when engine present", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useLayerManager(engine as never));
    expect(result.current.layers[0].visible).toBe(true);
  });

  it("should toggle layer visibility and call engine.setLayerVisible", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useLayerManager(engine as never));

    act(() => {
      result.current.toggleLayerVisible(0);
    });

    expect(result.current.layers[0].visible).toBe(false);
    expect(engine.setLayerVisible).toHaveBeenCalledWith(0, false);

    act(() => {
      result.current.toggleLayerVisible(0);
    });

    expect(result.current.layers[0].visible).toBe(true);
    expect(engine.setLayerVisible).toHaveBeenCalledWith(0, true);
  });
});

describe("useColorState is React-only", () => {
  it("should update foreground color without engine calls", () => {
    const { result } = renderHook(() => useColorState());

    act(() => {
      result.current.setForeground("#ff0000");
    });

    expect(result.current.colors.foreground).toBe("#ff0000");
  });

  it("should update background color without engine calls", () => {
    const { result } = renderHook(() => useColorState());

    act(() => {
      result.current.setBackground("#00ff00");
    });

    expect(result.current.colors.background).toBe("#00ff00");
  });

  it("should swap colors", () => {
    const { result } = renderHook(() => useColorState());

    act(() => {
      result.current.setForeground("#ff0000");
    });

    act(() => {
      result.current.swapColors();
    });

    expect(result.current.colors.foreground).toBe("#ffffff");
    expect(result.current.colors.background).toBe("#ff0000");
  });

  it("should provide getColorsRef for stable access", () => {
    const { result } = renderHook(() => useColorState());

    act(() => {
      result.current.setForeground("#aabbcc");
    });

    const ref = result.current.getColorsRef();
    expect(ref.foreground).toBe("#aabbcc");
  });
});
