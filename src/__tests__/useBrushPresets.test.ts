import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushPresets } from "../hooks/useBrushPresets";
import type { Engine } from "../engine";
import type { Storage } from "../storage";
import type { BrushPreset } from "../brushPresets";

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
    registerBrushTip: vi.fn(),
    setBrushTip: vi.fn(),
    clearBrushTip: vi.fn(),
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

describe("useBrushPresets tip lifecycle", () => {
  it("should call clearBrushTip when selecting a computed preset", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([COMPUTED_PRESET]);
    const onApplyPreset = vi.fn();

    const { result } = renderHook(() =>
      useBrushPresets({ engine, storage, activeTool: "brush", onApplyPreset }),
    );

    // Wait for presets to load
    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => result.current.selectPreset("preset-computed"));

    expect(engine.clearBrushTip).toHaveBeenCalled();
    expect(engine.setBrushTip).not.toHaveBeenCalled();
    expect(onApplyPreset).toHaveBeenCalledWith(
      expect.objectContaining({ size: 20, hardness: 1.0 }),
    );
  });

  it("should register and activate tip when selecting an image preset", async () => {
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
      expect(engine.setBrushTip).toHaveBeenCalledWith("tip-abc");
    });

    expect(storage.getTip).toHaveBeenCalledWith("tip-abc");
    expect(engine.registerBrushTip).toHaveBeenCalledWith(
      "tip-abc", TIP_DATA.pixels, 2, 2,
    );
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

    // Select image preset twice
    act(() => result.current.selectPreset("preset-image"));
    await vi.waitFor(() => {
      expect(engine.setBrushTip).toHaveBeenCalledTimes(1);
    });

    // Select computed then back to image
    act(() => result.current.selectPreset("preset-computed"));
    act(() => result.current.selectPreset("preset-image"));
    await vi.waitFor(() => {
      expect(engine.setBrushTip).toHaveBeenCalledTimes(2);
    });

    // registerBrushTip should only be called once (cached)
    expect(engine.registerBrushTip).toHaveBeenCalledTimes(1);
  });

  it("should re-activate tip when switching tools", async () => {
    const engine = createMockEngine();
    const storage = createMockStorage([IMAGE_PRESET]);
    const onApplyPreset = vi.fn();

    const { result, rerender } = renderHook(
      ({ tool }) =>
        useBrushPresets({ engine, storage, activeTool: tool, onApplyPreset }),
      { initialProps: { tool: "brush" as const } },
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    // Select image preset on brush
    act(() => result.current.selectPreset("preset-image"));
    await vi.waitFor(() => {
      expect(engine.setBrushTip).toHaveBeenCalledTimes(1);
    });

    // Switch to eraser — no preset selected, should clear
    rerender({ tool: "eraser" });
    await vi.waitFor(() => {
      expect(engine.clearBrushTip).toHaveBeenCalled();
    });

    // Switch back to brush — should re-activate the image tip
    rerender({ tool: "brush" });
    await vi.waitFor(() => {
      expect(engine.setBrushTip).toHaveBeenCalledTimes(2);
    });
  });
});
