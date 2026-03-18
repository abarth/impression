import { describe, it, expect } from "vitest";
import { hexToOklch, oklchToHex, isInGamut, maxChroma } from "../lib/oklch";

describe("hexToOklch", () => {
  it("round-trips red", () => {
    const oklch = hexToOklch("#ff0000");
    const hex = oklchToHex(oklch.l, oklch.c, oklch.h);
    expect(hex).toBe("#ff0000");
  });

  it("round-trips blue", () => {
    const oklch = hexToOklch("#0000ff");
    const hex = oklchToHex(oklch.l, oklch.c, oklch.h);
    expect(hex).toBe("#0000ff");
  });

  it("handles black (achromatic)", () => {
    const oklch = hexToOklch("#000000");
    expect(oklch.l).toBeCloseTo(0, 2);
    expect(oklch.c).toBeCloseTo(0, 2);
  });

  it("handles white (achromatic)", () => {
    const oklch = hexToOklch("#ffffff");
    expect(oklch.l).toBeCloseTo(1, 2);
    expect(oklch.c).toBeCloseTo(0, 2);
  });

  it("handles gray (achromatic)", () => {
    const oklch = hexToOklch("#808080");
    expect(oklch.c).toBeCloseTo(0, 2);
    expect(oklch.l).toBeGreaterThan(0);
    expect(oklch.l).toBeLessThan(1);
  });
});

describe("maxChroma", () => {
  it("returns > 0 for mid-lightness", () => {
    const mc = maxChroma(0.5, 30);
    expect(mc).toBeGreaterThan(0);
  });

  it("returns 0 for L=0", () => {
    expect(maxChroma(0, 30)).toBe(0);
  });

  it("returns 0 for L=1", () => {
    expect(maxChroma(1, 30)).toBe(0);
  });
});

describe("isInGamut", () => {
  it("returns true for black", () => {
    expect(isInGamut(0, 0, 0)).toBe(true);
  });

  it("returns true for white", () => {
    expect(isInGamut(1, 0, 0)).toBe(true);
  });

  it("returns false for extreme chroma", () => {
    expect(isInGamut(0.5, 0.5, 150)).toBe(false);
  });
});
