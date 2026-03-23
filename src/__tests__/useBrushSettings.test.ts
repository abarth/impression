import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushSettings } from "../hooks/useBrushSettings";
import type { Engine } from "../engine";
import type { Tool } from "../hooks/useTool";

function fireKeyDown(key: string, options: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
  );
}

function createMockEngine(): Engine {
  return {
    resetBrush: vi.fn(),
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
    setBrushFlipX: vi.fn(),
    setBrushFlipY: vi.fn(),
    setScatter: vi.fn(),
    setDualBrush: vi.fn(),
    setSecondaryBrushTip: vi.fn(),
    clearSecondaryBrushTip: vi.fn(),
    setTexture: vi.fn(),
    setTextureTip: vi.fn(),
    clearTextureTip: vi.fn(),
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
      { initialProps: { tool: "brush" as Tool } },
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
      { initialProps: { tool: "brush" as Tool } },
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

  it("should reset brush preset properties when switching presets", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Apply a preset with scatter and dynamics
    act(() => {
      result.current.applyPreset({
        size: 50,
        scatterSettings: { scatter: 2.5, bothAxes: true, count: 3, countJitter: 0.5 },
        shapeDynamics: {
          size: { jitter: 0.8, control: 1, minimum: 0.25 },
          angle: { jitter: 0, control: 0, minimum: 0 },
          roundness: { jitter: 0, control: 0, minimum: 0 },
        },
      });
    });

    expect(result.current.settings.scatterSettings.scatter).toBe(2.5);
    expect(result.current.settings.shapeDynamics.size.jitter).toBe(0.8);

    // Apply a different preset that doesn't specify scatter or dynamics
    act(() => {
      result.current.applyPreset({
        size: 20,
        spacing: 0.15,
        hardness: 1.0,
      });
    });

    // Scatter should be reset to defaults, not carried over
    expect(result.current.settings.scatterSettings.scatter).toBe(0);
    expect(result.current.settings.scatterSettings.bothAxes).toBe(false);

    // Dynamics should be reset to defaults
    expect(result.current.settings.shapeDynamics.size.jitter).toBe(0);
    expect(result.current.settings.shapeDynamics.size.control).toBe(0);
  });

  it("should preserve tool options (opacity, flow) across preset changes", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Set opacity and flow manually
    act(() => result.current.updateSetting("opacity", 0.7));
    act(() => result.current.updateSetting("flow", 0.3));

    // Apply a preset that doesn't specify opacity or flow
    act(() => {
      result.current.applyPreset({
        spacing: 0.1,
        hardness: 0.5,
      });
    });

    // Tool options should be preserved
    expect(result.current.settings.opacity).toBe(0.7);
    expect(result.current.settings.flow).toBe(0.3);
  });

  it("should allow presets to override tool options when specified", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    // Apply a preset that explicitly sets opacity and flow (e.g., ABR import)
    act(() => {
      result.current.applyPreset({
        size: 175,
        opacity: 0.8,
        flow: 0.1,
      });
    });

    // Preset-specified tool options should be applied
    expect(result.current.settings.size).toBe(175);
    expect(result.current.settings.opacity).toBe(0.8);
    expect(result.current.settings.flow).toBe(0.1);
  });

  it("should call resetBrush before syncing to engine on applyPreset", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    const resetBrush = engine.resetBrush as ReturnType<typeof vi.fn>;
    resetBrush.mockClear();

    act(() => {
      result.current.applyPreset({ size: 30 });
    });

    // resetBrush should be called before setBrushSize
    expect(resetBrush).toHaveBeenCalled();
    const resetOrder = resetBrush.mock.invocationCallOrder[0];
    const sizeOrder = (engine.setBrushSize as ReturnType<typeof vi.fn>).mock.invocationCallOrder.pop()!;
    expect(resetOrder).toBeLessThan(sizeOrder);
  });

  it("should NOT call resetBrush when updating an individual setting", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    const resetBrush = engine.resetBrush as ReturnType<typeof vi.fn>;
    resetBrush.mockClear();

    act(() => {
      result.current.updateSetting("opacity", 0.5);
    });

    expect(resetBrush).not.toHaveBeenCalled();
    expect(engine.setBrushOpacity).toHaveBeenCalledWith(0.5);
  });
});

describe("useBrushSettings scatter", () => {
  it("should default to scatter off", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    expect(result.current.settings.scatterSettings.scatter).toBe(0);
    expect(result.current.settings.scatterSettings.bothAxes).toBe(false);
    expect(result.current.settings.scatterSettings.count).toBe(1);
    expect(result.current.settings.scatterSettings.countJitter).toBe(0);
  });

  it("should update scatter settings and sync to engine", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("scatterSettings", {
        scatter: 2.5,
        bothAxes: true,
        count: 3,
        countJitter: 0.5,
      });
    });

    expect(result.current.settings.scatterSettings.scatter).toBe(2.5);
    expect(result.current.settings.scatterSettings.bothAxes).toBe(true);
    expect(result.current.settings.scatterSettings.count).toBe(3);

    const calls = (engine.setScatter as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe(2.5);    // scatter
    expect(lastCall[1]).toBe(true);   // bothAxes
    expect(lastCall[2]).toBe(3);      // count
    expect(lastCall[3]).toBe(0.5);    // countJitter
  });
});

describe("useBrushSettings dualBrush", () => {
  it("should pass sizeRatio directly to engine, not multiplied by brush size", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("dualBrush", {
        enabled: true,
        mode: 0,
        useComputed: false,
        hardness: 1.0,
        sizeRatio: 0.5,
        spacing: 0.25,
        count: 1,
        scatter: 0,
        bothAxes: false,
      });
    });

    const calls = (engine.setDualBrush as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    // The size parameter (index 3) should be the ratio (0.5), NOT ratio * brushSize
    expect(lastCall[0]).toBe(true);   // enabled
    expect(lastCall[3]).toBe(0.5);    // sizeRatio passed directly
  });

  it("should not pass useComputed to engine setDualBrush", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("dualBrush", {
        enabled: true,
        mode: 0,
        useComputed: true,
        hardness: 1.0,
        sizeRatio: 1.0,
        spacing: 0.25,
        flip: false,
        count: 1,
        countJitter: 0,
        scatter: 0,
        bothAxes: false,
      });
    });

    const calls = (engine.setDualBrush as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    // setDualBrush takes 10 args: enabled, mode, hardness, sizeRatio, spacing, flip, count, countJitter, scatter, bothAxes
    expect(lastCall).toHaveLength(10);
  });

  it("should clear secondary tip when useComputed is true", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("dualBrush", {
        enabled: true,
        mode: 0,
        useComputed: true,
        hardness: 1.0,
        sizeRatio: 1.0,
        spacing: 0.25,
        count: 1,
        scatter: 0,
        bothAxes: false,
        tipId: "some-tip",
      });
    });

    // useComputed=true should clear the secondary tip even though tipId is set
    expect(engine.clearSecondaryBrushTip).toHaveBeenCalled();
  });

  it("should set secondary tip when useComputed is false and tipId exists", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("dualBrush", {
        enabled: true,
        mode: 0,
        useComputed: false,
        hardness: 1.0,
        sizeRatio: 1.0,
        spacing: 0.25,
        count: 1,
        scatter: 0,
        bothAxes: false,
        tipId: "some-tip",
      });
    });

    expect(engine.setSecondaryBrushTip).toHaveBeenCalledWith("some-tip");
  });
});

describe("useBrushSettings texture", () => {
  it("should default to texture off", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    expect(result.current.settings.texture.enabled).toBe(false);
    expect(result.current.settings.texture.scale).toBe(100);
    expect(result.current.settings.texture.depth).toBe(1.0);
    expect(result.current.settings.texture.textureEachTip).toBe(false);
  });

  it("should update texture settings and sync to engine", () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useBrushSettings(engine, "brush"));

    act(() => {
      result.current.updateSetting("texture", {
        enabled: true,
        scale: 200,
        depth: 0.75,
        textureEachTip: true,
      });
    });

    expect(result.current.settings.texture.enabled).toBe(true);
    expect(result.current.settings.texture.scale).toBe(200);
    expect(result.current.settings.texture.depth).toBe(0.75);

    const calls = (engine.setTexture as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe(true);    // enabled
    expect(lastCall[1]).toBe(200);     // scale
    expect(lastCall[2]).toBe(0.75);    // depth
    expect(lastCall[3]).toBe(true);    // textureEachTip
  });
});
