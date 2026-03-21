/**
 * Gradient data model and rasterization.
 *
 * Gradients consist of color stops and opacity stops, each with positions
 * and midpoints. This matches Photoshop's gradient model, enabling .grd
 * file import and Gradient Map adjustment layers.
 */

export interface ColorStop {
  position: number; // 0.0 - 1.0
  color: string; // hex color, e.g. "#ff0000"
  midpoint: number; // 0.0 - 1.0, relative between this stop and the next (default 0.5)
}

export interface OpacityStop {
  position: number; // 0.0 - 1.0
  opacity: number; // 0.0 - 1.0
  midpoint: number; // 0.0 - 1.0, relative between this stop and the next (default 0.5)
}

export interface Gradient {
  id: string;
  name: string;
  group: string;
  colorStops: ColorStop[];
  opacityStops: OpacityStop[];
  smoothness: number; // 0 - 100
  sort_order: number;
}

/** Parse a hex color string to [r, g, b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Convert [r, g, b] (0-255) to hex string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Interpolation with midpoint adjustment.
 *
 * Photoshop midpoints shift the center of interpolation between two stops.
 * A midpoint of 0.5 is linear. Values < 0.5 pull the interpolation toward
 * the left stop, > 0.5 toward the right.
 *
 * The remapping uses the formula: t' = 0.5 * (t / midpoint) when t < midpoint,
 * and t' = 0.5 + 0.5 * ((t - midpoint) / (1 - midpoint)) when t >= midpoint.
 * This gives a piecewise-linear remap where the midpoint maps to 0.5.
 */
function remapWithMidpoint(t: number, midpoint: number): number {
  const mp = Math.max(0.001, Math.min(0.999, midpoint));
  if (t <= mp) {
    return (0.5 * t) / mp;
  } else {
    return 0.5 + (0.5 * (t - mp)) / (1 - mp);
  }
}

/**
 * Apply smoothness to an interpolation factor.
 * Smoothness 0 = linear, 100 = fully smoothed (smoothstep).
 */
function applySmooth(t: number, smoothness: number): number {
  if (smoothness <= 0) return t;
  const s = smoothness / 100;
  // Hermite smoothstep: 3t² - 2t³
  const smooth = t * t * (3 - 2 * t);
  return t + s * (smooth - t);
}

/**
 * Find the two enclosing stops for a given position and compute
 * the interpolation factor between them (with midpoint and smoothness).
 * Returns [leftIndex, rightIndex, interpolatedT] or null if clamped to an edge.
 */
function findInterpolation<T extends { position: number; midpoint: number }>(
  stops: T[],
  pos: number,
  smoothness: number,
): { left: number; right: number; t: number } | null {
  if (stops.length <= 1) return null;

  // Clamp to edges
  if (pos <= stops[0].position) return null;
  if (pos >= stops[stops.length - 1].position) return null;

  // Find enclosing stops
  let left = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].position >= pos) {
      left = i - 1;
      break;
    }
  }
  const right = left + 1;

  const leftStop = stops[left];
  const rightStop = stops[right];
  const range = rightStop.position - leftStop.position;
  if (range <= 0) return null;

  let t = (pos - leftStop.position) / range;
  t = remapWithMidpoint(t, leftStop.midpoint);
  t = applySmooth(t, smoothness);

  return { left, right, t };
}

/**
 * Rasterize a gradient to a 256×1 RGBA pixel buffer (1024 bytes).
 * Each pixel is [R, G, B, A] with values 0-255.
 */
export function rasterizeGradient(gradient: Gradient): Uint8Array {
  const width = 256;
  const buffer = new Uint8Array(width * 4);

  // Sort stops by position
  const colorStops = [...gradient.colorStops].sort(
    (a, b) => a.position - b.position,
  );
  const opacityStops = [...gradient.opacityStops].sort(
    (a, b) => a.position - b.position,
  );

  // Pre-parse colors
  const colorRgb = colorStops.map((s) => hexToRgb(s.color));

  for (let i = 0; i < width; i++) {
    const pos = i / (width - 1);

    // Interpolate RGB color
    let r: number, g: number, b: number;
    const colorInterp = findInterpolation(
      colorStops,
      pos,
      gradient.smoothness,
    );
    if (!colorInterp) {
      // Clamped to an edge stop
      const idx =
        colorStops.length === 0
          ? -1
          : pos <= colorStops[0].position
            ? 0
            : colorStops.length - 1;
      if (idx < 0) {
        r = g = b = 0;
      } else {
        [r, g, b] = colorRgb[idx];
      }
    } else {
      const [lr, lg, lb] = colorRgb[colorInterp.left];
      const [rr, rg, rb] = colorRgb[colorInterp.right];
      const t = colorInterp.t;
      r = lr + (rr - lr) * t;
      g = lg + (rg - lg) * t;
      b = lb + (rb - lb) * t;
    }

    // Interpolate opacity
    let a: number;
    const opacityInterp = findInterpolation(
      opacityStops,
      pos,
      gradient.smoothness,
    );
    if (!opacityInterp) {
      const idx =
        opacityStops.length === 0
          ? -1
          : pos <= opacityStops[0].position
            ? 0
            : opacityStops.length - 1;
      a = idx < 0 ? 1 : opacityStops[idx].opacity;
    } else {
      const lo = opacityStops[opacityInterp.left].opacity;
      const ro = opacityStops[opacityInterp.right].opacity;
      a = lo + (ro - lo) * opacityInterp.t;
    }

    const offset = i * 4;
    buffer[offset] = Math.round(Math.max(0, Math.min(255, r)));
    buffer[offset + 1] = Math.round(Math.max(0, Math.min(255, g)));
    buffer[offset + 2] = Math.round(Math.max(0, Math.min(255, b)));
    buffer[offset + 3] = Math.round(Math.max(0, Math.min(255, a * 255)));
  }

  return buffer;
}

/** Default gradient: black to white. */
export function blackToWhiteGradient(): Gradient {
  return {
    id: "default-black-white",
    name: "Black, White",
    group: "Default",
    colorStops: [
      { position: 0, color: "#000000", midpoint: 0.5 },
      { position: 1, color: "#ffffff", midpoint: 0.5 },
    ],
    opacityStops: [
      { position: 0, opacity: 1, midpoint: 0.5 },
      { position: 1, opacity: 1, midpoint: 0.5 },
    ],
    smoothness: 100,
    sort_order: 0,
  };
}

/** Default gradient: foreground to background (black to white placeholder). */
export function foregroundToBackgroundGradient(): Gradient {
  return {
    id: "default-fg-bg",
    name: "Foreground to Background",
    group: "Default",
    colorStops: [
      { position: 0, color: "#000000", midpoint: 0.5 },
      { position: 1, color: "#ffffff", midpoint: 0.5 },
    ],
    opacityStops: [
      { position: 0, opacity: 1, midpoint: 0.5 },
      { position: 1, opacity: 1, midpoint: 0.5 },
    ],
    smoothness: 100,
    sort_order: 1,
  };
}

/** Default gradient: foreground to transparent. */
export function foregroundToTransparentGradient(): Gradient {
  return {
    id: "default-fg-transparent",
    name: "Foreground to Transparent",
    group: "Default",
    colorStops: [
      { position: 0, color: "#000000", midpoint: 0.5 },
      { position: 1, color: "#000000", midpoint: 0.5 },
    ],
    opacityStops: [
      { position: 0, opacity: 1, midpoint: 0.5 },
      { position: 1, opacity: 0, midpoint: 0.5 },
    ],
    smoothness: 100,
    sort_order: 2,
  };
}

/** All default gradients. */
export const DEFAULT_GRADIENTS: Gradient[] = [
  blackToWhiteGradient(),
  foregroundToBackgroundGradient(),
  foregroundToTransparentGradient(),
];
