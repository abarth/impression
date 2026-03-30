import { describe, it, expect } from "vitest";
import {
  computeAtlasLayout,
  buildBristleTransferConfig,
  writeTransferParamsUniform,
  buildBristleReduceConfig,
  writeReduceParamsUniform,
  DEFAULT_GRID_SIZE,
  TRANSFER_PARAMS_BYTES,
  REDUCE_PARAMS_BYTES,
} from "../lib/bristleTransfer";

describe("computeAtlasLayout", () => {
  it("computes roughly square layout for 256 bristles", () => {
    const layout = computeAtlasLayout(256);
    expect(layout.gridSize).toBe(DEFAULT_GRID_SIZE);
    expect(layout.atlasCols).toBe(16); // sqrt(256) = 16
    expect(layout.atlasRows).toBe(16);
    expect(layout.atlasWidth).toBe(128); // 16 * 8
    expect(layout.atlasHeight).toBe(128);
  });

  it("handles non-square counts", () => {
    const layout = computeAtlasLayout(100);
    expect(layout.atlasCols).toBe(10); // sqrt(100)
    expect(layout.atlasRows).toBe(10);
    expect(layout.atlasWidth).toBe(80); // 10 * 8
  });

  it("handles non-perfect-square counts", () => {
    const layout = computeAtlasLayout(130);
    expect(layout.atlasCols).toBe(12); // ceil(sqrt(130)) = 12
    expect(layout.atlasRows).toBe(11); // ceil(130/12) = 11
  });

  it("accepts custom grid size", () => {
    const layout = computeAtlasLayout(64, 16);
    expect(layout.gridSize).toBe(16);
    expect(layout.atlasCols).toBe(8);
    expect(layout.atlasWidth).toBe(128);
  });
});

describe("buildBristleTransferConfig", () => {
  it("builds config with defaults", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleTransferConfig(256, 1920, 1080, atlas);
    expect(cfg.bristleCount).toBe(256);
    expect(cfg.gridSize).toBe(8);
    expect(cfg.canvasWidth).toBe(1920);
    expect(cfg.depositionRate).toBeCloseTo(0.15);
    expect(cfg.pickupRate).toBeCloseTo(0.05);
    expect(cfg.pickupThreshold).toBeCloseTo(0.3);
  });

  it("accepts custom overrides", () => {
    const atlas = computeAtlasLayout(128);
    const cfg = buildBristleTransferConfig(128, 800, 600, atlas, {
      depositionRate: 0.3,
      pickupRate: 0.1,
      viscosity: 0.9,
    });
    expect(cfg.depositionRate).toBeCloseTo(0.3);
    expect(cfg.pickupRate).toBeCloseTo(0.1);
    expect(cfg.viscosity).toBeCloseTo(0.9);
  });
});

describe("writeTransferParamsUniform", () => {
  it("returns 16-element Float32Array (64 bytes)", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleTransferConfig(256, 1920, 1080, atlas);
    const buf = writeTransferParamsUniform(cfg);
    expect(buf.length).toBe(16);
    expect(buf.byteLength).toBe(TRANSFER_PARAMS_BYTES);
  });

  it("encodes u32 fields correctly", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleTransferConfig(256, 1920, 1080, atlas);
    const buf = writeTransferParamsUniform(cfg);
    const u32 = new Uint32Array(buf.buffer);
    expect(u32[0]).toBe(256);
    expect(u32[1]).toBe(8);
    expect(u32[2]).toBe(1920);
    expect(u32[3]).toBe(1080);
    expect(u32[4]).toBe(atlas.atlasWidth);
    expect(u32[5]).toBe(atlas.atlasCols);
  });

  it("encodes f32 fields correctly", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleTransferConfig(256, 1920, 1080, atlas, {
      depositionRate: 0.2,
      pickupRate: 0.08,
    });
    const buf = writeTransferParamsUniform(cfg);
    expect(buf[6]).toBeCloseTo(0.2);
    expect(buf[7]).toBeCloseTo(0.08);
  });
});

describe("buildBristleReduceConfig", () => {
  it("builds config with defaults", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleReduceConfig(256, 1920, 1080, atlas);
    expect(cfg.mixingStrength).toBeCloseTo(0.5);
    expect(cfg.viscosity).toBeCloseTo(0.5);
    expect(cfg.velocityX).toBe(0);
    expect(cfg.velocityY).toBe(0);
  });
});

describe("writeReduceParamsUniform", () => {
  it("returns 12-element Float32Array (48 bytes)", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleReduceConfig(256, 1920, 1080, atlas);
    const buf = writeReduceParamsUniform(cfg);
    expect(buf.length).toBe(12);
    expect(buf.byteLength).toBe(REDUCE_PARAMS_BYTES);
  });

  it("encodes u32 fields at indices 0-5", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleReduceConfig(256, 1920, 1080, atlas);
    const buf = writeReduceParamsUniform(cfg);
    const u32 = new Uint32Array(buf.buffer);
    expect(u32[0]).toBe(256);
    expect(u32[1]).toBe(8);
    expect(u32[2]).toBe(1920);
    expect(u32[3]).toBe(1080);
  });

  it("encodes f32 mixing/viscosity/velocity fields", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleReduceConfig(256, 1920, 1080, atlas, {
      mixingStrength: 0.8,
      viscosity: 0.3,
      velocityX: 1.5,
      velocityY: -0.5,
    });
    const buf = writeReduceParamsUniform(cfg);
    expect(buf[6]).toBeCloseTo(0.8);
    expect(buf[7]).toBeCloseTo(0.3);
    expect(buf[8]).toBeCloseTo(1.5);
    expect(buf[9]).toBeCloseTo(-0.5);
  });

  it("pads last two values to zero", () => {
    const atlas = computeAtlasLayout(256);
    const cfg = buildBristleReduceConfig(256, 1920, 1080, atlas);
    const buf = writeReduceParamsUniform(cfg);
    expect(buf[10]).toBe(0);
    expect(buf[11]).toBe(0);
  });
});
