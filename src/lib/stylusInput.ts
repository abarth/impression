/**
 * Stylus telemetry extracted from PointerEvent.
 *
 * Raw tiltX/tiltY are converted to altitude (angle from the surface,
 * 0 = flat, π/2 = perpendicular) and azimuth (compass direction on the
 * canvas plane, 0 = right, π/2 = towards user, measured counter-clockwise).
 */
export interface StylusPoint {
  x: number;
  y: number;
  pressure: number;
  /** Altitude in radians: 0 = parallel to surface, π/2 = perpendicular. */
  altitude: number;
  /** Azimuth in radians on the canvas plane (0 = right, CCW positive). */
  azimuth: number;
  /** Barrel rotation in radians [0, 2π). */
  twist: number;
  /** Timestamp in ms (from PointerEvent.timeStamp or performance.now()). */
  timestamp: number;
}

/**
 * Convert PointerEvent tiltX/tiltY (degrees, range -90..90) to
 * altitude and azimuth in radians.
 *
 * tiltX: angle between the Y-Z plane and the stylus-Y plane (positive = tilted right)
 * tiltY: angle between the X-Z plane and the stylus-X plane (positive = tilted towards user)
 *
 * Altitude: angle from the tablet surface (0 = flat, π/2 = straight up)
 * Azimuth: direction the pen tip points on the surface plane
 */
export function tiltToSpherical(
  tiltXDeg: number,
  tiltYDeg: number,
): { altitude: number; azimuth: number } {
  const DEG_TO_RAD = Math.PI / 180;
  const tiltXRad = tiltXDeg * DEG_TO_RAD;
  const tiltYRad = tiltYDeg * DEG_TO_RAD;

  // If both tilts are zero, the pen is perpendicular (altitude = π/2).
  if (tiltXDeg === 0 && tiltYDeg === 0) {
    return { altitude: Math.PI / 2, azimuth: 0 };
  }

  // The pen direction vector in 3D (before normalization):
  //   dx = tan(tiltX)
  //   dy = tan(tiltY)
  //   dz = 1  (pointing up from tablet)
  const dx = Math.tan(tiltXRad);
  const dy = Math.tan(tiltYRad);

  // Altitude = arctan(1 / sqrt(dx² + dy²)) = angle from surface
  const horizontalDist = Math.sqrt(dx * dx + dy * dy);
  const altitude = Math.atan2(1, horizontalDist);

  // Azimuth = atan2(dy, dx), but we negate dy so that tiltY>0 (toward user)
  // maps to azimuth=π/2 (towards user in our coordinate system where Y points down).
  const azimuth = Math.atan2(-dy, dx);

  return { altitude, azimuth };
}

/**
 * Extract full stylus telemetry from a PointerEvent.
 *
 * For mouse/touch input, tilt defaults to perpendicular (altitude=π/2)
 * and twist defaults to 0.
 */
export function extractStylusPoint(
  e: PointerEvent,
  canvasX: number,
  canvasY: number,
): StylusPoint {
  const pressure = e.pointerType === "pen" ? e.pressure : 1.0;
  const tiltX = e.tiltX ?? 0;
  const tiltY = e.tiltY ?? 0;
  const rawTwist = e.twist ?? 0;
  const { altitude, azimuth } = tiltToSpherical(tiltX, tiltY);

  return {
    x: canvasX,
    y: canvasY,
    pressure,
    altitude,
    azimuth,
    twist: rawTwist * (Math.PI / 180),
    timestamp: e.timeStamp,
  };
}
