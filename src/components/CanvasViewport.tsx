import { useRef, useState, useEffect, useCallback, useMemo, type RefObject } from "react";
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
  brushSize: number;
  transform: ViewTransform;
  pan: (dx: number, dy: number) => void;
  zoom: (delta: number, cx: number, cy: number) => void;
  onColorPick?: (hex: string) => void;
}

const cursorMap: Record<Tool, string> = {
  brush: "crosshair",
  eraser: "crosshair",
  pan: "grab",
  zoom: "zoom-in",
  eyedropper: "crosshair",
  marquee: "crosshair",
  lasso: "crosshair",
};

/** Min/max cursor image size in CSS pixels. Browsers cap at ~128px. */
const MIN_CURSOR_PX = 4;
const MAX_CURSOR_PX = 128;

/** Build a circle-outline cursor CSS value for brush/eraser tools. */
function buildCircleCursor(brushSize: number, scale: number): string {
  const diameter = Math.round(brushSize * scale);
  if (diameter < MIN_CURSOR_PX || diameter > MAX_CURSOR_PX) {
    return "crosshair";
  }
  const r = diameter / 2;
  const size = diameter + 2; // 1px padding for stroke
  const center = size / 2;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='white' stroke-width='1'/><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='black' stroke-width='1' stroke-dasharray='2,2'/></svg>`;
  const encoded = encodeURIComponent(svg);
  const hotspot = Math.round(center);
  return `url("data:image/svg+xml,${encoded}") ${hotspot} ${hotspot}, crosshair`;
}

export function CanvasViewport({
  canvasRef,
  engine,
  activeTool,
  brushSize,
  transform,
  pan,
  zoom,
  onColorPick,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(
    null,
  );

  const cursor = useMemo(() => {
    if (activeTool === "brush" || activeTool === "eraser") {
      return buildCircleCursor(brushSize, transform.scale);
    }
    return cursorMap[activeTool];
  }, [activeTool, brushSize, transform.scale]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const marqueeMode = useRef<number>(0);
  const lassoMode = useRef<number>(0);
  const lassoPreviewPoints = useRef<{ x: number; y: number }[]>([]);
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;

  /** Update the SVG selection preview overlay. */
  const updateOverlay = useCallback(
    (
      type: "marquee" | "lasso" | "clear",
      rect?: { x: number; y: number; w: number; h: number },
    ) => {
      const svg = overlayRef.current;
      const canvas = canvasRef.current;
      if (!svg || !canvas) return;

      svg.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
      svg.style.width = `${canvas.width}px`;
      svg.style.height = `${canvas.height}px`;

      if (type === "clear") {
        svg.innerHTML = "";
        return;
      }

      if (type === "marquee" && rect) {
        svg.innerHTML =
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" ` +
          `fill="none" stroke="white" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" ` +
          `fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,4" vector-effect="non-scaling-stroke"/>`;
      } else if (type === "lasso") {
        const pts = lassoPreviewPoints.current;
        if (pts.length < 2) return;
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        svg.innerHTML =
          `<path d="${d}" fill="none" stroke="white" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
          `<path d="${d}" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,4" vector-effect="non-scaling-stroke"/>`;
      }
    },
    [canvasRef],
  );

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
        lassoPreviewPoints.current = [];
        engine.selectionLassoBegin();
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        engine.selectionLassoPoint(x, y);
        lassoPreviewPoints.current.push({ x, y });
      } else if ((tool === "brush" || tool === "eraser") && engine) {
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

      if (tool === "marquee" && engine && marqueeStart.current) {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        const sx = marqueeStart.current.x;
        const sy = marqueeStart.current.y;
        const rx = Math.min(sx, x);
        const ry = Math.min(sy, y);
        const rw = Math.abs(x - sx);
        const rh = Math.abs(y - sy);
        updateOverlay("marquee", { x: rx, y: ry, w: rw, h: rh });
      } else if (tool === "lasso" && engine) {
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const ce of events) {
          const { x, y } = screenToCanvas(ce.clientX, ce.clientY);
          engine.selectionLassoPoint(x, y);
          lassoPreviewPoints.current.push({ x, y });
        }
        updateOverlay("lasso");
      } else if ((tool === "brush" || tool === "eraser") && engine) {
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
        updateOverlay("clear");
      } else if (tool === "lasso" && engine) {
        engine.selectionLassoEnd(lassoMode.current);
        lassoPreviewPoints.current = [];
        updateOverlay("clear");
      } else if ((tool === "brush" || tool === "eraser") && engine) {
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
  }, [engine, screenToCanvas, toViewportLocal, pan, zoom, onColorPick, updateOverlay]);

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
    setCanvasSize({ w: canvas.width, h: canvas.height });
  }, [canvasRef]);

  return (
    <div
      ref={viewportRef}
      className="flex-1 relative overflow-hidden bg-graphite-950"
      style={{
        touchAction: "none",
        cursor,
      }}
    >
      <div
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {canvasSize && (
          <div
            className="absolute checkerboard"
            style={{
              width: canvasSize.w,
              height: canvasSize.h,
              pointerEvents: "none",
            }}
          />
        )}
        <canvas ref={canvasRef} className="relative" />
        <svg
          ref={overlayRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
