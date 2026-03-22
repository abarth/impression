/**
 * Shared color utility functions.
 *
 * Centralizes hex/RGB conversion, clamping, and color-space transforms
 * that were previously duplicated across gradient.ts, grdParser.ts,
 * and useColorState.ts.
 */

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Parse a hex color string (with or without '#') to [r, g, b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Convert r, g, b (0-255) to a hex string like "#ff8040". Values are clamped. */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Convert HSB (hue 0-360, saturation 0-1, brightness 0-1) to [r, g, b] (0-255). */
export function hsbToRgb(
  h: number,
  s: number,
  v: number,
): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** Convert CIE Lab to [r, g, b] (0-255, approximate D65 illuminant). */
export function labToRgb(
  l: number,
  a: number,
  b: number,
): [number, number, number] {
  // Lab → XYZ (D65)
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const delta = 6 / 29;
  const invF = (t: number) =>
    t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29);

  // D65 reference white
  const xr = 0.95047 * invF(fx);
  const yr = 1.0 * invF(fy);
  const zr = 1.08883 * invF(fz);

  // XYZ → sRGB
  let rr = 3.2406 * xr - 1.5372 * yr - 0.4986 * zr;
  let gg = -0.9689 * xr + 1.8758 * yr + 0.0415 * zr;
  let bb = 0.055 * xr - 0.204 * yr + 1.057 * zr;

  // Gamma
  const gamma = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  rr = gamma(Math.max(0, rr));
  gg = gamma(Math.max(0, gg));
  bb = gamma(Math.max(0, bb));

  return [
    Math.round(rr * 255),
    Math.round(gg * 255),
    Math.round(bb * 255),
  ];
}
