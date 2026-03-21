import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createElement, createRef } from "react";
import { CanvasViewport } from "../components/CanvasViewport";
import type { Engine } from "../engine";

function createMockEngine(): Engine {
  return {
    getActiveLayer: vi.fn().mockReturnValue(0),
    strokeBegin: vi.fn(),
    strokeMove: vi.fn(),
    strokeEnd: vi.fn(),
    sampleColor: vi.fn().mockReturnValue([0, 0, 0]),
    selectionRect: vi.fn(),
    selectionLassoBegin: vi.fn(),
    selectionLassoPoint: vi.fn(),
    selectionLassoEnd: vi.fn(),
  } as unknown as Engine;
}

function firePointer(
  el: Element,
  type: string,
  opts: Partial<PointerEvent> = {},
) {
  const buttons = type === "pointerup" ? 0 : (opts.buttons ?? 1);
  const event = new PointerEvent(type, {
    bubbles: true,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    pressure: 0.5,
    buttons,
    ...opts,
  });
  // happy-dom's getCoalescedEvents returns [] which breaks coalesced-event
  // loops; override to return [event] so the handler processes the event.
  event.getCoalescedEvents = () => [event];
  el.dispatchEvent(event);
}

describe("selection preview overlay", () => {
  let engine: Engine;
  let canvasRef: React.RefObject<HTMLCanvasElement | null>;

  beforeEach(() => {
    cleanup();
    engine = createMockEngine();
    canvasRef = createRef<HTMLCanvasElement>();
  });

  function renderViewport(tool: "marquee" | "lasso") {
    const result = render(
      createElement(CanvasViewport, {
        canvasRef,
        engine,
        activeTool: tool,
        brushSize: 10,
        smoothing: 0,
        transform: { tx: 0, ty: 0, scale: 1 },
        pan: vi.fn(),
        zoom: vi.fn(),
      }),
    );
    // Set canvas dimensions (normally done by the init effect + viewport sizing)
    const canvas = canvasRef.current!;
    canvas.width = 800;
    canvas.height = 600;

    // Mock setPointerCapture on the viewport div (not available in happy-dom)
    const viewport = result.container.firstElementChild!;
    (viewport as HTMLElement).setPointerCapture = vi.fn();
    // Mock getBoundingClientRect for toViewportLocal
    (viewport as HTMLElement).getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    });
    return result;
  }

  it("should show marquee preview rectangle during drag", () => {
    const { container } = renderViewport("marquee");
    const viewport = container.firstElementChild!;
    const svg = viewport.querySelector("svg")!;

    expect(svg).toBeTruthy();
    expect(svg.innerHTML).toBe("");

    // Pointer down at (100, 100)
    firePointer(viewport, "pointerdown", { clientX: 100, clientY: 100 });
    // Drag to (200, 150)
    firePointer(viewport, "pointermove", {
      clientX: 200,
      clientY: 150,
      buttons: 1,
    });

    // SVG should contain rect elements (white solid + black dashed)
    expect(svg.innerHTML).toContain("<rect");
    expect(svg.innerHTML).toContain("stroke-dasharray");

    // Pointer up clears the overlay
    firePointer(viewport, "pointerup", { clientX: 200, clientY: 150 });
    expect(svg.innerHTML).toBe("");
  });

  it("should show lasso preview path during drag", () => {
    const { container } = renderViewport("lasso");
    const viewport = container.firstElementChild!;
    const svg = viewport.querySelector("svg")!;

    expect(svg.innerHTML).toBe("");

    // Pointer down
    firePointer(viewport, "pointerdown", { clientX: 50, clientY: 50 });
    // Move to several points
    firePointer(viewport, "pointermove", {
      clientX: 100,
      clientY: 50,
      buttons: 1,
    });
    firePointer(viewport, "pointermove", {
      clientX: 100,
      clientY: 100,
      buttons: 1,
    });

    // SVG should contain path elements with the lasso outline
    expect(svg.innerHTML).toContain("<path");
    expect(svg.innerHTML).toContain("stroke-dasharray");

    // Pointer up clears the overlay
    firePointer(viewport, "pointerup", { clientX: 100, clientY: 100 });
    expect(svg.innerHTML).toBe("");
  });

  it("should clear marquee overlay when selection is committed", () => {
    const { container } = renderViewport("marquee");
    const viewport = container.firstElementChild!;
    const svg = viewport.querySelector("svg")!;

    firePointer(viewport, "pointerdown", { clientX: 10, clientY: 10 });
    firePointer(viewport, "pointermove", {
      clientX: 50,
      clientY: 50,
      buttons: 1,
    });
    expect(svg.innerHTML).toContain("<rect");

    firePointer(viewport, "pointerup", { clientX: 50, clientY: 50 });
    expect(svg.innerHTML).toBe("");
    expect(engine.selectionRect).toHaveBeenCalled();
  });
});
