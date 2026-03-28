import { describe, it, expect } from "vitest";
import { generatePaperTexture, generateCanvasTexture, CANVAS_PRESETS } from "../paperTexture";
import type { CanvasType } from "../paperTexture";

describe("generatePaperTexture", () => {
  it("produces values in [0, 1]", () => {
    const data = generatePaperTexture(128, 128, 42);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it("returns correct size", () => {
    const data = generatePaperTexture(64, 32, 1);
    expect(data.length).toBe(64 * 32);
  });

  it("is deterministic for same seed", () => {
    const a = generatePaperTexture(64, 64, 99);
    const b = generatePaperTexture(64, 64, 99);
    expect(a).toEqual(b);
  });

  it("produces different results for different seeds", () => {
    const a = generatePaperTexture(64, 64, 1);
    const b = generatePaperTexture(64, 64, 2);
    // At least some values should differ
    let diffCount = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 0.001) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(a.length * 0.1);
  });

  it("has variation (not all same value)", () => {
    const data = generatePaperTexture(128, 128, 7);
    const min = Math.min(...data);
    const max = Math.max(...data);
    expect(max - min).toBeGreaterThan(0.1);
  });
});

describe("generateCanvasTexture", () => {
  const canvasTypes: CanvasType[] = ["fine_linen", "medium_cotton", "coarse_jute", "smooth_panel"];

  it("produces values in [0, 1] for all canvas types", () => {
    for (const ct of canvasTypes) {
      const data = generateCanvasTexture(128, 128, 42, ct);
      for (let i = 0; i < data.length; i++) {
        expect(data[i]).toBeGreaterThanOrEqual(0);
        expect(data[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns correct size", () => {
    const data = generateCanvasTexture(64, 32, 1, "medium_cotton");
    expect(data.length).toBe(64 * 32);
  });

  it("is deterministic for same seed and type", () => {
    const a = generateCanvasTexture(64, 64, 99, "coarse_jute");
    const b = generateCanvasTexture(64, 64, 99, "coarse_jute");
    expect(a).toEqual(b);
  });

  it("produces different results for different seeds", () => {
    const a = generateCanvasTexture(64, 64, 1, "fine_linen");
    const b = generateCanvasTexture(64, 64, 2, "fine_linen");
    let diffCount = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 0.001) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it("produces different textures for different canvas types", () => {
    const cotton = generateCanvasTexture(64, 64, 42, "medium_cotton");
    const jute = generateCanvasTexture(64, 64, 42, "coarse_jute");
    let diffCount = 0;
    for (let i = 0; i < cotton.length; i++) {
      if (Math.abs(cotton[i] - jute[i]) > 0.01) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(cotton.length * 0.1);
  });

  it("coarse jute has more height variation than smooth panel", () => {
    const jute = generateCanvasTexture(128, 128, 42, "coarse_jute");
    const panel = generateCanvasTexture(128, 128, 42, "smooth_panel");
    const range = (data: Float32Array) => {
      let min = Infinity, max = -Infinity;
      for (const v of data) { min = Math.min(min, v); max = Math.max(max, v); }
      return max - min;
    };
    expect(range(jute)).toBeGreaterThan(range(panel));
  });

  it("has weave pattern visible (periodic structure in medium cotton)", () => {
    const data = generateCanvasTexture(128, 128, 42, "medium_cotton");
    const spacing = CANVAS_PRESETS.medium_cotton.warpSpacing;
    // Sample a row and check for periodic peaks
    const row = Array.from(data.slice(64 * 128, 65 * 128));
    let peakCount = 0;
    for (let x = 1; x < row.length - 1; x++) {
      if (row[x] > row[x - 1] && row[x] > row[x + 1]) {
        peakCount++;
      }
    }
    // Should have roughly width/spacing peaks in one row
    const expectedPeaks = Math.floor(128 / spacing);
    expect(peakCount).toBeGreaterThan(expectedPeaks * 0.5);
  });

  it("all presets have valid parameter ranges", () => {
    for (const [name, preset] of Object.entries(CANVAS_PRESETS)) {
      expect(preset.warpSpacing).toBeGreaterThan(0);
      expect(preset.weftSpacing).toBeGreaterThan(0);
      expect(preset.threadWidth).toBeGreaterThan(0);
      expect(preset.threadWidth).toBeLessThanOrEqual(1);
      expect(preset.threadHeight).toBeGreaterThanOrEqual(0);
      expect(preset.threadHeight).toBeLessThanOrEqual(1);
      expect(preset.baseHeight).toBeGreaterThanOrEqual(0);
      expect(preset.baseHeight).toBeLessThanOrEqual(1);
      expect(preset.absorptionRate).toBeGreaterThanOrEqual(0);
      expect(preset.absorptionRate).toBeLessThanOrEqual(1);
    }
  });
});
