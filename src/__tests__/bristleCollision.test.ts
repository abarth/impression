import { describe, it, expect } from "vitest";
import {
  buildBristleCollisionConfig,
  writeCollisionParamsUniform,
  COLLISION_PARAMS_BYTES,
} from "../lib/bristleCollision";

describe("buildBristleCollisionConfig", () => {
  it("builds config with defaults", () => {
    const cfg = buildBristleCollisionConfig(256, 1920, 1080, 40);
    expect(cfg.bristleCount).toBe(256);
    expect(cfg.canvasWidth).toBe(1920);
    expect(cfg.canvasHeight).toBe(1080);
    expect(cfg.roughness).toBeCloseTo(0.5);
    expect(cfg.hoverThreshold).toBeCloseTo(0.3);
    expect(cfg.brushRadius).toBe(20);
  });

  it("accepts custom roughness and hoverThreshold", () => {
    const cfg = buildBristleCollisionConfig(128, 800, 600, 60, {
      roughness: 0.8,
      hoverThreshold: 0.1,
    });
    expect(cfg.roughness).toBeCloseTo(0.8);
    expect(cfg.hoverThreshold).toBeCloseTo(0.1);
    expect(cfg.brushRadius).toBe(30);
  });
});

describe("writeCollisionParamsUniform", () => {
  it("returns 8-element Float32Array (32 bytes)", () => {
    const cfg = buildBristleCollisionConfig(256, 1920, 1080, 40);
    const buf = writeCollisionParamsUniform(cfg);
    expect(buf.length).toBe(8);
    expect(buf.byteLength).toBe(COLLISION_PARAMS_BYTES);
  });

  it("encodes u32 fields at indices 0-2", () => {
    const cfg = buildBristleCollisionConfig(256, 1920, 1080, 40);
    const buf = writeCollisionParamsUniform(cfg);
    const u32 = new Uint32Array(buf.buffer);
    expect(u32[0]).toBe(256);
    expect(u32[1]).toBe(1920);
    expect(u32[2]).toBe(1080);
  });

  it("encodes f32 fields at indices 3-5", () => {
    const cfg = buildBristleCollisionConfig(256, 1920, 1080, 40, {
      roughness: 0.7,
      hoverThreshold: 0.25,
    });
    const buf = writeCollisionParamsUniform(cfg);
    expect(buf[3]).toBeCloseTo(0.7);
    expect(buf[4]).toBeCloseTo(0.25);
    expect(buf[5]).toBeCloseTo(20);
  });

  it("pads indices 6-7 to zero", () => {
    const cfg = buildBristleCollisionConfig(256, 1920, 1080, 40);
    const buf = writeCollisionParamsUniform(cfg);
    expect(buf[6]).toBe(0);
    expect(buf[7]).toBe(0);
  });
});
