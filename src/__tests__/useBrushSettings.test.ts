import { describe, it, expect, vi } from "vitest";
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
    setBrushSize: vi.fn(),
    setBrushSpacing: vi.fn(),
    setBrushFlow: vi.fn(),
    setBrushOpacity: vi.fn(),
    setBrushHardness: vi.fn(),
    setBrushRoundness: vi.fn(),
    setBrushAngle: vi.fn(),
    setBrushBlendMode: vi.fn(),
    setShapeDynamics: vi.fn(),
    setTransferDynamics: vi.fn(),
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

describe("useBrushSettings shape dynamics", () => {
  it("should default to all dynamics off", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    const sd = result.current.settings.shapeDynamics;
    expect(sd.size.control).toBe(0);
    expect(sd.angle.control).toBe(0);
    expect(sd.roundness.control).toBe(0);
  });

  it("should update shape dynamics and sync to engine", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("shapeDynamics", {
        size: { jitter: 0.8, control: 1, minimum: 0.25 },
        angle: { jitter: 1.0, control: 2, minimum: 0 },
        roundness: { jitter: 0, control: 0, minimum: 0 },
      });
    });

    // State updated
    const sd = result.current.settings.shapeDynamics;
    expect(sd.size.jitter).toBe(0.8);
    expect(sd.size.control).toBe(1);
    expect(sd.size.minimum).toBe(0.25);
    expect(sd.angle.jitter).toBe(1.0);
    expect(sd.angle.control).toBe(2);

    // Engine synced with correct args
    const calls = (engine.setShapeDynamics as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([
      0.8, 1, 0.25,  // size: jitter, control, minimum
      1.0, 2,        // angle: jitter, control
      0, 0, 0,       // roundness: jitter, control, minimum
    ]);
  });

  it("should keep shape dynamics independent per tool", () => {
    const engine = createMockEngine();
    const { result, rerender } = renderHook(
      ({ tool }) => useBrushSettings(engine, tool),
      { initialProps: { tool: "brush" as const } },
    );

    // Set pressure-driven size on brush
    act(() => {
      result.current.updateSetting("shapeDynamics", {
        size: { jitter: 1.0, control: 1, minimum: 0 },
        angle: { jitter: 0, control: 0, minimum: 0 },
        roundness: { jitter: 0, control: 0, minimum: 0 },
      });
    });

    // Switch to eraser — dynamics should be default (off)
    rerender({ tool: "eraser" });
    expect(result.current.settings.shapeDynamics.size.control).toBe(0);

    // Switch back to brush — dynamics should be preserved
    rerender({ tool: "brush" });
    expect(result.current.settings.shapeDynamics.size.jitter).toBe(1.0);
    expect(result.current.settings.shapeDynamics.size.control).toBe(1);
  });
});

describe("useBrushSettings transfer dynamics", () => {
  it("should default to all transfer dynamics off", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    const td = result.current.settings.transferDynamics;
    expect(td.opacity.control).toBe(0);
    expect(td.flow.control).toBe(0);
  });

  it("should update transfer dynamics and sync to engine", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("transferDynamics", {
        opacity: { jitter: 0.5, control: 1, minimum: 0.1 },
        flow: { jitter: 0.7, control: 2, minimum: 0.2 },
      });
    });

    // State updated
    const td = result.current.settings.transferDynamics;
    expect(td.opacity.jitter).toBe(0.5);
    expect(td.opacity.control).toBe(1);
    expect(td.opacity.minimum).toBe(0.1);
    expect(td.flow.jitter).toBe(0.7);
    expect(td.flow.control).toBe(2);
    expect(td.flow.minimum).toBe(0.2);

    // Engine synced with correct args
    const calls = (engine.setTransferDynamics as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([
      0.5, 1, 0.1,  // opacity: jitter, control, minimum
      0.7, 2, 0.2,  // flow: jitter, control, minimum
    ]);
  });

  it("should keep transfer dynamics independent per tool", () => {
    const engine = createMockEngine();
    const { result, rerender } = renderHook(
      ({ tool }) => useBrushSettings(engine, tool),
      { initialProps: { tool: "brush" as const } },
    );

    // Set pressure-driven opacity on brush
    act(() => {
      result.current.updateSetting("transferDynamics", {
        opacity: { jitter: 1.0, control: 1, minimum: 0.3 },
        flow: { jitter: 0, control: 0, minimum: 0 },
      });
    });

    // Switch to eraser — dynamics should be default (off)
    rerender({ tool: "eraser" });
    expect(result.current.settings.transferDynamics.opacity.control).toBe(0);

    // Switch back to brush — dynamics should be preserved
    rerender({ tool: "brush" });
    expect(result.current.settings.transferDynamics.opacity.jitter).toBe(1.0);
    expect(result.current.settings.transferDynamics.opacity.minimum).toBe(0.3);
  });
});

describe("useBrushSettings applyPreset with dynamics", () => {
  it("should apply preset with shape and transfer dynamics", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.applyPreset({
        size: 45,
        shapeDynamics: {
          size: { jitter: 0.9, control: 1, minimum: 0.1 },
          angle: { jitter: 1.0, control: 2, minimum: 0 },
          roundness: { jitter: 0, control: 0, minimum: 0 },
        },
        transferDynamics: {
          opacity: { jitter: 0.6, control: 1, minimum: 0.2 },
          flow: { jitter: 0, control: 0, minimum: 0 },
        },
      });
    });

    expect(result.current.settings.size).toBe(45);
    expect(result.current.settings.shapeDynamics.size.jitter).toBe(0.9);
    expect(result.current.settings.shapeDynamics.angle.control).toBe(2);
    expect(result.current.settings.transferDynamics.opacity.jitter).toBe(0.6);

    // Verify engine was synced
    const sdCalls = (engine.setShapeDynamics as ReturnType<typeof vi.fn>).mock.calls;
    const lastSdCall = sdCalls[sdCalls.length - 1];
    expect(lastSdCall[0]).toBe(0.9); // size jitter
    expect(lastSdCall[1]).toBe(1);   // size control (PenPressure)
  });
});
