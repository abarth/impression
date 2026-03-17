import { useRef, useEffect, useCallback, type RefObject } from "react";
import type { Engine } from "../engine";
import type { Tool } from "../hooks/useTool";
import type { ViewTransform } from "../hooks/useViewTransform";

/** Selection combine mode based on modifier keys (matches Photoshop). */
function getCombineMode(e: PointerEvent): number {
  if (e.shiftKey && e.altKey) return 3; // intersect
  if (e.shiftKey) return 1; // add
  if (e.altKey) return 2; // subtract
  return 0; // replace
}

interface CanvasViewportProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  engine: Engine | null;
  activeTool: Tool;
  transform: ViewTransform;
  pan: (dx: number, dy: number) => void;
  zoom: (delta: number, cx: number, cy: number) => void;
  onColorPick?: (hex: string) => void;
}

const cursorMap: Record<Tool, string> = {
  brush: "crosshair",
  pan: "grab",
  zoom: "zoom-in",
  eyedropper: "crosshair",
  marquee: "crosshair",
  lasso: "crosshair",
};

export function CanvasViewport({
  canvasRef,
  engine,
  activeTool,
  transform,
  pan,
  zoom,
  onColorPick,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const marqueeMode = useRef<number>(0);
  const lassoMode = useRef<number>(0);
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;

  /** Convert page (clientX/clientY) coordinates to viewport-local coordinates. */
  const toViewportLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const { x: relX, y: relY } = toViewportLocal(screenX, screenY);
      return {
        x: (relX - transform.tx) / transform.scale,
        y: (relY - transform.ty) / transform.scale,
      };
    },
    [transform, toViewportLocal],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handlePointerDown = (e: PointerEvent) => {
      const tool = toolRef.current;

      if (tool === "eyedropper" && engine && onColorPick) {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        const [r, g, b] = engine.sampleColor(x, y);
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        onColorPick(hex);
      } else if (tool === "marquee" && engine) {
        viewport.setPointerCapture(e.pointerId);
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        marqueeStart.current = { x, y };
        marqueeMode.current = getCombineMode(e);
      } else if (tool === "lasso" && engine) {
        viewport.setPointerCapture(e.pointerId);
        lassoMode.current = getCombineMode(e);
        engine.selectionLassoBegin();
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        engine.selectionLassoPoint(x, y);
      } else if (tool === "brush" && engine) {
        viewport.setPointerCapture(e.pointerId);
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        engine.strokeBegin(
          engine.getActiveLayer(),
          x,
          y,
          e.pressure || 0.5,
        );
      } else if (tool === "pan" || tool === "zoom") {
        viewport.setPointerCapture(e.pointerId);
        dragStart.current = { x: e.clientX, y: e.clientY };
        if (tool === "zoom") {
          zoomAnchor.current = toViewportLocal(e.clientX, e.clientY);
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.buttons === 0) return;
      const tool = toolRef.current;

      if (tool === "lasso" && engine) {
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const ce of events) {
          const { x, y } = screenToCanvas(ce.clientX, ce.clientY);
          engine.selectionLassoPoint(x, y);
        }
      } else if (tool === "brush" && engine) {
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const ce of events) {
          const { x, y } = screenToCanvas(ce.clientX, ce.clientY);
          engine.strokeMove(
            engine.getActiveLayer(),
            x,
            y,
            ce.pressure || 0.5,
          );
        }
      } else if (tool === "pan" && dragStart.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        dragStart.current = { x: e.clientX, y: e.clientY };
        pan(dx, dy);
      } else if (tool === "zoom" && dragStart.current && zoomAnchor.current) {
        const dx = e.clientX - dragStart.current.x;
        dragStart.current = { x: e.clientX, y: e.clientY };
        zoom(-dx, zoomAnchor.current.x, zoomAnchor.current.y);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const tool = toolRef.current;

      if (tool === "marquee" && engine && marqueeStart.current) {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        const sx = marqueeStart.current.x;
        const sy = marqueeStart.current.y;
        // Normalize rectangle (handle drag in any direction)
        const rx = Math.floor(Math.min(sx, x));
        const ry = Math.floor(Math.min(sy, y));
        const rw = Math.ceil(Math.abs(x - sx));
        const rh = Math.ceil(Math.abs(y - sy));
        if (rw > 0 && rh > 0) {
          engine.selectionRect(
            Math.max(0, rx),
            Math.max(0, ry),
            rw,
            rh,
            marqueeMode.current,
          );
        }
        marqueeStart.current = null;
      } else if (tool === "lasso" && engine) {
        engine.selectionLassoEnd(lassoMode.current);
      } else if (tool === "brush" && engine) {
        engine.strokeEnd();
      }
      dragStart.current = null;
      zoomAnchor.current = null;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const local = toViewportLocal(e.clientX, e.clientY);
        zoom(e.deltaY, local.x, local.y);
      } else {
        pan(-e.deltaX, -e.deltaY);
      }
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", handlePointerUp);
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerup", handlePointerUp);
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [engine, screenToCanvas, toViewportLocal, pan, zoom, onColorPick]);

  // Set the canvas document size once from the initial viewport dimensions.
  // The canvas represents a fixed-size document; viewport resizes should not
  // change it (pan/zoom CSS transforms handle the viewport).
  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;

    const rect = viewport.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
  }, [canvasRef]);

  return (
    <div
      ref={viewportRef}
      className="flex-1 relative overflow-hidden bg-graphite-950"
      style={{
        touchAction: "none",
        cursor: cursorMap[activeTool],
      }}
    >
      <div
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
