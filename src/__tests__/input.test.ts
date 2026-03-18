import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupInput } from "../input";
import type { Engine } from "../engine";

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

  beforeEach(() => {
    engine = createMockEngine();
    canvas = createMockCanvas();
    setupInput(canvas as unknown as HTMLCanvasElement, engine);
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

  it("should call strokeBegin on pointerdown with pressure 1.0 for mouse", () => {
    canvas._fire("pointerdown", {
      offsetX: 100,
      offsetY: 200,
      pressure: 0.5,
    });
    expect(canvas.setPointerCapture).toHaveBeenCalled();
    // Mouse (no pointerType) should default to pressure 1.0
    expect(engine.strokeBegin).toHaveBeenCalledWith(0, 100, 200, 1.0);
  });

  it("should use actual pressure for pen input", () => {
    canvas._fire("pointerdown", {
      offsetX: 100,
      offsetY: 200,
      pressure: 0.75,
      pointerType: "pen",
    } as unknown as Partial<PointerEvent>);
    expect(engine.strokeBegin).toHaveBeenCalledWith(0, 100, 200, 0.75);
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
    // Mouse (no pointerType) should default to 1.0
    expect(engine.strokeBegin).toHaveBeenCalledWith(0, 50, 50, 1.0);
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
