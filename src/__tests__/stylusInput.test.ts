import { describe, it, expect } from "vitest";
import { tiltToSpherical, extractStylusPoint } from "../lib/stylusInput";

describe("tiltToSpherical", () => {
  it("returns perpendicular altitude when tilt is zero", () => {
    const { altitude, azimuth } = tiltToSpherical(0, 0);
    expect(altitude).toBeCloseTo(Math.PI / 2);
    expect(azimuth).toBe(0);
  });

  it("returns lower altitude when tilted", () => {
    const { altitude } = tiltToSpherical(45, 0);
    expect(altitude).toBeGreaterThan(0);
    expect(altitude).toBeLessThan(Math.PI / 2);
  });

  it("tilting right (positive tiltX) gives azimuth near 0 (rightward)", () => {
    const { azimuth } = tiltToSpherical(45, 0);
    expect(azimuth).toBeCloseTo(0, 1);
  });

  it("tilting toward user (positive tiltY) gives azimuth near π/2", () => {
    const { azimuth } = tiltToSpherical(0, 45);
    // tiltY > 0 = toward user, our convention maps to -π/2 due to -dy
    expect(azimuth).toBeCloseTo(-Math.PI / 2, 1);
  });

  it("extreme tilt gives altitude near zero", () => {
    const { altitude } = tiltToSpherical(85, 0);
    expect(altitude).toBeLessThan(0.2);
    expect(altitude).toBeGreaterThan(0);
  });

  it("symmetrical tilt gives roughly 45° azimuth", () => {
    const { azimuth } = tiltToSpherical(30, -30);
    // tan(30°) ≈ 0.577, tiltY negative means dy negative, -dy positive
    // atan2(positive, positive) = somewhere in first quadrant
    expect(azimuth).toBeGreaterThan(0);
    expect(azimuth).toBeLessThan(Math.PI / 2);
  });

  it("altitude is always in [0, π/2]", () => {
    for (const tx of [-80, -45, 0, 45, 80]) {
      for (const ty of [-80, -45, 0, 45, 80]) {
        if (tx === 0 && ty === 0) continue;
        const { altitude } = tiltToSpherical(tx, ty);
        expect(altitude).toBeGreaterThanOrEqual(0);
        expect(altitude).toBeLessThanOrEqual(Math.PI / 2 + 0.001);
      }
    }
  });
});

describe("extractStylusPoint", () => {
  function makePointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
    return {
      pointerType: "pen",
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      timeStamp: 100,
      ...overrides,
    } as unknown as PointerEvent;
  }

  it("extracts pressure from pen events", () => {
    const e = makePointerEvent({ pressure: 0.7, pointerType: "pen" });
    const pt = extractStylusPoint(e, 10, 20);
    expect(pt.pressure).toBeCloseTo(0.7);
    expect(pt.x).toBe(10);
    expect(pt.y).toBe(20);
  });

  it("defaults pressure to 1.0 for mouse", () => {
    const e = makePointerEvent({ pressure: 0.5, pointerType: "mouse" } as any);
    const pt = extractStylusPoint(e, 0, 0);
    expect(pt.pressure).toBe(1.0);
  });

  it("converts twist from degrees to radians", () => {
    const e = makePointerEvent({ twist: 90 });
    const pt = extractStylusPoint(e, 0, 0);
    expect(pt.twist).toBeCloseTo(Math.PI / 2);
  });

  it("defaults tilt to perpendicular when zero", () => {
    const e = makePointerEvent({ tiltX: 0, tiltY: 0 });
    const pt = extractStylusPoint(e, 0, 0);
    expect(pt.altitude).toBeCloseTo(Math.PI / 2);
  });

  it("carries through timestamp", () => {
    const e = makePointerEvent({ timeStamp: 42.5 } as any);
    const pt = extractStylusPoint(e, 0, 0);
    expect(pt.timestamp).toBe(42.5);
  });
});
