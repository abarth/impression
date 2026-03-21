use serde::{Deserialize, Serialize};

/// Control source for a dynamic brush parameter.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum DynamicControl {
    Off,
    PenPressure,
    Random,
    /// Angle follows the current stroke direction (tangent).
    Direction,
    /// Angle is set to the initial stroke direction and held constant.
    InitialDirection,
}

impl DynamicControl {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => DynamicControl::PenPressure,
            2 => DynamicControl::Random,
            3 => DynamicControl::Direction,
            4 => DynamicControl::InitialDirection,
            _ => DynamicControl::Off,
        }
    }
}

/// A single dynamic parameter: jitter amount, control source, and minimum floor.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DynamicParam {
    /// How much the parameter varies (0.0 = none, 1.0 = full range).
    pub jitter: f32,
    /// What drives the variation.
    pub control: DynamicControl,
    /// Minimum value floor as a fraction (0.0–1.0).
    pub minimum: f32,
}

impl Default for DynamicParam {
    fn default() -> Self {
        Self {
            jitter: 0.0,
            control: DynamicControl::Off,
            minimum: 0.0,
        }
    }
}

/// Shape dynamics: per-stamp variation of size, angle, and roundness.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShapeDynamics {
    pub size: DynamicParam,
    pub angle: DynamicParam,
    pub roundness: DynamicParam,
}

impl Default for ShapeDynamics {
    fn default() -> Self {
        Self {
            size: DynamicParam::default(),
            angle: DynamicParam::default(),
            roundness: DynamicParam::default(),
        }
    }
}

/// Transfer dynamics: per-stamp variation of opacity and flow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransferDynamics {
    pub opacity: DynamicParam,
    pub flow: DynamicParam,
}

impl Default for TransferDynamics {
    fn default() -> Self {
        Self {
            opacity: DynamicParam::default(),
            flow: DynamicParam::default(),
        }
    }
}

/// Simple xorshift32 PRNG for deterministic per-stroke randomness.
#[derive(Debug, Clone)]
pub struct Rng {
    state: u32,
}

impl Rng {
    /// Create a new PRNG seeded from stroke start coordinates.
    pub fn from_coords(x: f32, y: f32) -> Self {
        let seed = x.to_bits() ^ y.to_bits().rotate_left(16);
        // Ensure non-zero state (xorshift requires it)
        Self {
            state: if seed == 0 { 1 } else { seed },
        }
    }

    /// Return a random f32 in [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        (self.state as f32) / (u32::MAX as f32)
    }
}

/// Apply a scaling dynamic parameter. Control and jitter are independent:
/// - Control (pen pressure, random) maps the value from [minimum, 1.0]
/// - Jitter adds random variation that can reduce the controlled value
///
/// `direction_angle` is the current stroke direction in degrees (used by Direction/InitialDirection
/// controls for scaling parameters — normalized to [0,1] range).
pub fn apply_dynamic(
    param: &DynamicParam,
    base: f32,
    pressure: f32,
    rng: &mut Rng,
    direction_angle: f32,
) -> f32 {
    if param.control == DynamicControl::Off && param.jitter <= 0.0 {
        return base;
    }

    // Control source determines primary scaling
    let control_factor = match param.control {
        DynamicControl::Off => 1.0,
        DynamicControl::PenPressure => pressure,
        DynamicControl::Random => rng.next_f32(),
        // For scaling params, direction maps to [0,1] based on angle
        DynamicControl::Direction | DynamicControl::InitialDirection => {
            // Normalize direction angle to [0, 360) and map to [0, 1]
            let normalized = ((direction_angle % 360.0) + 360.0) % 360.0;
            normalized / 360.0
        }
    };

    // Map control through [minimum, 1.0]
    let controlled = param.minimum + (1.0 - param.minimum) * control_factor;

    // Jitter adds independent random reduction
    let jittered = if param.jitter > 0.0 {
        controlled * (1.0 - param.jitter * rng.next_f32())
    } else {
        controlled
    };

    base * jittered.max(0.0)
}

/// Apply an additive angle dynamic. Control and jitter contribute independently:
/// - Control adds a directed offset based on the input source
/// - Jitter adds random angular variation
///
/// `direction_angle` is the current stroke direction in degrees.
/// For Direction/InitialDirection, the brush tip angle follows the stroke direction.
pub fn apply_angle_dynamic(
    param: &DynamicParam,
    base: f32,
    pressure: f32,
    rng: &mut Rng,
    direction_angle: f32,
) -> f32 {
    if param.control == DynamicControl::Off && param.jitter <= 0.0 {
        return base;
    }

    // Control adds a directed offset
    let control_offset = match param.control {
        DynamicControl::Off => 0.0,
        DynamicControl::PenPressure => 180.0 * pressure,
        DynamicControl::Random => 180.0 * (rng.next_f32() * 2.0 - 1.0),
        // Direction/InitialDirection: the brush tip rotates to follow the stroke
        DynamicControl::Direction | DynamicControl::InitialDirection => direction_angle,
    };

    // Jitter adds independent random offset
    let jitter_offset = if param.jitter > 0.0 {
        180.0 * param.jitter * (rng.next_f32() * 2.0 - 1.0)
    } else {
        0.0
    };

    base + control_offset + jitter_offset
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rng_deterministic() {
        let mut rng1 = Rng::from_coords(10.0, 20.0);
        let mut rng2 = Rng::from_coords(10.0, 20.0);
        for _ in 0..100 {
            assert_eq!(rng1.next_f32(), rng2.next_f32());
        }
    }

    #[test]
    fn test_rng_range() {
        let mut rng = Rng::from_coords(42.0, 99.0);
        for _ in 0..1000 {
            let v = rng.next_f32();
            assert!(v >= 0.0 && v < 1.0, "value out of range: {v}");
        }
    }

    #[test]
    fn test_rng_zero_seed_handled() {
        // 0.0, 0.0 would produce seed=0 without the fix
        let mut rng = Rng::from_coords(0.0, 0.0);
        let v = rng.next_f32();
        assert!(v >= 0.0 && v < 1.0);
    }

    #[test]
    fn test_apply_dynamic_off_no_jitter() {
        // Control=Off, jitter=0: no variation at all
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::Off,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);
        assert_eq!(apply_dynamic(&param, 10.0, 0.5, &mut rng, 0.0), 10.0);
    }

    #[test]
    fn test_apply_dynamic_off_with_jitter() {
        // Control=Off, jitter=1.0: random variation from 0 to base
        let param = DynamicParam {
            jitter: 1.0,
            control: DynamicControl::Off,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);
        let v = apply_dynamic(&param, 10.0, 0.5, &mut rng, 0.0);
        assert!(v >= 0.0 && v <= 10.0, "should be in [0, base]: {v}");
    }

    #[test]
    fn test_apply_dynamic_pen_pressure_no_jitter() {
        // Control=PenPressure, jitter=0: size varies purely with pressure
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::PenPressure,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Full pressure -> base * 1.0
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng, 0.0) - 10.0).abs() < 0.01);

        // Half pressure -> base * 0.5
        assert!((apply_dynamic(&param, 10.0, 0.5, &mut rng, 0.0) - 5.0).abs() < 0.01);

        // Zero pressure -> base * 0.0
        assert!((apply_dynamic(&param, 10.0, 0.0, &mut rng, 0.0) - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_dynamic_pen_pressure_with_jitter() {
        // Control=PenPressure, jitter=0.5: pressure sets base, jitter adds randomness
        let param = DynamicParam {
            jitter: 0.5,
            control: DynamicControl::PenPressure,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Full pressure: controlled=1.0, then jitter reduces by up to 50%
        let v = apply_dynamic(&param, 10.0, 1.0, &mut rng, 0.0);
        assert!(v >= 5.0 && v <= 10.0, "should be in [5, 10]: {v}");
    }

    #[test]
    fn test_apply_dynamic_with_minimum() {
        // Minimum=0.5 means the value never goes below 50% of base
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::PenPressure,
            minimum: 0.5,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Zero pressure -> base * minimum = 10 * 0.5 = 5.0
        assert!((apply_dynamic(&param, 10.0, 0.0, &mut rng, 0.0) - 5.0).abs() < 0.01);

        // Full pressure -> base * (0.5 + 0.5 * 1.0) = 10.0
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng, 0.0) - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_dynamic_random_control() {
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::Random,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        let v = apply_dynamic(&param, 10.0, 1.0, &mut rng, 0.0);
        assert!(
            v >= 0.0 && v <= 10.0,
            "random dynamic should be in [0, base]: {v}"
        );
    }

    #[test]
    fn test_apply_dynamic_direction_control() {
        // Direction control maps direction angle [0,360] to [0,1] scaling factor
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::Direction,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Direction=0 -> factor=0.0 -> base*0 = 0
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng, 0.0) - 0.0).abs() < 0.01);

        // Direction=180 -> factor=0.5 -> base*0.5 = 5
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng, 180.0) - 5.0).abs() < 0.01);

        // Direction=360 -> wraps to 0 -> factor=0.0
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng, 360.0) - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_angle_dynamic_off_no_jitter() {
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::Off,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);
        assert_eq!(apply_angle_dynamic(&param, 45.0, 0.5, &mut rng, 0.0), 45.0);
    }

    #[test]
    fn test_apply_angle_dynamic_off_with_jitter() {
        // Control=Off, jitter=1.0: random angle offset up to +/-180
        let param = DynamicParam {
            jitter: 1.0,
            control: DynamicControl::Off,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);
        let v = apply_angle_dynamic(&param, 0.0, 0.5, &mut rng, 0.0);
        assert!(v >= -180.0 && v <= 180.0, "should be in [-180, 180]: {v}");
    }

    #[test]
    fn test_apply_angle_dynamic_pen_pressure() {
        // Control=PenPressure, jitter=0: angle offset purely from pressure
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::PenPressure,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Full pressure -> base + 180
        assert!((apply_angle_dynamic(&param, 0.0, 1.0, &mut rng, 0.0) - 180.0).abs() < 0.01);

        // Half pressure -> base + 90
        assert!((apply_angle_dynamic(&param, 0.0, 0.5, &mut rng, 0.0) - 90.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_angle_dynamic_random() {
        let param = DynamicParam {
            jitter: 1.0,
            control: DynamicControl::Random,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        let v = apply_angle_dynamic(&param, 0.0, 1.0, &mut rng, 0.0);
        // Control adds [-180, 180] and jitter adds [-180, 180], total [-360, 360]
        assert!(
            v >= -360.0 && v <= 360.0,
            "angle with random control+jitter should be in [-360, 360]: {v}"
        );
    }

    #[test]
    fn test_apply_angle_dynamic_direction() {
        // Direction control: brush angle follows stroke direction
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::Direction,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Stroke going at 45 degrees -> base + 45
        assert!((apply_angle_dynamic(&param, 10.0, 1.0, &mut rng, 45.0) - 55.0).abs() < 0.01);

        // Stroke going at 90 degrees -> base + 90
        assert!((apply_angle_dynamic(&param, 10.0, 1.0, &mut rng, 90.0) - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_angle_dynamic_initial_direction() {
        // InitialDirection uses the same mechanism as Direction (caller provides the captured angle)
        let param = DynamicParam {
            jitter: 0.0,
            control: DynamicControl::InitialDirection,
            minimum: 0.0,
        };
        let mut rng = Rng::from_coords(1.0, 1.0);

        assert!((apply_angle_dynamic(&param, 0.0, 1.0, &mut rng, 30.0) - 30.0).abs() < 0.01);
    }

    #[test]
    fn test_default_shape_dynamics_is_off() {
        let sd = ShapeDynamics::default();
        assert_eq!(sd.size.control, DynamicControl::Off);
        assert_eq!(sd.angle.control, DynamicControl::Off);
        assert_eq!(sd.roundness.control, DynamicControl::Off);
    }

    #[test]
    fn test_dynamic_control_from_u8() {
        assert_eq!(DynamicControl::from_u8(0), DynamicControl::Off);
        assert_eq!(DynamicControl::from_u8(1), DynamicControl::PenPressure);
        assert_eq!(DynamicControl::from_u8(2), DynamicControl::Random);
        assert_eq!(DynamicControl::from_u8(3), DynamicControl::Direction);
        assert_eq!(DynamicControl::from_u8(4), DynamicControl::InitialDirection);
        assert_eq!(DynamicControl::from_u8(255), DynamicControl::Off);
    }
}
