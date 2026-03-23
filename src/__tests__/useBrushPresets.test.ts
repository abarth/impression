import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushPresets } from "../hooks/useBrushPresets";
import type { Engine } from "../engine";
import type { Storage } from "../storage";
import type { BrushPreset } from "../brushPresets";
import type { Tool } from "../hooks/useTool";

function createMockEngine(): Engine {
  return {
    registerBrushTip: vi.fn(),
    embedResource: vi.fn().mockResolvedValue(undefined),
  } as unknown as Engine;
}

const COMPUTED_PRESET: BrushPreset = {
  id: "preset-computed",
  name: "Hard Round",
  group: "Default",
  tip: { type: "computed", hardness: 1.0 },
  size: 20,
  spacing: 0.15,
  roundness: 1.0,
  angle: 0,
  sort_order: 0,
};

const IMAGE_PRESET: BrushPreset = {
  id: "preset-image",
  name: "Textured",
  group: "Imported",
  tip: { type: "image", tipId: "tip-abc" },
  size: 30,
  spacing: 0.25,
  roundness: 1.0,
  angle: 0,
  sort_order: 1,
};

const TIP_DATA = {
  id: "tip-abc",
  pixels: new Uint8Array([255, 128, 64, 32]),
  width: 2,
  height: 2,
};

function createMockStorage(presets: BrushPreset[] = []): Storage {
  return {
    listPresets: vi.fn().mockResolvedValue([...presets]),
    savePreset: vi.fn().mockResolvedValue(undefined),
    deletePreset: vi.fn().mockResolvedValue(undefined),
    getTip: vi.fn().mockResolvedValue(TIP_DATA),
    listTips: vi.fn().mockResolvedValue([TIP_DATA]),
    saveTip: vi.fn().mockResolvedValue(undefined),
    deleteTip: vi.fn().mockResolvedValue(undefined),
  } as unknown as Storage;
}

describe("useBrushPresets isImageTip", () => {
  it("should be false when no preset is selected", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([COMPUTED_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    expect(result.current.isImageTip).toBe(false);
  });

  it("should be false when a computed preset is selected", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([COMPUTED_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => result.current.selectPreset("preset-computed"));
    expect(result.current.isImageTip).toBe(false);
  });

  it("should be true when an image preset is selected", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([IMAGE_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => result.current.selectPreset("preset-image"));
    expect(result.current.isImageTip).toBe(true);
  });
});

describe("useBrushPresets selectPreset applies all fields", () => {
  it("should pass flipX, flipY, and smoothing to onApplyPreset", async () => {
    const preset: BrushPreset = {
      ...COMPUTED_PRESET,
      id: "preset-flipped",
      flipX: true,
      flipY: true,
      smoothing: 0.5,
      shapeDynamics: {
        size: { jitter: 0, control: 1, minimum: 0.2 },
        angle: { jitter: 0.8, control: 0, minimum: 0 },
        roundness: { jitter: 0, control: 0, minimum: 0 },
      },
      transferDynamics: {
        opacity: { jitter: 0.3, control: 0, minimum: 0 },
        flow: { jitter: 0, control: 1, minimum: 0.1 },
      },
      dualBrush: {
        enabled: true,
        mode: 1,
        useComputed: true,
        hardness: 0.8,
        size: 25,
        spacing: 0.5,
        count: 1,
        scatter: 0,
        bothAxes: false,
      },
    };
    const engine = createMockEngine();
    const storage = createMockStorage([preset]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => result.current.selectPreset("preset-flipped"));

    expect(onApplyPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        flipX: true,
        flipY: true,
        smoothing: 0.5,
        shapeDynamics: preset.shapeDynamics,
        transferDynamics: preset.transferDynamics,
        dualBrush: preset.dualBrush,
      }),
    );
  });
});

describe("useBrushPresets tip lifecycle", () => {
  it("should not call engine tip setters when selecting a computed preset", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([COMPUTED_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => result.current.selectPreset("preset-computed"));

    // No tip registration needed for computed presets
    expect(engine.registerBrushTip).not.toHaveBeenCalled();
    expect(onApplyPreset).toHaveBeenCalledWith(
      expect.objectContaining({ size: 20, hardness: 1.0 }),
    );
  });

  it("should register tip when selecting an image preset", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([IMAGE_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => result.current.selectPreset("preset-image"));

    // Wait for async tip loading
    await vi.waitFor(() => {
      expect(engine.registerBrushTip).toHaveBeenCalledWith(
        "tip-abc", TIP_DATA.pixels, 2, 2,
      );
    });

    expect(storage.getTip).toHaveBeenCalledWith("tip-abc");
    expect(onApplyPreset).toHaveBeenCalledWith(
      expect.objectContaining({ size: 30 }),
    );
  });

  it("should not re-register a tip that is already registered", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([IMAGE_PRESET, COMPUTED_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(2);
    });

    act(() => result.current.selectPreset("preset-image"));
    await vi.waitFor(() => {
      expect(engine.registerBrushTip).toHaveBeenCalledTimes(1);
    });

    // Select computed then back to image
    act(() => result.current.selectPreset("preset-computed"));
    act(() => result.current.selectPreset("preset-image"));

    // registerBrushTip should only be called once (cached)
    // Give async a moment to settle
    await vi.waitFor(() => {
      expect(engine.registerBrushTip).toHaveBeenCalledTimes(1);
    });
  });
});
