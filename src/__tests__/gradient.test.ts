import { describe, it, expect } from "vitest";
import {
  rasterizeGradient,
  hexToRgb,
  rgbToHex,
  blackToWhiteGradient,
  foregroundToTransparentGradient,
  type Gradient,
} from "../gradient";

describe("hexToRgb", () => {
  it("parses black", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("parses white", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  it("parses red", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
  });

  it("parses without hash", () => {
    expect(hexToRgb("00ff00")).toEqual([0, 255, 0]);
  });
});

describe("rgbToHex", () => {
  it("converts black", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });

  it("converts white", () => {
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });

  it("clamps values", () => {
    expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
  });
});

describe("rasterizeGradient", () => {
  it("rasterizes black-to-white gradient", () => {
    const gradient = blackToWhiteGradient();
    const buffer = rasterizeGradient(gradient);

    expect(buffer.length).toBe(256 * 4);

    // First pixel: black, full opacity
    expect(buffer[0]).toBe(0); // R
    expect(buffer[1]).toBe(0); // G
    expect(buffer[2]).toBe(0); // B
    expect(buffer[3]).toBe(255); // A

    // Last pixel: white, full opacity
    expect(buffer[255 * 4]).toBe(255);
    expect(buffer[255 * 4 + 1]).toBe(255);
    expect(buffer[255 * 4 + 2]).toBe(255);
    expect(buffer[255 * 4 + 3]).toBe(255);

    // Middle pixel: approximately gray
    const mid = 128 * 4;
    expect(buffer[mid]).toBeGreaterThan(100);
    expect(buffer[mid]).toBeLessThan(155);
  });

  it("rasterizes a foreground-to-transparent gradient", () => {
    const gradient = foregroundToTransparentGradient();
    const buffer = rasterizeGradient(gradient);

    // First pixel: black, full opacity
    expect(buffer[0]).toBe(0);
    expect(buffer[3]).toBe(255);

    // Last pixel: black, transparent
    expect(buffer[255 * 4]).toBe(0);
    expect(buffer[255 * 4 + 3]).toBe(0);
  });

  it("handles a single color stop", () => {
    const gradient: Gradient = {
      id: "test",
      name: "test",
      group: "test",
      colorStops: [{ position: 0.5, color: "#ff0000", midpoint: 0.5 }],
      opacityStops: [{ position: 0, opacity: 1, midpoint: 0.5 }],
      smoothness: 0,
      sort_order: 0,
    };
    const buffer = rasterizeGradient(gradient);

    // All pixels should be red
    for (let i = 0; i < 256; i++) {
      expect(buffer[i * 4]).toBe(255); // R
      expect(buffer[i * 4 + 1]).toBe(0); // G
      expect(buffer[i * 4 + 2]).toBe(0); // B
    }
  });

  it("handles multiple color stops", () => {
    const gradient: Gradient = {
      id: "test",
      name: "test",
      group: "test",
      colorStops: [
        { position: 0, color: "#ff0000", midpoint: 0.5 },
        { position: 0.5, color: "#00ff00", midpoint: 0.5 },
        { position: 1, color: "#0000ff", midpoint: 0.5 },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };
    const buffer = rasterizeGradient(gradient);

    // Position 0: red
    expect(buffer[0]).toBe(255);
    expect(buffer[1]).toBe(0);
    expect(buffer[2]).toBe(0);

    // Position 0.5 (pixel 128): green
    const midIdx = 128 * 4;
    expect(buffer[midIdx]).toBeLessThan(10); // R near 0
    expect(buffer[midIdx + 1]).toBeGreaterThan(245); // G near 255
    expect(buffer[midIdx + 2]).toBeLessThan(10); // B near 0

    // Position 1: blue
    const endIdx = 255 * 4;
    expect(buffer[endIdx]).toBe(0);
    expect(buffer[endIdx + 1]).toBe(0);
    expect(buffer[endIdx + 2]).toBe(255);
  });

  it("midpoint shifts interpolation center", () => {
    // Midpoint at 0.25: color reaches halfway point earlier
    const gradientLow: Gradient = {
      id: "test",
      name: "test",
      group: "test",
      colorStops: [
        { position: 0, color: "#000000", midpoint: 0.25 },
        { position: 1, color: "#ffffff", midpoint: 0.5 },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };

    // Midpoint at 0.75: color reaches halfway point later
    const gradientHigh: Gradient = {
      ...gradientLow,
      colorStops: [
        { position: 0, color: "#000000", midpoint: 0.75 },
        { position: 1, color: "#ffffff", midpoint: 0.5 },
      ],
    };

    const bufferLow = rasterizeGradient(gradientLow);
    const bufferHigh = rasterizeGradient(gradientHigh);

    // At position 0.25 (pixel 64), low-midpoint should be brighter
    // because the midpoint pulls the 50% mark earlier
    const pxIdx = 64 * 4;
    expect(bufferLow[pxIdx]).toBeGreaterThan(bufferHigh[pxIdx]);
  });

  it("opacity stops work independently of color stops", () => {
    const gradient: Gradient = {
      id: "test",
      name: "test",
      group: "test",
      colorStops: [
        { position: 0, color: "#ffffff", midpoint: 0.5 },
        { position: 1, color: "#ffffff", midpoint: 0.5 },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 0.5, opacity: 0, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };
    const buffer = rasterizeGradient(gradient);

    // Start: full opacity
    expect(buffer[3]).toBe(255);

    // Middle: transparent
    const mid = 128 * 4 + 3;
    expect(buffer[mid]).toBeLessThan(5);

    // End: full opacity
    expect(buffer[255 * 4 + 3]).toBe(255);
  });

  it("smoothness affects interpolation curve", () => {
    const makeGradient = (smoothness: number): Gradient => ({
      id: "test",
      name: "test",
      group: "test",
      colorStops: [
        { position: 0, color: "#000000", midpoint: 0.5 },
        { position: 1, color: "#ffffff", midpoint: 0.5 },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness,
      sort_order: 0,
    });

    const linear = rasterizeGradient(makeGradient(0));
    const smooth = rasterizeGradient(makeGradient(100));

    // At endpoints they should be the same
    expect(linear[0]).toBe(smooth[0]); // both black
    expect(linear[255 * 4]).toBe(smooth[255 * 4]); // both white

    // In the middle they differ (smoothstep is flatter at edges)
    // At 25% position, smoothstep should be darker (closer to start)
    const q1 = 64 * 4;
    expect(smooth[q1]).toBeLessThan(linear[q1]);
  });

  it("empty color stops produce black", () => {
    const gradient: Gradient = {
      id: "test",
      name: "test",
      group: "test",
      colorStops: [],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };
    const buffer = rasterizeGradient(gradient);

    for (let i = 0; i < 256; i++) {
      expect(buffer[i * 4]).toBe(0);
      expect(buffer[i * 4 + 1]).toBe(0);
      expect(buffer[i * 4 + 2]).toBe(0);
    }
  });

  it("output buffer is exactly 1024 bytes", () => {
    const gradient = blackToWhiteGradient();
    const buffer = rasterizeGradient(gradient);
    expect(buffer.length).toBe(1024);
    expect(buffer).toBeInstanceOf(Uint8Array);
  });

  it("substitutes foreground color for foreground-type stops", () => {
    const gradient: Gradient = {
      id: "test-fg",
      name: "FG to White",
      group: "test",
      colorStops: [
        { position: 0, color: "#000000", midpoint: 0.5, colorType: "foreground" },
        { position: 1, color: "#ffffff", midpoint: 0.5 },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };

    // Without fg color, uses the stored #000000
    const bufDefault = rasterizeGradient(gradient);
    expect(bufDefault[0]).toBe(0); // R at position 0

    // With red fg color, position 0 should be red
    const bufRed = rasterizeGradient(gradient, "#ff0000");
    expect(bufRed[0]).toBe(255); // R
    expect(bufRed[1]).toBe(0);   // G
    expect(bufRed[2]).toBe(0);   // B
  });

  it("substitutes background color for background-type stops", () => {
    const gradient: Gradient = {
      id: "test-bg",
      name: "Black to BG",
      group: "test",
      colorStops: [
        { position: 0, color: "#000000", midpoint: 0.5 },
        { position: 1, color: "#ffffff", midpoint: 0.5, colorType: "background" },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };

    // With blue bg, position 255 should be blue
    const buf = rasterizeGradient(gradient, undefined, "#0000ff");
    const lastPixel = 255 * 4;
    expect(buf[lastPixel + 0]).toBe(0);   // R
    expect(buf[lastPixel + 1]).toBe(0);   // G
    expect(buf[lastPixel + 2]).toBe(255); // B
  });

  it("user-type stops ignore foreground/background overrides", () => {
    const gradient: Gradient = {
      id: "test-user",
      name: "Red to Blue",
      group: "test",
      colorStops: [
        { position: 0, color: "#ff0000", midpoint: 0.5, colorType: "user" },
        { position: 1, color: "#0000ff", midpoint: 0.5, colorType: "user" },
      ],
      opacityStops: [
        { position: 0, opacity: 1, midpoint: 0.5 },
        { position: 1, opacity: 1, midpoint: 0.5 },
      ],
      smoothness: 0,
      sort_order: 0,
    };

    const buf = rasterizeGradient(gradient, "#00ff00", "#ffff00");
    // Position 0 should still be red (user type, not substituted)
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(0);
    expect(buf[2]).toBe(0);
  });
});
