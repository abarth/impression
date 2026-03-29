import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushPresets } from "../hooks/useBrushPresets";
import type { BrushPreset } from "../brushPresets";

describe("useBrushPresets toggleTipType", () => {
  const mockEngine = {
    registerBrushTip: vi.fn(),
    embedResource: vi.fn(),
  } as any;

  const mockStorage = {
    listPresets: vi.fn().mockResolvedValue([]),
    getTip: vi.fn(),
    savePreset: vi.fn().mockResolvedValue(undefined),
  } as any;

  const initialPreset: BrushPreset = {
    id: "p1",
    name: "Preset 1",
    group: "G1",
    tip: { type: "computed", hardness: 0.5 },
    size: 20,
    spacing: 0.25,
    roundness: 1.0,
    angle: 0,
    sort_order: 0,
  };

  const imagePreset: BrushPreset = {
    ...initialPreset,
    id: "p2",
    tip: { type: "image", tipId: "tip-123" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles primary tip from computed to image without mutating stored preset", async () => {
    mockStorage.listPresets.mockResolvedValue([initialPreset, imagePreset]);
    mockStorage.getTip.mockResolvedValue({ pixels: new Uint8Array(4), width: 2, height: 2 });

    const { result } = renderHook(() =>
      useBrushPresets({
        engine: mockEngine,
        storage: mockStorage,
        activeTool: "brush",
        onApplyPreset: vi.fn(),
      })
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    act(() => {
      result.current.selectPreset("p1");
    });

    await act(async () => {
      await result.current.toggleTipType("image");
    });

    // Should NOT mutate the DB preset
    expect(mockStorage.savePreset).not.toHaveBeenCalled();
  });

  it("toggles primary tip from image to computed without mutating stored preset", async () => {
    mockStorage.listPresets.mockResolvedValue([imagePreset]);
    mockStorage.getTip.mockResolvedValue({ pixels: new Uint8Array(4), width: 2, height: 2 });

    const { result } = renderHook(() =>
      useBrushPresets({
        engine: mockEngine,
        storage: mockStorage,
        activeTool: "brush",
        onApplyPreset: vi.fn(),
      })
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => {
      result.current.selectPreset("p2");
    });

    await act(async () => {
      await result.current.toggleTipType("computed");
    });

    expect(mockStorage.savePreset).not.toHaveBeenCalled();
  });

  it("toggles dual brush useComputed without mutating stored preset", async () => {
    const dualPreset: BrushPreset = {
      ...initialPreset,
      dualBrush: {
        enabled: true,
        useComputed: true,
        tipId: "dual-tip",
        mode: 0,
        hardness: 1.0,
        sizeRatio: 1.0,
        spacing: 0.25,
        flip: false,
        count: 1,
        countJitter: 0,
        scatter: 0,
        bothAxes: false,
      }
    };
    mockStorage.listPresets.mockResolvedValue([dualPreset]);
    mockStorage.getTip.mockResolvedValue({ pixels: new Uint8Array(4), width: 2, height: 2 });

    const onApplyPreset = vi.fn();
    const { result } = renderHook(() =>
      useBrushPresets({
        engine: mockEngine,
        storage: mockStorage,
        activeTool: "brush",
        onApplyPreset,
      })
    );

    await vi.waitFor(() => {
      expect(result.current.presets.length).toBe(1);
    });

    act(() => {
      result.current.selectPreset("p1");
    });

    await act(async () => {
      await result.current.toggleDualBrushType(false);
    });

    // Should call onApplyPreset with the new dualBrush settings
    expect(onApplyPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        dualBrush: expect.objectContaining({ useComputed: false }),
      })
    );
    // Should NOT mutate the DB preset
    expect(mockStorage.savePreset).not.toHaveBeenCalled();
  });
});
