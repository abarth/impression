use serde::{Deserialize, Serialize};

/// Photoshop-compatible blend modes.
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
#[repr(u32)]
pub enum BlendMode {
    #[default]
    Normal = 0,
    Darken = 1,
    Multiply = 2,
    ColorBurn = 3,
    LinearBurn = 4,
    Lighten = 5,
    Screen = 6,
    ColorDodge = 7,
    LinearDodge = 8,
    Overlay = 9,
    SoftLight = 10,
    HardLight = 11,
    VividLight = 12,
    LinearLight = 13,
    PinLight = 14,
    HardMix = 15,
    Difference = 16,
    Exclusion = 17,
    Subtract = 18,
    Divide = 19,
}

impl BlendMode {
    pub fn from_u32(v: u32) -> Self {
        match v {
            0 => BlendMode::Normal,
            1 => BlendMode::Darken,
            2 => BlendMode::Multiply,
            3 => BlendMode::ColorBurn,
            4 => BlendMode::LinearBurn,
            5 => BlendMode::Lighten,
            6 => BlendMode::Screen,
            7 => BlendMode::ColorDodge,
            8 => BlendMode::LinearDodge,
            9 => BlendMode::Overlay,
            10 => BlendMode::SoftLight,
            11 => BlendMode::HardLight,
            12 => BlendMode::VividLight,
            13 => BlendMode::LinearLight,
            14 => BlendMode::PinLight,
            15 => BlendMode::HardMix,
            16 => BlendMode::Difference,
            17 => BlendMode::Exclusion,
            18 => BlendMode::Subtract,
            19 => BlendMode::Divide,
            _ => BlendMode::Normal,
        }
    }

    pub fn to_u32(self) -> u32 {
        self as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_is_normal() {
        assert_eq!(BlendMode::default(), BlendMode::Normal);
    }

    #[test]
    fn test_from_u32_round_trip() {
        for i in 0..=19 {
            let mode = BlendMode::from_u32(i);
            assert_eq!(mode.to_u32(), i);
        }
    }

    #[test]
    fn test_from_u32_unknown_defaults_to_normal() {
        assert_eq!(BlendMode::from_u32(99), BlendMode::Normal);
        assert_eq!(BlendMode::from_u32(u32::MAX), BlendMode::Normal);
    }

    #[test]
    fn test_all_variants_distinct() {
        let modes: Vec<BlendMode> = (0..=19).map(BlendMode::from_u32).collect();
        for (i, a) in modes.iter().enumerate() {
            for (j, b) in modes.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "Modes at index {} and {} should differ", i, j);
                }
            }
        }
    }
}
