import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushSettings } from "../hooks/useBrushSettings";
import type { Engine } from "../engine";

function fireKeyDown(key: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
  );
}

function createMockEngine(): Engine {
  return {
    setBrushSize: () => {},
    setBrushSpacing: () => {},
    setBrushFlow: () => {},
    setBrushOpacity: () => {},
    setBrushBlendMode: () => {},
  } as unknown as Engine;
}

describe("useBrushSettings keyboard shortcuts", () => {
  it("should decrease brush size on [ key", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));
    const initialSize = result.current.settings.size;

    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBeLessThan(initialSize);
  });

  it("should increase brush size on ] key", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));
    const initialSize = result.current.settings.size;

    act(() => fireKeyDown("]"));

    expect(result.current.settings.size).toBeGreaterThan(initialSize);
  });

  it("should not decrease below 1px", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Set size to 1 first
    act(() => result.current.updateSetting("size", 1));

    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBe(1);
  });

  it("should not increase above 100px", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Set size to 100 first
    act(() => result.current.updateSetting("size", 100));

    act(() => fireKeyDown("]"));

    expect(result.current.settings.size).toBe(100);
  });

  it("should use larger steps for bigger brush sizes", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Set size to 50
    act(() => result.current.updateSetting("size", 50));

    act(() => fireKeyDown("["));

    // Step should be ~10% of 50 = 5, so new size = 45
    expect(result.current.settings.size).toBe(45);
  });

  it("should use step of 1 for small brush sizes", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Set size to 5
    act(() => result.current.updateSetting("size", 5));

    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBe(4);
  });

  it("should not trigger when typing in an input", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));
    const initialSize = result.current.settings.size;

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "[", bubbles: true }),
    );
    document.body.removeChild(input);

    expect(result.current.settings.size).toBe(initialSize);
  });
});
