import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushPresets } from "../hooks/useBrushPresets";
import type { BrushPreset } from "../brushPresets";

describe("useBrushPresets toggleTipType", () => {
  const mockEngine = {
    setBrushTip: vi.fn(),
    clearBrushTip: vi.fn(),
    setSecondaryBrushTip: vi.fn(),
    clearSecondaryBrushTip: vi.fn(),
    setTextureTip: vi.fn(),
    clearTextureTip: vi.fn(),
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

  it("toggles primary tip from computed to image", async () => {
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

    // Wait for presets to load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    // Select initial (computed) preset
    act(() => {
      result.current.selectPreset("p1");
    });
    await vi.waitFor(() => {
      expect(mockEngine.clearBrushTip).toHaveBeenCalled();
    });

    // Toggle to image
    await act(async () => {
      await result.current.toggleTipType("image");
    });

    // Should have picked tip-123 from the other preset in absence of its own
    await vi.waitFor(() => {
      expect(mockEngine.setBrushTip).toHaveBeenCalledWith("tip-123");
    });
    expect(mockStorage.savePreset).toHaveBeenCalled();
  });

  it("toggles primary tip from image to computed", async () => {
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
    await vi.waitFor(() => {
      expect(mockEngine.setBrushTip).toHaveBeenCalledWith("tip-123");
    });

    await act(async () => {
      await result.current.toggleTipType("computed");
    });

    await vi.waitFor(() => {
      expect(mockEngine.clearBrushTip).toHaveBeenCalled();
    });
    expect(mockStorage.savePreset).toHaveBeenCalled();
  });

  it("toggles dual brush useComputed", async () => {
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
        count: 1,
        scatter: 0,
        bothAxes: false,
      }
    };
    mockStorage.listPresets.mockResolvedValue([dualPreset]);
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
      result.current.selectPreset("p1");
    });

    // In initial dualPreset, useComputed is true, so clearSecondaryBrushTip should have been called
    await vi.waitFor(() => {
      expect(mockEngine.clearSecondaryBrushTip).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.toggleDualBrushType(false);
    });

    await vi.waitFor(() => {
      expect(mockEngine.setSecondaryBrushTip).toHaveBeenCalledWith("dual-tip");
    });
    expect(mockStorage.savePreset).toHaveBeenCalled();
  });
});
