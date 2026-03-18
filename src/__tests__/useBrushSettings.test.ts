import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushSettings } from "../hooks/useBrushSettings";
import type { Engine } from "../engine";

function fireKeyDown(key: string, options: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
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

describe("useBrushSettings opacity number keys", () => {
  it("should set opacity to 10% on key 1", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => fireKeyDown("1"));

    expect(result.current.settings.opacity).toBeCloseTo(0.1);
  });

  it("should set opacity to 50% on key 5", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => fireKeyDown("5"));

    expect(result.current.settings.opacity).toBeCloseTo(0.5);
  });

  it("should set opacity to 100% on key 0", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => fireKeyDown("1"));
    expect(result.current.settings.opacity).toBeCloseTo(0.1);

    act(() => fireKeyDown("0"));
    expect(result.current.settings.opacity).toBeCloseTo(1.0);
  });

  it("should set flow on Shift+number", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => fireKeyDown("3", { shiftKey: true }));

    expect(result.current.settings.flow).toBeCloseTo(0.3);
    // Opacity should remain unchanged (default 1.0)
    expect(result.current.settings.opacity).toBeCloseTo(1.0);
  });

  it("should set flow to 100% on Shift+0", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => fireKeyDown("2", { shiftKey: true }));
    expect(result.current.settings.flow).toBeCloseTo(0.2);

    act(() => fireKeyDown("0", { shiftKey: true }));
    expect(result.current.settings.flow).toBeCloseTo(1.0);
  });
});
