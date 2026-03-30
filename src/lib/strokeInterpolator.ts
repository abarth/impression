/**
 * Catmull-Rom spline stroke interpolator with adaptive sub-stepping.
 *
 * Instead of linear interpolation between input points (which causes
 * jagged segments on fast strokes), this uses a Catmull-Rom spline
 * through the last 4 points to produce a smooth curve. It also generates
 * sub-steps to prevent bristles from teleporting across the canvas
 * during fast movement.
 */

import type { StylusPoint } from "./stylusInput";

/**
 * An interpolated point along the stroke, produced by the spline evaluator.
 * Includes all stylus telemetry fields interpolated from the input.
 */
export interface InterpolatedPoint {
  x: number;
  y: number;
  pressure: number;
  altitude: number;
  azimuth: number;
  twist: number;
  /** Velocity magnitude in canvas pixels per millisecond. */
  velocity: number;
  /** Velocity direction in radians (atan2). */
  velocityAngle: number;
}

/**
 * Evaluate a Catmull-Rom spline at parameter t ∈ [0, 1] given four
 * control values. Uses the standard basis matrix with tau=0.5.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Evaluate the derivative of a Catmull-Rom spline at parameter t.
 */
function catmullRomDerivative(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (
    (-p0 + p2) +
    (4 * p0 - 10 * p1 + 8 * p2 - 2 * p3) * t +
    (-3 * p0 + 9 * p1 - 9 * p2 + 3 * p3) * t2
  );
}

/**
 * Approximate arc length of a Catmull-Rom segment by sampling N chords.
 */
function estimateArcLength(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  samples: number = 8,
): number {
  let length = 0;
  let prevX = p1x;
  let prevY = p1y;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = catmullRom(p0x, p1x, p2x, p3x, t);
    const y = catmullRom(p0y, p1y, p2y, p3y, t);
    const dx = x - prevX;
    const dy = y - prevY;
    length += Math.sqrt(dx * dx + dy * dy);
    prevX = x;
    prevY = y;
  }
  return length;
}

/**
 * Linearly interpolate between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate an angle (in radians) along the shortest arc.
 */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  // Wrap to [-π, π]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * Stateful Catmull-Rom stroke interpolator.
 *
 * Feed raw input points via `addPoint()` and receive an array of
 * sub-stepped interpolated points for each input.
 */
export class StrokeInterpolator {
  /** Circular buffer of the last 4 input points (indices 0-3). */
  private points: StylusPoint[] = [];
  /** How many raw input points have been received so far. */
  private count = 0;
  /** Maximum distance between sub-steps, relative to brush radius. */
  private subStepFraction: number;
  /** Current brush radius in canvas pixels. */
  private brushRadius: number;

  /**
   * @param brushRadius Current brush radius in canvas pixels
   * @param subStepFraction Max sub-step distance as fraction of brush radius (default 0.5)
   */
  constructor(brushRadius: number, subStepFraction: number = 0.5) {
    this.brushRadius = Math.max(1, brushRadius);
    this.subStepFraction = Math.max(0.1, subStepFraction);
  }

  /** Reset for a new stroke. */
  reset(brushRadius: number): void {
    this.points = [];
    this.count = 0;
    this.brushRadius = Math.max(1, brushRadius);
  }

  /**
   * Add a new raw input point and return interpolated sub-steps.
   *
   * For the first point, returns a single point at the input position.
   * For subsequent points, returns sub-stepped points along the
   * Catmull-Rom spline segment.
   */
  addPoint(point: StylusPoint): InterpolatedPoint[] {
    this.points.push(point);
    this.count++;

    // First point: no interpolation possible yet
    if (this.count === 1) {
      return [{
        x: point.x,
        y: point.y,
        pressure: point.pressure,
        altitude: point.altitude,
        azimuth: point.azimuth,
        twist: point.twist,
        velocity: 0,
        velocityAngle: 0,
      }];
    }

    // Second point: linear interpolation (only 2 points available)
    if (this.count === 2) {
      return this.linearSubSteps(this.points[0], this.points[1]);
    }

    // Third point onwards: Catmull-Rom with mirrored endpoints
    // For exactly 3 points, mirror p0 to create p(-1)
    // For 4+ points, use a sliding window of the last 4
    const n = this.points.length;
    let p0: StylusPoint, p1: StylusPoint, p2: StylusPoint, p3: StylusPoint;

    if (n === 3) {
      // Mirror first point: p0 = 2*p1 - p2 reflected
      p1 = this.points[0];
      p2 = this.points[1];
      p3 = this.points[2];
      p0 = {
        ...p1,
        x: 2 * p1.x - p2.x,
        y: 2 * p1.y - p2.y,
      };
    } else {
      // Use last 4 points
      p0 = this.points[n - 4];
      p1 = this.points[n - 3];
      p2 = this.points[n - 2];
      p3 = this.points[n - 1];
    }

    // Only keep the last 4 points in the buffer
    if (this.points.length > 4) {
      this.points = this.points.slice(-4);
    }

    // Interpolate the segment from p1 to p2 (the "new" segment)
    // We're generating sub-steps for the segment that just became fully defined
    return this.splineSubSteps(p0, p1, p2, p3);
  }

  /**
   * Finalize the stroke. Returns sub-steps for the remaining segment
   * (from the second-to-last point to the last point) that hasn't been
   * emitted yet because we were waiting for a future point.
   */
  finish(): InterpolatedPoint[] {
    const n = this.points.length;
    if (n < 2) return [];

    // Emit the final segment with a mirrored endpoint
    if (n === 2) {
      // Already emitted via linear sub-steps, nothing left
      return [];
    }

    const p0 = n >= 4 ? this.points[n - 4] : this.points[0];
    const p1 = this.points[n - 3] ?? this.points[n - 2];
    const p2 = this.points[n - 2];
    const p3 = this.points[n - 1];
    // Mirror endpoint: pN = 2*pLast - pPrev
    const pEnd: StylusPoint = {
      ...p3,
      x: 2 * p3.x - p2.x,
      y: 2 * p3.y - p2.y,
    };

    return this.splineSubSteps(p1, p2, p3, pEnd);
  }

  /** Generate sub-stepped points along a linear segment. */
  private linearSubSteps(a: StylusPoint, b: StylusPoint): InterpolatedPoint[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxStep = this.brushRadius * this.subStepFraction;
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const dt = b.timestamp - a.timestamp;

    const result: InterpolatedPoint[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(a.x, b.x, t);
      const y = lerp(a.y, b.y, t);
      const velocity = dt > 0 ? dist / dt : 0;
      result.push({
        x,
        y,
        pressure: lerp(a.pressure, b.pressure, t),
        altitude: lerp(a.altitude, b.altitude, t),
        azimuth: lerpAngle(a.azimuth, b.azimuth, t),
        twist: lerpAngle(a.twist, b.twist, t),
        velocity,
        velocityAngle: Math.atan2(dy, dx),
      });
    }
    return result;
  }

  /** Generate sub-stepped points along a Catmull-Rom segment from p1 to p2. */
  private splineSubSteps(
    p0: StylusPoint, p1: StylusPoint,
    p2: StylusPoint, p3: StylusPoint,
  ): InterpolatedPoint[] {
    const arcLen = estimateArcLength(
      p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y,
    );
    const maxStep = this.brushRadius * this.subStepFraction;
    const steps = Math.max(1, Math.ceil(arcLen / maxStep));
    const dt = p2.timestamp - p1.timestamp;

    const result: InterpolatedPoint[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
      const dxdt = catmullRomDerivative(p0.x, p1.x, p2.x, p3.x, t);
      const dydt = catmullRomDerivative(p0.y, p1.y, p2.y, p3.y, t);
      const speed = Math.sqrt(dxdt * dxdt + dydt * dydt);
      const velocity = dt > 0 ? speed / dt : 0;

      result.push({
        x,
        y,
        pressure: lerp(p1.pressure, p2.pressure, t),
        altitude: lerp(p1.altitude, p2.altitude, t),
        azimuth: lerpAngle(p1.azimuth, p2.azimuth, t),
        twist: lerpAngle(p1.twist, p2.twist, t),
        velocity,
        velocityAngle: Math.atan2(dydt, dxdt),
      });
    }
    return result;
  }
}
