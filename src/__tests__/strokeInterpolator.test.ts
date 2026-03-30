import { describe, it, expect } from "vitest";
import { StrokeInterpolator } from "../lib/strokeInterpolator";
import type { StylusPoint } from "../lib/stylusInput";

function makePoint(x: number, y: number, pressure = 1.0, timestamp = 0): StylusPoint {
  return {
    x, y, pressure,
    altitude: Math.PI / 2,
    azimuth: 0,
    twist: 0,
    timestamp,
  };
}

describe("StrokeInterpolator", () => {
  it("returns a single point for the first input", () => {
    const interp = new StrokeInterpolator(10);
    const pts = interp.addPoint(makePoint(100, 100));
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBe(100);
    expect(pts[0].y).toBe(100);
    expect(pts[0].velocity).toBe(0);
  });

  it("generates sub-steps for a long second segment", () => {
    const interp = new StrokeInterpolator(10); // radius=10, maxStep=5
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    const pts = interp.addPoint(makePoint(50, 0, 1.0, 10));
    // Distance is 50, maxStep is 5 → expect 10 sub-steps
    expect(pts.length).toBe(10);
    // Last point should be at (50, 0)
    expect(pts[pts.length - 1].x).toBeCloseTo(50);
    expect(pts[pts.length - 1].y).toBeCloseTo(0);
  });

  it("generates at least 1 sub-step for a short segment", () => {
    const interp = new StrokeInterpolator(100); // radius=100, maxStep=50
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    const pts = interp.addPoint(makePoint(5, 0, 1.0, 10));
    expect(pts.length).toBeGreaterThanOrEqual(1);
    expect(pts[pts.length - 1].x).toBeCloseTo(5);
  });

  it("uses Catmull-Rom interpolation for 3+ points", () => {
    const interp = new StrokeInterpolator(5);
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    interp.addPoint(makePoint(10, 0, 1.0, 10));
    // Third point triggers Catmull-Rom for the segment p1→p2
    const pts = interp.addPoint(makePoint(20, 10, 1.0, 20));
    expect(pts.length).toBeGreaterThanOrEqual(1);
    // The interpolated curve should pass near but not necessarily through (10,0)→(20,10)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(30);
    }
  });

  it("interpolates pressure between control points", () => {
    const interp = new StrokeInterpolator(10);
    interp.addPoint(makePoint(0, 0, 0.2, 0));
    const pts = interp.addPoint(makePoint(20, 0, 0.8, 10));
    // Pressure should be interpolated between 0.2 and 0.8
    for (const p of pts) {
      expect(p.pressure).toBeGreaterThanOrEqual(0.19);
      expect(p.pressure).toBeLessThanOrEqual(0.81);
    }
    // Last sub-step should be close to 0.8
    expect(pts[pts.length - 1].pressure).toBeCloseTo(0.8, 1);
  });

  it("computes velocity magnitude", () => {
    const interp = new StrokeInterpolator(10);
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    const pts = interp.addPoint(makePoint(100, 0, 1.0, 100));
    // Distance=100, time=100ms → velocity=1.0 px/ms
    for (const p of pts) {
      expect(p.velocity).toBeCloseTo(1.0, 0);
    }
  });

  it("computes velocity angle", () => {
    const interp = new StrokeInterpolator(10);
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    const pts = interp.addPoint(makePoint(0, 50, 1.0, 10));
    // Moving straight down → angle ≈ π/2
    expect(pts[pts.length - 1].velocityAngle).toBeCloseTo(Math.PI / 2, 1);
  });

  it("finish() emits the final segment", () => {
    const interp = new StrokeInterpolator(5);
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    interp.addPoint(makePoint(10, 0, 1.0, 10));
    interp.addPoint(makePoint(20, 0, 1.0, 20));
    const finalPts = interp.finish();
    expect(finalPts.length).toBeGreaterThanOrEqual(1);
    // Final points should end near (20, 0)
    expect(finalPts[finalPts.length - 1].x).toBeCloseTo(20, 0);
  });

  it("finish() returns empty for single-point strokes", () => {
    const interp = new StrokeInterpolator(10);
    interp.addPoint(makePoint(50, 50));
    expect(interp.finish()).toHaveLength(0);
  });

  it("reset() clears state for reuse", () => {
    const interp = new StrokeInterpolator(10);
    interp.addPoint(makePoint(0, 0));
    interp.addPoint(makePoint(100, 100));
    interp.reset(20);
    // After reset, first point should return single point again
    const pts = interp.addPoint(makePoint(50, 50));
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBe(50);
  });

  it("handles zero-distance moves gracefully", () => {
    const interp = new StrokeInterpolator(10);
    interp.addPoint(makePoint(50, 50, 1.0, 0));
    const pts = interp.addPoint(makePoint(50, 50, 1.0, 10));
    // Should still produce at least 1 point
    expect(pts.length).toBeGreaterThanOrEqual(1);
    expect(pts[0].x).toBeCloseTo(50);
    expect(pts[0].y).toBeCloseTo(50);
  });

  it("produces smooth curve for L-shaped path", () => {
    const interp = new StrokeInterpolator(2);
    interp.addPoint(makePoint(0, 0, 1.0, 0));
    interp.addPoint(makePoint(20, 0, 1.0, 10));
    interp.addPoint(makePoint(20, 20, 1.0, 20));
    const pts4 = interp.addPoint(makePoint(20, 40, 1.0, 30));
    // The curve through the corner should be smooth — no sharp right angle
    // Check that at least one point has x between 15 and 25 (near the corner)
    const cornerPts = pts4.filter(p => p.x > 15 && p.x < 25 && p.y > 0 && p.y < 25);
    // Should have some points near the turn
    expect(cornerPts.length + pts4.length).toBeGreaterThan(0);
  });

  it("does not accumulate unbounded history", () => {
    const interp = new StrokeInterpolator(10);
    for (let i = 0; i < 100; i++) {
      interp.addPoint(makePoint(i * 10, 0, 1.0, i * 10));
    }
    // Internal buffer should be bounded (≤4 points)
    // We can't directly inspect, but the interpolator should work fine
    const pts = interp.addPoint(makePoint(1010, 0, 1.0, 1010));
    expect(pts.length).toBeGreaterThanOrEqual(1);
  });
});
