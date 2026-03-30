import { useRef, useState, useEffect, useCallback, useMemo, type RefObject } from "react";
import type { Engine } from "../engine";
import type { Tool } from "../hooks/useTool";
import type { ViewTransform } from "../hooks/useViewTransform";
import type { SerializableBrushSettings } from "../hooks/useBrushSettings";
import { StrokeSmoother } from "../strokeSmoothing";
import { extractStylusPoint } from "../lib/stylusInput";
import { StrokeInterpolator } from "../lib/strokeInterpolator";

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
  smoothing: number;
  transform: ViewTransform;
  activeLayerKind?: "raster" | "gradient-map";
  pan: (dx: number, dy: number) => void;
  zoom: (delta: number, cx: number, cy: number) => void;
  onColorPick?: (hex: string) => void;
  fitToViewport?: (canvasW: number, canvasH: number, viewportW: number, viewportH: number) => void;
  /** Called at stroke start to get the current brush settings blob for the engine. */
  getStrokeSettings?: () => SerializableBrushSettings;
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
  // brushSize is the diameter at full pressure. Brush radius = size * pressure / 2,
  // so the diameter at full pressure equals brushSize.
  const diameter = Math.round(brushSize * scale);
  if (diameter < MIN_CURSOR_PX || diameter > MAX_CURSOR_PX) {
    return "crosshair";
  }
  const r = diameter / 2;
  const size = diameter + 2; // 1px padding for stroke
  const center = size / 2;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='black' stroke-width='1.5'/><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='white' stroke-width='0.5'/></svg>`;
  const encoded = encodeURIComponent(svg);
  const hotspot = Math.round(center);
  return `url("data:image/svg+xml,${encoded}") ${hotspot} ${hotspot}, crosshair`;
}

export function CanvasViewport({
  canvasRef,
  engine,
  activeTool,
  brushSize,
  smoothing,
  transform,
  activeLayerKind,
  pan,
  zoom,
  onColorPick,
  fitToViewport: fitToViewportFn,
  getStrokeSettings,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(
    null,
  );

  const canPaint = activeLayerKind === "raster" || activeLayerKind === undefined;

  const cursor = useMemo(() => {
    if ((activeTool === "brush" || activeTool === "eraser") && !canPaint) {
      return "not-allowed";
    }
    if (activeTool === "brush" || activeTool === "eraser") {
      return buildCircleCursor(brushSize, transform.scale);
    }
    return cursorMap[activeTool];
  }, [activeTool, brushSize, transform.scale, canPaint]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const marqueeMode = useRef<number>(0);
  const lassoMode = useRef<number>(0);
  const lassoPreviewPoints = useRef<{ x: number; y: number }[]>([]);
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  const layerKindRef = useRef(activeLayerKind);
  layerKindRef.current = activeLayerKind;
  const smootherRef = useRef(new StrokeSmoother());
  const smoothingRef = useRef(smoothing);
  smoothingRef.current = smoothing;
  /** Stroke interpolator for wet media bristle strokes (spline + sub-stepping). */
  const interpolatorRef = useRef<StrokeInterpolator | null>(null);
  /** Whether the current stroke is a wet media stroke using the interpolator. */
  const wetStrokeActiveRef = useRef(false);

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
      } else if ((tool === "brush" || tool === "eraser") && engine && getStrokeSettings) {
        if (layerKindRef.current !== "raster" && layerKindRef.current !== undefined) return;
        viewport.setPointerCapture(e.pointerId);
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        const settings = getStrokeSettings();
        const isWetMedia = settings.brush_model === "WetMedia";

        if (isWetMedia) {
          // Wet media: use spline interpolator with full stylus telemetry
          const stylusPt = extractStylusPoint(e, x, y);
          const interp = new StrokeInterpolator(settings.size / 2);
          interpolatorRef.current = interp;
          wetStrokeActiveRef.current = true;
          const subPts = interp.addPoint(stylusPt);
          // First sub-point starts the stroke
          if (subPts.length > 0) {
            const sp = subPts[0];
            engine.strokeBeginWithStylus(
              engine.getActiveLayer(), stylusPt,
              { x: sp.velocity * Math.cos(sp.velocityAngle), y: sp.velocity * Math.sin(sp.velocityAngle) },
              settings,
            );
            // Additional sub-points as moves
            for (let i = 1; i < subPts.length; i++) {
              const mp = subPts[i];
              engine.strokeMoveWithStylus(
                engine.getActiveLayer(),
                { ...stylusPt, x: mp.x, y: mp.y, pressure: mp.pressure },
                { x: mp.velocity * Math.cos(mp.velocityAngle), y: mp.velocity * Math.sin(mp.velocityAngle) },
              );
            }
          }
        } else {
          // Standard stamp brush: use EMA smoother
          wetStrokeActiveRef.current = false;
          interpolatorRef.current = null;
          const pressure = e.pointerType === "pen" ? e.pressure : 1.0;
          const pt = smootherRef.current.begin(x, y, pressure, smoothingRef.current);
          engine.strokeBegin(
            engine.getActiveLayer(),
            pt.x,
            pt.y,
            pt.pressure,
            settings,
          );
        }
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
        if (wetStrokeActiveRef.current && interpolatorRef.current) {
          // Wet media: spline interpolation with sub-stepping
          for (const ce of events) {
            const { x, y } = screenToCanvas(ce.clientX, ce.clientY);
            const stylusPt = extractStylusPoint(ce, x, y);
            const subPts = interpolatorRef.current.addPoint(stylusPt);
            for (const mp of subPts) {
              engine.strokeMoveWithStylus(
                engine.getActiveLayer(),
                { ...stylusPt, x: mp.x, y: mp.y, pressure: mp.pressure, altitude: mp.altitude, azimuth: mp.azimuth, twist: mp.twist },
                { x: mp.velocity * Math.cos(mp.velocityAngle), y: mp.velocity * Math.sin(mp.velocityAngle) },
              );
            }
          }
        } else {
          // Standard stamp brush: EMA smoother
          for (const ce of events) {
            const { x, y } = screenToCanvas(ce.clientX, ce.clientY);
            const pressure = ce.pointerType === "pen" ? ce.pressure : 1.0;
            const pt = smootherRef.current.move(x, y, pressure);
            engine.strokeMove(
              engine.getActiveLayer(),
              pt.x,
              pt.y,
              pt.pressure,
            );
          }
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
        if (wetStrokeActiveRef.current && interpolatorRef.current) {
          // Wet media: emit final spline segment
          const { x, y } = screenToCanvas(e.clientX, e.clientY);
          const stylusPt = extractStylusPoint(e, x, y);
          interpolatorRef.current.addPoint(stylusPt);
          const finalPts = interpolatorRef.current.finish();
          for (const mp of finalPts) {
            engine.strokeMoveWithStylus(
              engine.getActiveLayer(),
              { ...stylusPt, x: mp.x, y: mp.y, pressure: mp.pressure, altitude: mp.altitude, azimuth: mp.azimuth, twist: mp.twist },
              { x: mp.velocity * Math.cos(mp.velocityAngle), y: mp.velocity * Math.sin(mp.velocityAngle) },
            );
          }
          interpolatorRef.current = null;
          wetStrokeActiveRef.current = false;
        } else {
          // Standard stamp brush: EMA smoother catch-up
          const { x, y } = screenToCanvas(e.clientX, e.clientY);
          const pressure = e.pointerType === "pen" ? e.pressure : 1.0;
          const catchUp = smootherRef.current.end(x, y, pressure);
          if (catchUp) {
            engine.strokeMove(
              engine.getActiveLayer(),
              catchUp.x,
              catchUp.y,
              catchUp.pressure,
            );
          }
        }
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
  }, [engine, screenToCanvas, toViewportLocal, pan, zoom, onColorPick, updateOverlay, getStrokeSettings]);

  // Read canvas document size from the canvas element (set by useEngine
  // from the document dimensions). Viewport resizes do not change it —
  // pan/zoom CSS transforms handle the viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    setCanvasSize({ w: canvas.width, h: canvas.height });
    // Center canvas in viewport on first load
    if (fitToViewportFn && viewport) {
      const rect = viewport.getBoundingClientRect();
      fitToViewportFn(canvas.width, canvas.height, rect.width, rect.height);
    }
  }, [canvasRef, engine, fitToViewportFn]);

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
