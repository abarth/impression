import { useRef, useEffect, useCallback, type RefObject } from "react";
import type { Engine } from "../engine";
import type { Tool } from "../hooks/useTool";
import type { ViewTransform } from "../hooks/useViewTransform";

interface CanvasViewportProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  engine: Engine | null;
  activeTool: Tool;
  transform: ViewTransform;
  pan: (dx: number, dy: number) => void;
  zoom: (delta: number, cx: number, cy: number) => void;
}

const cursorMap: Record<Tool, string> = {
  brush: "crosshair",
  pan: "grab",
  zoom: "zoom-in",
};

export function CanvasViewport({
  canvasRef,
  engine,
  activeTool,
  transform,
  pan,
  zoom,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: screenX, y: screenY };
      const relX = screenX - rect.left;
      const relY = screenY - rect.top;
      return {
        x: (relX - transform.tx) / transform.scale,
        y: (relY - transform.ty) / transform.scale,
      };
    },
    [transform],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handlePointerDown = (e: PointerEvent) => {
      const tool = toolRef.current;

      if (tool === "brush" && engine) {
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
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.buttons === 0) return;
      const tool = toolRef.current;

      if (tool === "brush" && engine) {
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
      } else if (tool === "zoom" && dragStart.current) {
        const dx = e.clientX - dragStart.current.x;
        dragStart.current = { x: e.clientX, y: e.clientY };
        zoom(-dx, e.clientX, e.clientY);
      }
    };

    const handlePointerUp = (_e: PointerEvent) => {
      if (toolRef.current === "brush" && engine) {
        engine.strokeEnd();
      }
      dragStart.current = null;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoom(e.deltaY, e.clientX, e.clientY);
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
  }, [engine, screenToCanvas, pan, zoom]);

  // Resize canvas to fill the viewport
  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.floor(width);
        canvas.height = Math.floor(height);
      }
    });

    observer.observe(viewport);
    return () => observer.disconnect();
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
