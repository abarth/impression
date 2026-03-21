import { useState, useRef, useEffect, useCallback } from "react";
import { hexToOklch, oklchToHex, oklchToSrgb, maxChroma, isInGamut } from "../lib/oklch";
import { ExternalLink } from "lucide-react";

interface OklchColorPickerProps {
  color: string;
  onChange: (hex: string) => void;
}

const AREA_SIZE = 180;
const HUE_WIDTH = 180;
const HUE_HEIGHT = 14;
const THUMB_SIZE = 18;
const MAX_CHROMA = 0.4;

// Out-of-gamut background color (graphite-900)
const OOG_R = 0x30;
const OOG_G = 0x2b;
const OOG_B = 0x28;

export function OklchColorPicker({ color, onChange }: OklchColorPickerProps) {
  const [lch, setLch] = useState(() => hexToOklch(color));
  const [hexInput, setHexInput] = useState(color);
  const internalChange = useRef(false);

  const areaCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const areaContainerRef = useRef<HTMLDivElement>(null);
  const hueContainerRef = useRef<HTMLDivElement>(null);

  // Sync from external prop changes
  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false;
      return;
    }
    const parsed = hexToOklch(color);
    setLch(parsed);
    setHexInput(color);
  }, [color]);

  // Render 2D area canvas when hue changes
  useEffect(() => {
    const canvas = areaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const res = Math.round(AREA_SIZE * dpr);
    canvas.width = res;
    canvas.height = res;

    const img = ctx.createImageData(res, res);
    const data = img.data;

    for (let y = 0; y < res; y++) {
      const c = ((res - 1 - y) / (res - 1)) * MAX_CHROMA;
      for (let x = 0; x < res; x++) {
        const l = x / (res - 1);
        const rgb = oklchToSrgb(l, c, lch.h);
        const idx = (y * res + x) * 4;
        if (rgb) {
          data[idx] = Math.round(rgb[0] * 255);
          data[idx + 1] = Math.round(rgb[1] * 255);
          data[idx + 2] = Math.round(rgb[2] * 255);
        } else {
          data[idx] = OOG_R;
          data[idx + 1] = OOG_G;
          data[idx + 2] = OOG_B;
        }
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }, [lch.h]);

  // Render hue strip based on current L and C
  useEffect(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resW = Math.round(HUE_WIDTH * dpr);
    const resH = Math.round(HUE_HEIGHT * dpr);
    canvas.width = resW;
    canvas.height = resH;

    const img = ctx.createImageData(resW, 1);
    const data = img.data;

    for (let x = 0; x < resW; x++) {
      const hue = (x / (resW - 1)) * 360;
      const rgb = oklchToSrgb(lch.l, lch.c, hue);
      const idx = x * 4;
      if (rgb) {
        data[idx] = Math.round(rgb[0] * 255);
        data[idx + 1] = Math.round(rgb[1] * 255);
        data[idx + 2] = Math.round(rgb[2] * 255);
      } else {
        data[idx] = OOG_R;
        data[idx + 1] = OOG_G;
        data[idx + 2] = OOG_B;
      }
      data[idx + 3] = 255;
    }

    // Stretch the single row to fill the canvas height
    for (let y = 0; y < resH; y++) {
      ctx.putImageData(img, 0, y);
    }
  }, [lch.l, lch.c]);

  const emitChange = useCallback(
    (l: number, c: number, h: number) => {
      const hex = oklchToHex(l, c, h);
      setHexInput(hex);
      internalChange.current = true;
      onChange(hex);
    },
    [onChange],
  );

  // --- Pointer handling for 2D area ---
  const handleAreaPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = areaContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const l = x;
      const rawC = (1 - y) * MAX_CHROMA;
      const mc = maxChroma(l, lch.h);
      const c = Math.min(rawC, mc);
      const newLch = { l, c, h: lch.h };
      setLch(newLch);
      emitChange(newLch.l, newLch.c, newLch.h);
    },
    [lch.h, emitChange],
  );

  const onAreaPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handleAreaPointer(e.clientX, e.clientY);
    },
    [handleAreaPointer],
  );

  const onAreaPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons === 0) return;
      handleAreaPointer(e.clientX, e.clientY);
    },
    [handleAreaPointer],
  );

  // --- Pointer handling for hue strip ---
  const handleHuePointer = useCallback(
    (clientX: number) => {
      const container = hueContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const h = x * 360;
      // Only move to this hue if the current L/C is in gamut there
      if (!isInGamut(lch.l, lch.c, h)) return;
      const newLch = { l: lch.l, c: lch.c, h };
      setLch(newLch);
      emitChange(newLch.l, newLch.c, newLch.h);
    },
    [lch.l, lch.c, emitChange],
  );

  const onHuePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handleHuePointer(e.clientX);
    },
    [handleHuePointer],
  );

  const onHuePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons === 0) return;
      handleHuePointer(e.clientX);
    },
    [handleHuePointer],
  );

  // --- Hex input ---
  const onHexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setHexInput(val);
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        const parsed = hexToOklch(val);
        setLch(parsed);
        internalChange.current = true;
        onChange(val.toLowerCase());
      }
    },
    [onChange],
  );

  const onHexBlur = useCallback(() => {
    // Revert to current color if invalid
    setHexInput(oklchToHex(lch.l, lch.c, lch.h));
  }, [lch]);

  // Thumb positions
  const thumbLeft = lch.l * 100;
  const thumbTop = (1 - lch.c / MAX_CHROMA) * 100;
  const hueLeft = (lch.h / 360) * 100;

  // Formatted display values
  const lPct = (lch.l * 100).toFixed(1);
  const cVal = lch.c.toFixed(4);
  const hVal = lch.h.toFixed(1);

  // oklch.com link with current color
  const oklchUrl = `https://oklch.com/#${lPct},${cVal},${hVal},100`;

  return (
    <div className="flex flex-col gap-3" style={{ width: AREA_SIZE }}>
      {/* Title with oklch.com link */}
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
          OKLCH
        </h4>
        <a
          href={oklchUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View on oklch.com"
          className="flex items-center gap-1 text-[10px] text-cream-muted/50
            hover:text-cream-muted transition-colors duration-150"
        >
          oklch.com
          <ExternalLink size={9} strokeWidth={2} />
        </a>
      </div>

      {/* 2D Lightness × Chroma area */}
      <div
        ref={areaContainerRef}
        className="relative rounded-lg overflow-hidden cursor-crosshair"
        style={{ width: AREA_SIZE, height: AREA_SIZE }}
        onPointerDown={onAreaPointerDown}
        onPointerMove={onAreaPointerMove}
      >
        <canvas
          ref={areaCanvasRef}
          className="block"
          style={{
            width: AREA_SIZE,
            height: AREA_SIZE,
            imageRendering: "auto",
          }}
        />
        {/* Thumb */}
        <div
          className="absolute pointer-events-none rounded-full border-[2.5px] border-white shadow-soft"
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            left: `${thumbLeft}%`,
            top: `${thumbTop}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: oklchToHex(lch.l, lch.c, lch.h),
          }}
        />
      </div>

      {/* Hue strip */}
      <div
        ref={hueContainerRef}
        className="relative rounded-full overflow-hidden cursor-pointer"
        style={{ width: HUE_WIDTH, height: HUE_HEIGHT }}
        onPointerDown={onHuePointerDown}
        onPointerMove={onHuePointerMove}
      >
        <canvas
          ref={hueCanvasRef}
          className="block"
          style={{
            width: HUE_WIDTH,
            height: HUE_HEIGHT,
            imageRendering: "auto",
          }}
        />
        {/* Hue thumb */}
        <div
          className="absolute pointer-events-none rounded-full border-[2.5px] border-white shadow-soft"
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            left: `${hueLeft}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: oklchToHex(lch.l, Math.min(lch.c, maxChroma(lch.l, lch.h)), lch.h),
          }}
        />
      </div>

      {/* Numerical OKLCH values */}
      <div className="grid grid-cols-3 gap-1">
        <div className="flex flex-col items-center rounded-md bg-graphite-850 px-1.5 py-1">
          <span className="text-[9px] text-cream-muted/60 uppercase tracking-wider">L</span>
          <span className="text-[11px] text-cream-dim font-mono">{lPct}%</span>
        </div>
        <div className="flex flex-col items-center rounded-md bg-graphite-850 px-1.5 py-1">
          <span className="text-[9px] text-cream-muted/60 uppercase tracking-wider">C</span>
          <span className="text-[11px] text-cream-dim font-mono">{cVal}</span>
        </div>
        <div className="flex flex-col items-center rounded-md bg-graphite-850 px-1.5 py-1">
          <span className="text-[9px] text-cream-muted/60 uppercase tracking-wider">H</span>
          <span className="text-[11px] text-cream-dim font-mono">{hVal}°</span>
        </div>
      </div>

      {/* Hex input */}
      <input
        type="text"
        value={hexInput}
        onChange={onHexChange}
        onBlur={onHexBlur}
        className="w-full bg-graphite-850 text-cream-dim text-[11px] px-2.5 py-1.5
          rounded-lg border border-graphite-750 outline-none
          focus:border-warm-accent transition-all duration-150
          font-mono"
        spellCheck={false}
      />
    </div>
  );
}
