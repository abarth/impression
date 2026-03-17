use serde::{Deserialize, Serialize};

/// Blend modes covering both Photoshop-compatible modes (0–19)
/// and Porter-Duff compositing operators (100+).
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
#[repr(u32)]
pub enum BlendMode {
    // -- Photoshop blend modes (0–19) --
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

    // -- Porter-Duff compositing operators (100+) --
    Clear = 100,
    Copy = 101,
    Destination = 102,
    SrcOver = 103,
    DstOver = 104,
    SrcIn = 105,
    DstIn = 106,
    SrcOut = 107,
    DstOut = 108,
    SrcAtop = 109,
    DstAtop = 110,
    Xor = 111,
    Plus = 112,
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
            100 => BlendMode::Clear,
            101 => BlendMode::Copy,
            102 => BlendMode::Destination,
            103 => BlendMode::SrcOver,
            104 => BlendMode::DstOver,
            105 => BlendMode::SrcIn,
            106 => BlendMode::DstIn,
            107 => BlendMode::SrcOut,
            108 => BlendMode::DstOut,
            109 => BlendMode::SrcAtop,
            110 => BlendMode::DstAtop,
            111 => BlendMode::Xor,
            112 => BlendMode::Plus,
            _ => BlendMode::Normal,
        }
    }

    pub fn to_u32(self) -> u32 {
        self as u32
    }

    /// Returns true if this is a Porter-Duff compositing operator.
    pub fn is_porter_duff(self) -> bool {
        self.to_u32() >= 100
    }
}

/// Apply a Porter-Duff compositing operator to premultiplied RGBA values.
/// All inputs/outputs are in 0.0–1.0 premultiplied space.
/// Returns (r, g, b, a).
pub fn porter_duff_composite(
    sr: f32, sg: f32, sb: f32, sa: f32,
    dr: f32, dg: f32, db: f32, da: f32,
    mode: BlendMode,
) -> (f32, f32, f32, f32) {
    // Porter-Duff factor pairs: (Fa, Fb) where result = src * Fa + dst * Fb
    let (fa, fb) = match mode {
        BlendMode::Clear       => (0.0, 0.0),
        BlendMode::Copy        => (1.0, 0.0),
        BlendMode::Destination => (0.0, 1.0),
        BlendMode::SrcOver     => (1.0, 1.0 - sa),
        BlendMode::DstOver     => (1.0 - da, 1.0),
        BlendMode::SrcIn       => (da, 0.0),
        BlendMode::DstIn       => (0.0, sa),
        BlendMode::SrcOut      => (1.0 - da, 0.0),
        BlendMode::DstOut      => (0.0, 1.0 - sa),
        BlendMode::SrcAtop     => (da, 1.0 - sa),
        BlendMode::DstAtop     => (1.0 - da, sa),
        BlendMode::Xor         => (1.0 - da, 1.0 - sa),
        BlendMode::Plus        => (1.0, 1.0),
        // Photoshop modes use SrcOver compositing
        _                      => (1.0, 1.0 - sa),
    };

    let r = (sr * fa + dr * fb).clamp(0.0, 1.0);
    let g = (sg * fa + dg * fb).clamp(0.0, 1.0);
    let b = (sb * fa + db * fb).clamp(0.0, 1.0);
    let a = (sa * fa + da * fb).clamp(0.0, 1.0);
    (r, g, b, a)
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
        for i in 100..=112 {
            let mode = BlendMode::from_u32(i);
            assert_eq!(mode.to_u32(), i);
        }
    }

    #[test]
    fn test_from_u32_unknown_defaults_to_normal() {
        assert_eq!(BlendMode::from_u32(50), BlendMode::Normal);
        assert_eq!(BlendMode::from_u32(u32::MAX), BlendMode::Normal);
    }

    #[test]
    fn test_photoshop_variants_distinct() {
        let modes: Vec<BlendMode> = (0..=19).map(BlendMode::from_u32).collect();
        for (i, a) in modes.iter().enumerate() {
            for (j, b) in modes.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "Modes at index {} and {} should differ", i, j);
                }
            }
        }
    }

    #[test]
    fn test_porter_duff_variants_distinct() {
        let modes: Vec<BlendMode> = (100..=112).map(BlendMode::from_u32).collect();
        for (i, a) in modes.iter().enumerate() {
            for (j, b) in modes.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b);
                }
            }
        }
    }

    #[test]
    fn test_is_porter_duff() {
        assert!(!BlendMode::Normal.is_porter_duff());
        assert!(!BlendMode::Multiply.is_porter_duff());
        assert!(BlendMode::Clear.is_porter_duff());
        assert!(BlendMode::DstOut.is_porter_duff());
        assert!(BlendMode::SrcOver.is_porter_duff());
    }

    #[test]
    fn test_clear_composite() {
        let (r, g, b, a) = porter_duff_composite(
            1.0, 0.0, 0.0, 1.0,
            0.0, 1.0, 0.0, 1.0,
            BlendMode::Clear,
        );
        assert_eq!((r, g, b, a), (0.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn test_copy_composite() {
        let (r, g, b, a) = porter_duff_composite(
            0.5, 0.0, 0.0, 0.5,
            0.0, 1.0, 0.0, 1.0,
            BlendMode::Copy,
        );
        assert!((r - 0.5).abs() < 0.001);
        assert!((a - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_dst_out_erases() {
        // Fully opaque source should completely erase destination
        let (_, _, _, a) = porter_duff_composite(
            0.0, 0.0, 0.0, 1.0,
            0.0, 0.5, 0.0, 0.5,
            BlendMode::DstOut,
        );
        assert!(a.abs() < 0.001, "DstOut with sa=1.0 should erase: a={a}");
    }

    #[test]
    fn test_dst_out_partial_erase() {
        // Half-opaque source should halve destination alpha
        let (_, _, _, a) = porter_duff_composite(
            0.0, 0.0, 0.0, 0.5,
            0.0, 1.0, 0.0, 1.0,
            BlendMode::DstOut,
        );
        assert!((a - 0.5).abs() < 0.001, "DstOut with sa=0.5 should halve: a={a}");
    }

    #[test]
    fn test_src_over_matches_normal_compositing() {
        let (r, g, b, a) = porter_duff_composite(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.25, 0.0, 0.5,
            BlendMode::SrcOver,
        );
        // SrcOver: result = src + dst * (1 - sa)
        assert!((r - 0.5).abs() < 0.001);
        assert!((g - 0.125).abs() < 0.001);
        assert!((a - 0.75).abs() < 0.001);
    }

    #[test]
    fn test_plus_additive() {
        let (r, _, _, a) = porter_duff_composite(
            0.3, 0.0, 0.0, 0.3,
            0.4, 0.0, 0.0, 0.5,
            BlendMode::Plus,
        );
        assert!((r - 0.7).abs() < 0.001);
        assert!((a - 0.8).abs() < 0.001);
    }
}
