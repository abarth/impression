import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerManager } from "../hooks/useLayerManager";
import { useColorState } from "../hooks/useColorState";

function createMockEngine() {
  return {
    addLayer: vi.fn(),
    removeLayer: vi.fn().mockReturnValue(true),
    setActiveLayer: vi.fn(),
    getLayerCount: vi.fn().mockReturnValue(1),
    setLayerOpacity: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBrushColor: vi.fn(),
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

describe("useColorState does not set background color on engine", () => {
  it("should not call setBackgroundColor when background swatch changes", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useColorState(engine as never));

    act(() => {
      result.current.setBackground("#00ff00");
    });

    expect(engine.setBackgroundColor).not.toHaveBeenCalled();
  });

  it("should still set brush color when foreground changes", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useColorState(engine as never));

    act(() => {
      result.current.setForeground("#ff0000");
    });

    expect(engine.setBrushColor).toHaveBeenCalledWith(255, 0, 0);
  });
});
