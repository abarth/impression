import { describe, it, expect } from "vitest";
import { clamp, hexToRgb, rgbToHex, hsbToRgb, labToRgb } from "../colorUtils";

describe("clamp", () => {
  it("returns value when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clamp(-5, 0, 255)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(300, 0, 255)).toBe(255);
  });
});

describe("hexToRgb", () => {
  it("parses black", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("parses white", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  it("parses without hash", () => {
    expect(hexToRgb("ff8040")).toEqual([255, 128, 64]);
  });
});

describe("rgbToHex", () => {
  it("converts basic colors", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
    expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
    expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
  });

  it("clamps out-of-range values", () => {
    expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
  });
});

describe("hsbToRgb", () => {
  it("converts pure red (h=0, s=1, b=1)", () => {
    const [r, g, b] = hsbToRgb(0, 1, 1);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("converts pure green (h=120)", () => {
    const [r, g, b] = hsbToRgb(120, 1, 1);
    expect(r).toBe(0);
    expect(g).toBe(255);
    expect(b).toBe(0);
  });

  it("converts pure blue (h=240)", () => {
    const [r, g, b] = hsbToRgb(240, 1, 1);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(255);
  });

  it("converts black (b=0)", () => {
    const [r, g, b] = hsbToRgb(0, 0, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("converts white (s=0, b=1)", () => {
    const [r, g, b] = hsbToRgb(0, 0, 1);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });
});

describe("labToRgb", () => {
  it("converts L=0 to near-black", () => {
    const [r, g, b] = labToRgb(0, 0, 0);
    expect(r).toBeLessThan(5);
    expect(g).toBeLessThan(5);
    expect(b).toBeLessThan(5);
  });

  it("converts L=100 to near-white", () => {
    const [r, g, b] = labToRgb(100, 0, 0);
    expect(r).toBeGreaterThan(250);
    expect(g).toBeGreaterThan(250);
    expect(b).toBeGreaterThan(250);
  });

  it("converts L=50 to a midtone gray", () => {
    const [r, g, b] = labToRgb(50, 0, 0);
    expect(r).toBeGreaterThan(80);
    expect(r).toBeLessThan(200);
    // a=0, b=0 means neutral gray, so r ≈ g ≈ b
    expect(Math.abs(r - g)).toBeLessThan(5);
    expect(Math.abs(g - b)).toBeLessThan(5);
  });
});
