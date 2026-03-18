import { parse, converter, formatHex, displayable } from "culori";

const toOklch = converter("oklch");
const toRgb = converter("rgb");

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const color = parse(hex);
  if (!color) return { l: 0, c: 0, h: 0 };
  const oklch = toOklch(color);
  return {
    l: oklch.l ?? 0,
    c: oklch.c ?? 0,
    h: oklch.h ?? 0,
  };
}

export function oklchToHex(l: number, c: number, h: number): string {
  return formatHex({ mode: "oklch", l, c, h }) ?? "#000000";
}

export function isInGamut(l: number, c: number, h: number): boolean {
  return displayable({ mode: "oklch", l, c, h });
}

export function maxChroma(l: number, h: number): number {
  if (l <= 0 || l >= 1) return 0;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (displayable({ mode: "oklch", l, c: mid, h })) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function oklchToSrgb(
  l: number,
  c: number,
  h: number,
): [number, number, number] | null {
  const color = { mode: "oklch" as const, l, c, h };
  if (!displayable(color)) return null;
  const rgb = toRgb(color);
  return [rgb.r ?? 0, rgb.g ?? 0, rgb.b ?? 0];
}
