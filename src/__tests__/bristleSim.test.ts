import { describe, it, expect } from "vitest";
import {
  writeStylusUniform,
  writeStylusUniformInto,
  buildBristleSimConfig,
  writeSimParamsUniform,
  STYLUS_UNIFORM_BYTES,
  SIM_PARAMS_BYTES,
} from "../lib/bristleSim";
import type { StylusPoint } from "../lib/stylusInput";

function defaultStylusPoint(): StylusPoint {
  return {
    x: 100,
    y: 200,
    pressure: 0.7,
    altitude: Math.PI / 4,
    azimuth: Math.PI / 3,
    twist: 0.1,
    velocity: 5.0,
    timestamp: 1000,
  };
}

describe("writeStylusUniform", () => {
  it("returns 8-element Float32Array (32 bytes)", () => {
    const buf = writeStylusUniform(defaultStylusPoint());
    expect(buf.length).toBe(8);
    expect(buf.byteLength).toBe(STYLUS_UNIFORM_BYTES);
  });

  it("writes position at indices 0-1", () => {
    const pt = defaultStylusPoint();
    const buf = writeStylusUniform(pt);
    expect(buf[0]).toBe(100);
    expect(buf[1]).toBe(200);
  });

  it("writes pressure at index 2", () => {
    const buf = writeStylusUniform(defaultStylusPoint());
    expect(buf[2]).toBeCloseTo(0.7);
  });

  it("writes altitude, azimuth, twist", () => {
    const pt = defaultStylusPoint();
    const buf = writeStylusUniform(pt);
    expect(buf[3]).toBeCloseTo(Math.PI / 4);
    expect(buf[4]).toBeCloseTo(Math.PI / 3);
    expect(buf[5]).toBeCloseTo(0.1);
  });
});

describe("writeStylusUniformInto", () => {
  it("writes position and velocity into provided buffer", () => {
    const pt = defaultStylusPoint();
    const buf = new Float32Array(8);
    writeStylusUniformInto(buf, pt, 3.0, -2.5);
    expect(buf[0]).toBe(100);
    expect(buf[1]).toBe(200);
    expect(buf[6]).toBeCloseTo(3.0);
    expect(buf[7]).toBeCloseTo(-2.5);
  });

  it("returns the same buffer for chaining", () => {
    const buf = new Float32Array(8);
    const ret = writeStylusUniformInto(buf, defaultStylusPoint(), 0, 0);
    expect(ret).toBe(buf);
  });
});

describe("buildBristleSimConfig", () => {
  it("builds config with default values", () => {
    const cfg = buildBristleSimConfig(256, 40, 1.0);
    expect(cfg.bristleCount).toBe(256);
    expect(cfg.brushRadius).toBe(20);
    expect(cfg.dt).toBe(1.0);
    expect(cfg.maxHeight).toBeCloseTo(30); // radius * 1.5
    expect(cfg.damping).toBeCloseTo(0.85);
    expect(cfg.splayStrength).toBeCloseTo(0.4);
    expect(cfg.clumpStrength).toBeCloseTo(0.15);
    expect(cfg.clumpThreshold).toBeCloseTo(0.1);
  });

  it("allows custom overrides", () => {
    const cfg = buildBristleSimConfig(128, 60, 2.0, {
      damping: 0.5,
      splayStrength: 1.0,
      clumpStrength: 0.3,
      clumpThreshold: 0.2,
      maxHeightFactor: 2.0,
    });
    expect(cfg.brushRadius).toBe(30);
    expect(cfg.maxHeight).toBeCloseTo(60); // radius * 2.0
    expect(cfg.damping).toBeCloseTo(0.5);
    expect(cfg.splayStrength).toBeCloseTo(1.0);
    expect(cfg.clumpStrength).toBeCloseTo(0.3);
    expect(cfg.clumpThreshold).toBeCloseTo(0.2);
  });

  it("maxHeight defaults to 1.5x radius", () => {
    const cfg = buildBristleSimConfig(256, 80, 1.0);
    expect(cfg.maxHeight).toBeCloseTo(60); // 40 * 1.5
  });
});

describe("writeSimParamsUniform", () => {
  it("returns 8-element Float32Array (32 bytes)", () => {
    const cfg = buildBristleSimConfig(256, 40, 1.0);
    const buf = writeSimParamsUniform(cfg);
    expect(buf.length).toBe(8);
    expect(buf.byteLength).toBe(SIM_PARAMS_BYTES);
  });

  it("encodes bristle_count as u32 at index 0", () => {
    const cfg = buildBristleSimConfig(256, 40, 1.0);
    const buf = writeSimParamsUniform(cfg);
    const u32 = new Uint32Array(buf.buffer);
    expect(u32[0]).toBe(256);
  });

  it("encodes dt at index 1", () => {
    const cfg = buildBristleSimConfig(256, 40, 2.5);
    const buf = writeSimParamsUniform(cfg);
    expect(buf[1]).toBeCloseTo(2.5);
  });

  it("encodes brush_radius and max_height", () => {
    const cfg = buildBristleSimConfig(256, 40, 1.0);
    const buf = writeSimParamsUniform(cfg);
    expect(buf[2]).toBeCloseTo(20);
    expect(buf[3]).toBeCloseTo(30);
  });

  it("encodes damping, splay, clump fields", () => {
    const cfg = buildBristleSimConfig(256, 40, 1.0, {
      damping: 0.9,
      splayStrength: 0.6,
      clumpStrength: 0.2,
      clumpThreshold: 0.15,
    });
    const buf = writeSimParamsUniform(cfg);
    expect(buf[4]).toBeCloseTo(0.9);
    expect(buf[5]).toBeCloseTo(0.6);
    expect(buf[6]).toBeCloseTo(0.2);
    expect(buf[7]).toBeCloseTo(0.15);
  });
});
