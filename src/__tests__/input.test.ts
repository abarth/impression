import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupInput } from "../input";
import type { Engine } from "../engine";
import type { SerializableBrushSettings } from "../hooks/useBrushSettings";

type MockCanvas = HTMLCanvasElement & {
  _fire: (event: string, data: Partial<PointerEvent>) => void;
};

function createMockEngine(): Engine {
  return {
    getActiveLayer: vi.fn().mockReturnValue(0),
    strokeBegin: vi.fn(),
    strokeMove: vi.fn(),
    strokeEnd: vi.fn(),
  } as unknown as Engine;
}

/** Minimal settings blob for tests. */
function defaultSettings(): SerializableBrushSettings {
  const dynParam = { jitter: 0, control: 0 as const, minimum: 0 };
  return {
    size: 20, spacing: 0.15,
    color_r: 0, color_g: 0, color_b: 0,
    opacity: 1.0, flow: 0.8, blend_mode: 0,
    hardness: 1.0, roundness: 1.0, angle: 0,
    shape_dynamics: { size: { ...dynParam }, angle: { ...dynParam }, roundness: { ...dynParam } },
    transfer_dynamics: { opacity: { ...dynParam }, flow: { ...dynParam } },
    flip_x: false, flip_y: false,
    scatter: { scatter: 0, both_axes: false, count: 1, count_jitter: 0 },
    dual_brush: {
      enabled: false, mode: 0, hardness: 1.0, size_ratio: 1.0,
      spacing: 0.25, flip: false,
      scatter: { scatter: 0, both_axes: false, count: 1, count_jitter: 0 },
    },
    texture: { enabled: false, scale: 100, depth: 1.0, texture_each_tip: false },
    active_tip_id: null, secondary_tip_id: null, texture_tip_id: null,
    brush_model: "Stamp",
    pressure_curve: 1.0,
    wet_media: {
      paint_load: 0.8, paint_thickness: 0.5, wetness: 0.7, mixing_strength: 0.5,
      bristle_count: 256, bristle_spread: 0.3, paint_depletion_rate: 0.1,
      canvas_texture_strength: 0.3, medium_type: "Oil" as const, viscosity: 0.7,
      bristle_stiffness: 0.5, brush_form: 0.5, color_noise: 0.0, speed_smudging: 0.3,
      brush_shape: "Round" as const, splitting_threshold: 0.3,
    },
  };
}

function createMockCanvas(): MockCanvas {
  const listeners: Record<string, EventListener[]> = {};
  return {
    addEventListener: vi.fn((event: string, handler: EventListener) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    setPointerCapture: vi.fn(),
    _fire(event: string, data: Partial<PointerEvent>) {
      const ev = {
        offsetX: 0,
        offsetY: 0,
        pressure: 0.5,
        pointerId: 1,
        buttons: 1,
        getCoalescedEvents: undefined,
        ...data,
      };
      for (const h of listeners[event] ?? []) {
        h(ev as unknown as Event);
      }
    },
  } as unknown as MockCanvas;
}

describe("setupInput", () => {
  let engine: Engine;
  let canvas: MockCanvas;
  const getSettings = vi.fn().mockReturnValue(defaultSettings());

  beforeEach(() => {
    engine = createMockEngine();
    canvas = createMockCanvas();
    getSettings.mockReturnValue(defaultSettings());
    setupInput(canvas as unknown as HTMLCanvasElement, engine, getSettings);
  });

  it("should register pointer event listeners", () => {
    expect(canvas.addEventListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
    );
    expect(canvas.addEventListener).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
    );
    expect(canvas.addEventListener).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
    );
  });

  it("should call strokeBegin on pointerdown with settings and pressure 1.0 for mouse", () => {
    canvas._fire("pointerdown", {
      offsetX: 100,
      offsetY: 200,
      pressure: 0.5,
    });
    expect(canvas.setPointerCapture).toHaveBeenCalled();
    expect(getSettings).toHaveBeenCalled();
    // Mouse (no pointerType) should default to pressure 1.0
    expect(engine.strokeBegin).toHaveBeenCalledWith(0, 100, 200, 1.0, expect.any(Object));
  });

  it("should use actual pressure for pen input", () => {
    canvas._fire("pointerdown", {
      offsetX: 100,
      offsetY: 200,
      pressure: 0.75,
      pointerType: "pen",
    } as unknown as Partial<PointerEvent>);
    expect(engine.strokeBegin).toHaveBeenCalledWith(0, 100, 200, 0.75, expect.any(Object));
  });

  it("should call strokeMove on pointermove when button is pressed", () => {
    canvas._fire("pointermove", {
      offsetX: 150,
      offsetY: 250,
      pressure: 0.6,
      buttons: 1,
    });
    // Mouse should default to pressure 1.0
    expect(engine.strokeMove).toHaveBeenCalledWith(0, 150, 250, 1.0);
  });

  it("should not call strokeMove when no button is pressed", () => {
    canvas._fire("pointermove", {
      offsetX: 150,
      offsetY: 250,
      pressure: 0.6,
      buttons: 0,
    });
    expect(engine.strokeMove).not.toHaveBeenCalled();
  });

  it("should call strokeEnd on pointerup", () => {
    canvas._fire("pointerup", {});
    expect(engine.strokeEnd).toHaveBeenCalled();
  });

  it("should use pressure 1.0 for mouse when pressure is 0", () => {
    canvas._fire("pointerdown", {
      offsetX: 50,
      offsetY: 50,
      pressure: 0,
    });
    expect(engine.strokeBegin).toHaveBeenCalledWith(0, 50, 50, 1.0, expect.any(Object));
  });

  it("should use coalesced events when available", () => {
    const coalescedEvents = [
      { offsetX: 10, offsetY: 10, pressure: 0.5, pointerType: "pen" },
      { offsetX: 20, offsetY: 20, pressure: 0.6, pointerType: "pen" },
    ];
    canvas._fire("pointermove", {
      offsetX: 20,
      offsetY: 20,
      pressure: 0.6,
      buttons: 1,
      pointerType: "pen",
      getCoalescedEvents: () => coalescedEvents,
    } as unknown as Partial<PointerEvent>);

    expect(engine.strokeMove).toHaveBeenCalledTimes(2);
    expect(engine.strokeMove).toHaveBeenCalledWith(0, 10, 10, 0.5);
    expect(engine.strokeMove).toHaveBeenCalledWith(0, 20, 20, 0.6);
  });
});
