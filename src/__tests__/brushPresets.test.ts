import { describe, it, expect } from "vitest";
import { DEFAULT_PRESETS } from "../brushPresets";
import type { WetMediaSettings, MediumType } from "../hooks/useBrushSettings";

describe("brushPresets", () => {
  const wetMediaPresets = DEFAULT_PRESETS.filter((p) => p.wetMedia?.enabled);

  it("should have unique preset IDs", () => {
    const ids = DEFAULT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all wet media presets specify a mediumType", () => {
    for (const preset of wetMediaPresets) {
      expect(preset.wetMedia!.mediumType).toBeDefined();
      expect(["Oil", "Acrylic", "Watercolor"]).toContain(preset.wetMedia!.mediumType);
    }
  });

  it("Oil group presets have mediumType Oil", () => {
    const oilPresets = DEFAULT_PRESETS.filter((p) => p.group === "Oil");
    expect(oilPresets.length).toBeGreaterThan(0);
    for (const preset of oilPresets) {
      expect(preset.wetMedia!.mediumType).toBe("Oil");
    }
  });

  it("Acrylic group presets have mediumType Acrylic", () => {
    const acrylicPresets = DEFAULT_PRESETS.filter((p) => p.group === "Acrylic");
    expect(acrylicPresets.length).toBeGreaterThan(0);
    for (const preset of acrylicPresets) {
      expect(preset.wetMedia!.mediumType).toBe("Acrylic");
    }
  });

  it("all wet media presets have valid parameter ranges", () => {
    for (const preset of wetMediaPresets) {
      const wm = preset.wetMedia!;
      expect(wm.paintLoad).toBeGreaterThanOrEqual(0);
      expect(wm.paintLoad).toBeLessThanOrEqual(1);
      expect(wm.paintThickness).toBeGreaterThanOrEqual(0);
      expect(wm.paintThickness).toBeLessThanOrEqual(1);
      expect(wm.wetness).toBeGreaterThanOrEqual(0);
      expect(wm.wetness).toBeLessThanOrEqual(1);
      expect(wm.mixingStrength).toBeGreaterThanOrEqual(0);
      expect(wm.mixingStrength).toBeLessThanOrEqual(1);
      expect(wm.viscosity).toBeGreaterThanOrEqual(0);
      expect(wm.viscosity).toBeLessThanOrEqual(1);
      expect(wm.bristleStiffness).toBeGreaterThanOrEqual(0.01);
      expect(wm.bristleStiffness).toBeLessThanOrEqual(1);
      expect(wm.bristleCount).toBeGreaterThanOrEqual(1);
      expect(wm.bristleCount).toBeLessThanOrEqual(256);
      expect(wm.bristleSpread).toBeGreaterThanOrEqual(0);
      expect(wm.bristleSpread).toBeLessThanOrEqual(1);
      expect(wm.paintDepletionRate).toBeGreaterThanOrEqual(0);
      expect(wm.paintDepletionRate).toBeLessThanOrEqual(1);
      expect(wm.canvasTextureStrength).toBeGreaterThanOrEqual(0);
      expect(wm.canvasTextureStrength).toBeLessThanOrEqual(1);
    }
  });

  it("includes expected oil presets", () => {
    const oilNames = DEFAULT_PRESETS.filter((p) => p.group === "Oil").map((p) => p.name);
    expect(oilNames).toContain("Oil Flat");
    expect(oilNames).toContain("Oil Round");
    expect(oilNames).toContain("Palette Knife");
    expect(oilNames).toContain("Oil Filbert");
    expect(oilNames).toContain("Oil Impasto");
    expect(oilNames).toContain("Oil Glaze");
    expect(oilNames).toContain("Dry Brush");
  });

  it("includes expected acrylic presets", () => {
    const acrylicNames = DEFAULT_PRESETS.filter((p) => p.group === "Acrylic").map((p) => p.name);
    expect(acrylicNames).toContain("Acrylic Flat");
    expect(acrylicNames).toContain("Acrylic Wash");
    expect(acrylicNames).toContain("Acrylic Heavy Body");
  });

  it("all presets have valid base properties", () => {
    for (const preset of DEFAULT_PRESETS) {
      expect(preset.size).toBeGreaterThan(0);
      expect(preset.spacing).toBeGreaterThan(0);
      expect(preset.roundness).toBeGreaterThan(0);
      expect(preset.roundness).toBeLessThanOrEqual(1);
      expect(preset.angle).toBeGreaterThanOrEqual(0);
      expect(preset.angle).toBeLessThanOrEqual(360);
    }
  });
});
