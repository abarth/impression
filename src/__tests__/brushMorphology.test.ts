import { describe, it, expect } from "vitest";
import {
  brushShapeToIndex,
  buildBristleInitParams,
  bristleBufferSize,
  writeBristleInitUniform,
  BRISTLE_STRIDE_F32,
  MAX_BRISTLE_COUNT,
} from "../lib/brushMorphology";
import type { WetMediaSettings } from "../hooks/useBrushSettings";

function defaultWetMedia(): WetMediaSettings {
  return {
    enabled: true,
    paintLoad: 0.8,
    paintThickness: 0.5,
    wetness: 0.7,
    mixingStrength: 0.5,
    bristleCount: 256,
    bristleSpread: 0.3,
    paintDepletionRate: 0.1,
    canvasTextureStrength: 0.3,
    mediumType: "Oil",
    viscosity: 0.7,
    bristleStiffness: 0.5,
    brushForm: 0.5,
    colorNoise: 0.0,
    speedSmudging: 0.3,
    brushShape: "Round",
    splittingThreshold: 0.3,
  };
}

describe("brushShapeToIndex", () => {
  it("maps Round to 0", () => {
    expect(brushShapeToIndex("Round")).toBe(0);
  });
  it("maps Flat to 1", () => {
    expect(brushShapeToIndex("Flat")).toBe(1);
  });
  it("maps Filbert to 2", () => {
    expect(brushShapeToIndex("Filbert")).toBe(2);
  });
  it("maps Fan to 3", () => {
    expect(brushShapeToIndex("Fan")).toBe(3);
  });
});

describe("buildBristleInitParams", () => {
  it("builds params from wet media settings", () => {
    const settings = defaultWetMedia();
    const params = buildBristleInitParams(settings, 40);
    expect(params.bristleCount).toBe(256);
    expect(params.brushShape).toBe(0); // Round
    expect(params.brushRadius).toBe(20);
    expect(params.bristleLength).toBeGreaterThan(0);
    expect(params.baseStiffness).toBe(0.5);
    expect(params.spread).toBe(0.3);
    expect(params.form).toBe(0.5);
  });

  it("clamps bristle count to MAX_BRISTLE_COUNT", () => {
    const settings = { ...defaultWetMedia(), bristleCount: 9999 };
    const params = buildBristleInitParams(settings, 20);
    expect(params.bristleCount).toBe(MAX_BRISTLE_COUNT);
  });

  it("ensures minimum bristle count of 16", () => {
    const settings = { ...defaultWetMedia(), bristleCount: 2 };
    const params = buildBristleInitParams(settings, 20);
    expect(params.bristleCount).toBe(16);
  });

  it("bristle length scales with brush size and stiffness", () => {
    const stiff = { ...defaultWetMedia(), bristleStiffness: 1.0 };
    const soft = { ...defaultWetMedia(), bristleStiffness: 0.0 };
    const pStiff = buildBristleInitParams(stiff, 40);
    const pSoft = buildBristleInitParams(soft, 40);
    expect(pSoft.bristleLength).toBeGreaterThan(pStiff.bristleLength);
  });

  it("produces deterministic seed for same inputs", () => {
    const settings = defaultWetMedia();
    const a = buildBristleInitParams(settings, 40);
    const b = buildBristleInitParams(settings, 40);
    expect(a.seed).toBe(b.seed);
  });

  it("produces different seed for different brush sizes", () => {
    const settings = defaultWetMedia();
    const a = buildBristleInitParams(settings, 40);
    const b = buildBristleInitParams(settings, 60);
    expect(a.seed).not.toBe(b.seed);
  });
});

describe("bristleBufferSize", () => {
  it("computes correct buffer size", () => {
    expect(bristleBufferSize(256)).toBe(256 * BRISTLE_STRIDE_F32 * 4);
  });

  it("single bristle is BRISTLE_STRIDE_F32 * 4 bytes", () => {
    expect(bristleBufferSize(1)).toBe(BRISTLE_STRIDE_F32 * 4);
  });
});

describe("writeBristleInitUniform", () => {
  it("writes correct uniform buffer data", () => {
    const params = buildBristleInitParams(defaultWetMedia(), 40);
    const buf = writeBristleInitUniform(params);
    expect(buf.length).toBe(12);

    // Check u32 fields via Uint32Array view
    const u32 = new Uint32Array(buf.buffer);
    expect(u32[0]).toBe(256); // bristle_count
    expect(u32[1]).toBe(0);   // brush_shape (Round)

    // Check f32 fields
    expect(buf[2]).toBeCloseTo(20); // brush_radius
    expect(buf[3]).toBeGreaterThan(0); // bristle_length
    expect(buf[4]).toBeCloseTo(0.5); // base_stiffness
    expect(buf[6]).toBeCloseTo(0.3); // spread
    expect(buf[8]).toBeCloseTo(0.5); // form
  });

  it("returns 12-element Float32Array (48 bytes, 3 vec4s)", () => {
    const params = buildBristleInitParams(defaultWetMedia(), 20);
    const buf = writeBristleInitUniform(params);
    expect(buf.byteLength).toBe(48);
  });
});
