use serde::{Deserialize, Serialize};

/// Control source for a dynamic brush parameter.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum DynamicControl {
    Off,
    PenPressure,
    Random,
}

impl DynamicControl {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => DynamicControl::PenPressure,
            2 => DynamicControl::Random,
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
        Self { state: if seed == 0 { 1 } else { seed } }
    }

    /// Return a random f32 in [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        (self.state as f32) / (u32::MAX as f32)
    }
}

/// Apply a scaling dynamic parameter. Returns `base * factor` where factor
/// is derived from jitter, control, and minimum.
pub fn apply_dynamic(param: &DynamicParam, base: f32, pressure: f32, rng: &mut Rng) -> f32 {
    let control_value = match param.control {
        DynamicControl::Off => return base,
        DynamicControl::PenPressure => pressure,
        DynamicControl::Random => rng.next_f32(),
    };
    base * (param.minimum + (1.0 - param.minimum) * param.jitter * control_value)
}

/// Apply an additive angle dynamic. Returns `base + offset` where offset
/// is +/-180° * jitter * control_value.
pub fn apply_angle_dynamic(param: &DynamicParam, base: f32, pressure: f32, rng: &mut Rng) -> f32 {
    let control_value = match param.control {
        DynamicControl::Off => return base,
        DynamicControl::PenPressure => pressure,
        DynamicControl::Random => rng.next_f32() * 2.0 - 1.0, // [-1, 1]
    };
    base + 180.0 * param.jitter * control_value
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
    fn test_apply_dynamic_off() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::Off, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);
        assert_eq!(apply_dynamic(&param, 10.0, 0.5, &mut rng), 10.0);
    }

    #[test]
    fn test_apply_dynamic_pen_pressure() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::PenPressure, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Full pressure -> base * 1.0
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng) - 10.0).abs() < 0.01);

        // Half pressure -> base * 0.5
        assert!((apply_dynamic(&param, 10.0, 0.5, &mut rng) - 5.0).abs() < 0.01);

        // Zero pressure -> base * 0.0
        assert!((apply_dynamic(&param, 10.0, 0.0, &mut rng) - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_dynamic_with_minimum() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::PenPressure, minimum: 0.5 };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Zero pressure -> base * minimum = 10 * 0.5 = 5.0
        assert!((apply_dynamic(&param, 10.0, 0.0, &mut rng) - 5.0).abs() < 0.01);

        // Full pressure -> base * (0.5 + 0.5 * 1.0) = 10.0
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng) - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_dynamic_half_jitter() {
        let param = DynamicParam { jitter: 0.5, control: DynamicControl::PenPressure, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Full pressure, half jitter -> base * 0.5
        assert!((apply_dynamic(&param, 10.0, 1.0, &mut rng) - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_dynamic_random() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::Random, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);

        let v = apply_dynamic(&param, 10.0, 1.0, &mut rng);
        assert!(v >= 0.0 && v <= 10.0, "random dynamic should be in [0, base]: {v}");
    }

    #[test]
    fn test_apply_angle_dynamic_off() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::Off, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);
        assert_eq!(apply_angle_dynamic(&param, 45.0, 0.5, &mut rng), 45.0);
    }

    #[test]
    fn test_apply_angle_dynamic_pen_pressure() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::PenPressure, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);

        // Full pressure, full jitter -> base + 180
        assert!((apply_angle_dynamic(&param, 0.0, 1.0, &mut rng) - 180.0).abs() < 0.01);

        // Half pressure -> base + 90
        assert!((apply_angle_dynamic(&param, 0.0, 0.5, &mut rng) - 90.0).abs() < 0.01);
    }

    #[test]
    fn test_apply_angle_dynamic_random() {
        let param = DynamicParam { jitter: 1.0, control: DynamicControl::Random, minimum: 0.0 };
        let mut rng = Rng::from_coords(1.0, 1.0);

        let v = apply_angle_dynamic(&param, 0.0, 1.0, &mut rng);
        // Random control value in [-1, 1], so offset in [-180, 180]
        assert!(v >= -180.0 && v <= 180.0, "angle jitter should be in [-180, 180]: {v}");
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
        assert_eq!(DynamicControl::from_u8(255), DynamicControl::Off);
    }
}
