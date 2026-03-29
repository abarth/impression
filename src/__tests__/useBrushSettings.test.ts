import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrushSettings, buildSerializableSettings, TOOL_BLEND_MODES, getMediumPhysics, DEFAULT_WET_MEDIA } from "../hooks/useBrushSettings";
import type { MediumType, BrushShape } from "../hooks/useBrushSettings";
import type { Tool } from "../hooks/useTool";

function fireKeyDown(key: string, options: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
  );
}

describe("useBrushSettings keyboard shortcuts", () => {
  it("should decrease brush size on [ key", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));
    const initialSize = result.current.settings.size;

    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBeLessThan(initialSize);
  });

  it("should increase brush size on ] key", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));
    const initialSize = result.current.settings.size;

    act(() => fireKeyDown("]"));

    expect(result.current.settings.size).toBeGreaterThan(initialSize);
  });

  it("should not decrease below 1px", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => result.current.updateSetting("size", 1));
    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBe(1);
  });

  it("should not increase above 100px", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => result.current.updateSetting("size", 100));
    act(() => fireKeyDown("]"));

    expect(result.current.settings.size).toBe(100);
  });

  it("should use larger steps for bigger brush sizes", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => result.current.updateSetting("size", 50));
    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBe(45);
  });

  it("should use step of 1 for small brush sizes", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => result.current.updateSetting("size", 5));
    act(() => fireKeyDown("["));

    expect(result.current.settings.size).toBe(4);
  });

  it("should not trigger when typing in an input", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));
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
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => fireKeyDown("1"));

    expect(result.current.settings.opacity).toBeCloseTo(0.1);
  });

  it("should set opacity to 50% on key 5", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => fireKeyDown("5"));

    expect(result.current.settings.opacity).toBeCloseTo(0.5);
  });

  it("should set opacity to 100% on key 0", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => fireKeyDown("1"));
    expect(result.current.settings.opacity).toBeCloseTo(0.1);

    act(() => fireKeyDown("0"));
    expect(result.current.settings.opacity).toBeCloseTo(1.0);
  });

  it("should set flow on Shift+number", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => fireKeyDown("3", { shiftKey: true }));

    expect(result.current.settings.flow).toBeCloseTo(0.3);
    expect(result.current.settings.opacity).toBeCloseTo(1.0);
  });

  it("should set flow to 100% on Shift+0", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => fireKeyDown("2", { shiftKey: true }));
    expect(result.current.settings.flow).toBeCloseTo(0.2);

    act(() => fireKeyDown("0", { shiftKey: true }));
    expect(result.current.settings.flow).toBeCloseTo(1.0);
  });
});

describe("useBrushSettings shape dynamics", () => {
  it("should default to all dynamics off", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    const sd = result.current.settings.shapeDynamics;
    expect(sd.size.control).toBe(0);
    expect(sd.angle.control).toBe(0);
    expect(sd.roundness.control).toBe(0);
  });

  it("should update shape dynamics in state", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("shapeDynamics", {
        size: { jitter: 0.8, control: 1, minimum: 0.25 },
        angle: { jitter: 1.0, control: 2, minimum: 0 },
        roundness: { jitter: 0, control: 0, minimum: 0 },
      });
    });

    const sd = result.current.settings.shapeDynamics;
    expect(sd.size.jitter).toBe(0.8);
    expect(sd.size.control).toBe(1);
    expect(sd.size.minimum).toBe(0.25);
    expect(sd.angle.jitter).toBe(1.0);
    expect(sd.angle.control).toBe(2);
  });

  it("should keep shape dynamics independent per tool", () => {
    const { result, rerender } = renderHook(
      ({ tool }) => useBrushSettings(null, tool),
      { initialProps: { tool: "brush" as Tool } },
    );

    act(() => {
      result.current.updateSetting("shapeDynamics", {
        size: { jitter: 1.0, control: 1, minimum: 0 },
        angle: { jitter: 0, control: 0, minimum: 0 },
        roundness: { jitter: 0, control: 0, minimum: 0 },
      });
    });

    rerender({ tool: "eraser" });
    expect(result.current.settings.shapeDynamics.size.control).toBe(0);

    rerender({ tool: "brush" });
    expect(result.current.settings.shapeDynamics.size.jitter).toBe(1.0);
    expect(result.current.settings.shapeDynamics.size.control).toBe(1);
  });
});

describe("useBrushSettings transfer dynamics", () => {
  it("should default to all transfer dynamics off", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    const td = result.current.settings.transferDynamics;
    expect(td.opacity.control).toBe(0);
    expect(td.flow.control).toBe(0);
  });

  it("should update transfer dynamics in state", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("transferDynamics", {
        opacity: { jitter: 0.5, control: 1, minimum: 0.1 },
        flow: { jitter: 0.7, control: 2, minimum: 0.2 },
      });
    });

    const td = result.current.settings.transferDynamics;
    expect(td.opacity.jitter).toBe(0.5);
    expect(td.opacity.control).toBe(1);
    expect(td.opacity.minimum).toBe(0.1);
    expect(td.flow.jitter).toBe(0.7);
    expect(td.flow.control).toBe(2);
    expect(td.flow.minimum).toBe(0.2);
  });

  it("should keep transfer dynamics independent per tool", () => {
    const { result, rerender } = renderHook(
      ({ tool }) => useBrushSettings(null, tool),
      { initialProps: { tool: "brush" as Tool } },
    );

    act(() => {
      result.current.updateSetting("transferDynamics", {
        opacity: { jitter: 1.0, control: 1, minimum: 0.3 },
        flow: { jitter: 0, control: 0, minimum: 0 },
      });
    });

    rerender({ tool: "eraser" });
    expect(result.current.settings.transferDynamics.opacity.control).toBe(0);

    rerender({ tool: "brush" });
    expect(result.current.settings.transferDynamics.opacity.jitter).toBe(1.0);
    expect(result.current.settings.transferDynamics.opacity.minimum).toBe(0.3);
  });
});

describe("useBrushSettings applyPreset", () => {
  it("should apply preset with shape and transfer dynamics", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

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
  });

  it("should reset brush preset properties when switching presets", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

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

    act(() => {
      result.current.applyPreset({
        size: 20,
        spacing: 0.15,
        hardness: 1.0,
      });
    });

    expect(result.current.settings.scatterSettings.scatter).toBe(0);
    expect(result.current.settings.scatterSettings.bothAxes).toBe(false);
    expect(result.current.settings.shapeDynamics.size.jitter).toBe(0);
    expect(result.current.settings.shapeDynamics.size.control).toBe(0);
  });

  it("should preserve tool options (opacity, flow) across preset changes", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => result.current.updateSetting("opacity", 0.7));
    act(() => result.current.updateSetting("flow", 0.3));

    act(() => {
      result.current.applyPreset({
        spacing: 0.1,
        hardness: 0.5,
      });
    });

    expect(result.current.settings.opacity).toBe(0.7);
    expect(result.current.settings.flow).toBe(0.3);
  });

  it("should allow presets to override tool options when specified", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.applyPreset({
        size: 175,
        opacity: 0.8,
        flow: 0.1,
      });
    });

    expect(result.current.settings.size).toBe(175);
    expect(result.current.settings.opacity).toBe(0.8);
    expect(result.current.settings.flow).toBe(0.1);
  });

  it("should update activeTipId from preset", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.applyPreset({
        activeTipId: "some-tip-id",
      });
    });

    expect(result.current.settings.activeTipId).toBe("some-tip-id");

    act(() => {
      result.current.applyPreset({
        activeTipId: null,
      });
    });

    expect(result.current.settings.activeTipId).toBeNull();
  });
});

describe("useBrushSettings scatter", () => {
  it("should default to scatter off", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    expect(result.current.settings.scatterSettings.scatter).toBe(0);
    expect(result.current.settings.scatterSettings.bothAxes).toBe(false);
    expect(result.current.settings.scatterSettings.count).toBe(1);
    expect(result.current.settings.scatterSettings.countJitter).toBe(0);
  });

  it("should update scatter settings in state", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

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
  });
});

describe("useBrushSettings dualBrush", () => {
  it("should store dualBrush settings in state", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("dualBrush", {
        enabled: true,
        mode: 0,
        useComputed: false,
        hardness: 1.0,
        sizeRatio: 0.5,
        spacing: 0.25,
        flip: false,
        count: 1,
        countJitter: 0,
        scatter: 0,
        bothAxes: false,
      });
    });

    expect(result.current.settings.dualBrush.enabled).toBe(true);
    expect(result.current.settings.dualBrush.sizeRatio).toBe(0.5);
  });
});

describe("useBrushSettings texture", () => {
  it("should default to texture off", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    expect(result.current.settings.texture.enabled).toBe(false);
    expect(result.current.settings.texture.scale).toBe(100);
    expect(result.current.settings.texture.depth).toBe(1.0);
    expect(result.current.settings.texture.textureEachTip).toBe(false);
  });

  it("should update texture settings in state", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

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
  });
});

describe("buildSerializableSettings", () => {
  it("should convert BrushSettings to SerializableBrushSettings", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    const serializable = buildSerializableSettings(
      result.current.settings,
      TOOL_BLEND_MODES.brush,
      128, 64, 32,
    );

    expect(serializable.size).toBe(result.current.settings.size);
    expect(serializable.color_r).toBe(128);
    expect(serializable.color_g).toBe(64);
    expect(serializable.color_b).toBe(32);
    expect(serializable.blend_mode).toBe(0); // Normal
    expect(serializable.flip_x).toBe(false);
    expect(serializable.flip_y).toBe(false);
  });

  it("should use eraser blend mode", () => {
    const { result } = renderHook(() => useBrushSettings(null, "eraser"));

    const serializable = buildSerializableSettings(
      result.current.settings,
      TOOL_BLEND_MODES.eraser,
      0, 0, 0,
    );

    expect(serializable.blend_mode).toBe(108); // DstOut
  });

  it("should include dual brush scatter settings", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("dualBrush", {
        enabled: true,
        mode: 0,
        useComputed: false,
        hardness: 1.0,
        sizeRatio: 0.5,
        spacing: 0.25,
        flip: true,
        count: 3,
        countJitter: 0.5,
        scatter: 2.0,
        bothAxes: true,
        tipId: "my-tip",
      });
    });

    const serializable = buildSerializableSettings(
      result.current.settings,
      0, 0, 0, 0,
    );

    expect(serializable.dual_brush.enabled).toBe(true);
    expect(serializable.dual_brush.size_ratio).toBe(0.5);
    expect(serializable.dual_brush.flip).toBe(true);
    expect(serializable.dual_brush.scatter.scatter).toBe(2.0);
    expect(serializable.dual_brush.scatter.both_axes).toBe(true);
    expect(serializable.dual_brush.scatter.count).toBe(3);
    expect(serializable.secondary_tip_id).toBe("my-tip");
  });
  it("should include active_tip_id if present", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("activeTipId", "sampled-tip-id");
    });

    const serializable = buildSerializableSettings(
      result.current.settings,
      0, 0, 0, 0,
    );

    expect(serializable.active_tip_id).toBe("sampled-tip-id");
  });

  it("should set secondary_tip_id to null when useComputed is true", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

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
        tipId: "some-tip",
      });
    });

    const serializable = buildSerializableSettings(
      result.current.settings,
      0, 0, 0, 0,
    );

    expect(serializable.secondary_tip_id).toBeNull();
  });
});

describe("wet media medium type", () => {
  it("should include mediumType, viscosity, bristleStiffness, brushShape, and splittingThreshold in defaults", () => {
    expect(DEFAULT_WET_MEDIA.mediumType).toBe("Oil");
    expect(DEFAULT_WET_MEDIA.viscosity).toBe(0.7);
    expect(DEFAULT_WET_MEDIA.bristleStiffness).toBe(0.5);
    expect(DEFAULT_WET_MEDIA.bristleCount).toBe(256);
    expect(DEFAULT_WET_MEDIA.brushShape).toBe("Round");
    expect(DEFAULT_WET_MEDIA.splittingThreshold).toBe(0.3);
  });

  it("should update mediumType via updateSetting", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("wetMedia", {
        ...result.current.settings.wetMedia,
        mediumType: "Acrylic",
      });
    });

    expect(result.current.settings.wetMedia.mediumType).toBe("Acrylic");
  });

  it("should update viscosity via updateSetting", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("wetMedia", {
        ...result.current.settings.wetMedia,
        viscosity: 0.9,
      });
    });

    expect(result.current.settings.wetMedia.viscosity).toBe(0.9);
  });

  it("should include medium_type, viscosity, bristle_stiffness, brush_shape, and splitting_threshold in serializable settings", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    act(() => {
      result.current.updateSetting("wetMedia", {
        ...result.current.settings.wetMedia,
        mediumType: "Acrylic",
        viscosity: 0.55,
        bristleStiffness: 0.7,
        brushShape: "Flat",
        splittingThreshold: 0.45,
      });
    });

    const serializable = buildSerializableSettings(
      result.current.settings, 0, 0, 0, 0,
    );

    expect(serializable.wet_media.medium_type).toBe("Acrylic");
    expect(serializable.wet_media.viscosity).toBe(0.55);
    expect(serializable.wet_media.bristle_stiffness).toBe(0.7);
    expect(serializable.wet_media.brush_shape).toBe("Flat");
    expect(serializable.wet_media.splitting_threshold).toBe(0.45);
  });
});

describe("getMediumPhysics", () => {
  it("returns valid physics for all medium types", () => {
    for (const medium of ["Oil", "Acrylic", "Watercolor"] as MediumType[]) {
      const p = getMediumPhysics(medium);
      expect(p.viscosity).toBeGreaterThanOrEqual(0);
      expect(p.viscosity).toBeLessThanOrEqual(1);
      expect(p.dryingRate).toBeGreaterThan(0);
      expect(p.dryingRate).toBeLessThan(1);
      expect(p.diffusionRate).toBeGreaterThanOrEqual(0);
      expect(p.diffusionRate).toBeLessThanOrEqual(1);
      expect(p.advectionDissipation).toBeGreaterThan(0);
      expect(p.advectionDissipation).toBeLessThanOrEqual(1);
    }
  });

  it("oil dries slower than acrylic", () => {
    expect(getMediumPhysics("Oil").dryingRate).toBeLessThan(
      getMediumPhysics("Acrylic").dryingRate,
    );
  });

  it("oil has higher viscosity than acrylic", () => {
    expect(getMediumPhysics("Oil").viscosity).toBeGreaterThan(
      getMediumPhysics("Acrylic").viscosity,
    );
  });
});

describe("useBrushSettings getSettingsRef", () => {
  it("should return current settings and tool via ref", () => {
    const { result } = renderHook(() => useBrushSettings(null, "brush"));

    const ref = result.current.getSettingsRef();
    expect(ref.tool).toBe("brush");
    expect(ref.settings.size).toBe(result.current.settings.size);
  });
});
