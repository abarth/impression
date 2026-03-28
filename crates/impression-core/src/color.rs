#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Color {
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    pub fn white() -> Self {
        Self::new(255, 255, 255)
    }

    pub fn black() -> Self {
        Self::new(0, 0, 0)
    }
}

/// Alpha-over compositing of a single pixel.
/// `dst` is the existing RGBA pixel (premultiplied alpha).
/// `src_color` is the source RGB color.
/// `src_alpha` is the source alpha (0.0 - 1.0).
/// Result is written back to `dst` in straight alpha format.
pub fn blend_pixel(dst: &mut [u8; 4], src_color: Color, src_alpha: f32) {
    if src_alpha <= 0.0 {
        return;
    }

    let sa = src_alpha.min(1.0);
    let da = dst[3] as f32 / 255.0;

    let out_a = sa + da * (1.0 - sa);
    if out_a <= 0.0 {
        return;
    }

    let sr = src_color.r as f32 / 255.0;
    let sg = src_color.g as f32 / 255.0;
    let sb = src_color.b as f32 / 255.0;
    let dr = dst[0] as f32 / 255.0;
    let dg = dst[1] as f32 / 255.0;
    let db = dst[2] as f32 / 255.0;

    let out_r = (sr * sa + dr * da * (1.0 - sa)) / out_a;
    let out_g = (sg * sa + dg * da * (1.0 - sa)) / out_a;
    let out_b = (sb * sa + db * da * (1.0 - sa)) / out_a;

    dst[0] = (out_r * 255.0 + 0.5) as u8;
    dst[1] = (out_g * 255.0 + 0.5) as u8;
    dst[2] = (out_b * 255.0 + 0.5) as u8;
    dst[3] = (out_a * 255.0 + 0.5) as u8;
}

/// Apply a Photoshop blend mode to a single channel (values in 0.0..1.0).
/// `s` = source, `d` = destination.
fn blend_channel(s: f32, d: f32, mode: crate::blend_mode::BlendMode) -> f32 {
    use crate::blend_mode::BlendMode::*;
    match mode {
        Normal => s,        // Normal
        Darken => s.min(d), // Darken
        Multiply => s * d,  // Multiply
        ColorBurn => {
            // Color Burn
            if s == 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - d) / s).min(1.0)
            }
        }
        LinearBurn => (s + d - 1.0).max(0.0), // Linear Burn
        Lighten => s.max(d),                  // Lighten
        Screen => s + d - s * d,              // Screen
        ColorDodge => {
            // Color Dodge
            if s == 1.0 {
                1.0
            } else {
                (d / (1.0 - s)).min(1.0)
            }
        }
        LinearDodge => (s + d).min(1.0), // Linear Dodge (Add)
        Overlay => {
            // Overlay (Hard Light with src/dst swapped — test on d)
            if d < 0.5 {
                2.0 * s * d
            } else {
                1.0 - 2.0 * (1.0 - s) * (1.0 - d)
            }
        }
        SoftLight => {
            // Soft Light (W3C formula)
            if s <= 0.5 {
                d - (1.0 - 2.0 * s) * d * (1.0 - d)
            } else {
                let dd = if d <= 0.25 {
                    ((16.0 * d - 12.0) * d + 4.0) * d
                } else {
                    d.sqrt()
                };
                d + (2.0 * s - 1.0) * (dd - d)
            }
        }
        HardLight => {
            // Hard Light
            if s < 0.5 {
                2.0 * s * d
            } else {
                1.0 - 2.0 * (1.0 - s) * (1.0 - d)
            }
        }
        VividLight => {
            // Vivid Light
            if s <= 0.5 {
                if s == 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - d) / (2.0 * s)).min(1.0)
                }
            } else if s >= 1.0 {
                1.0
            } else {
                (d / (2.0 * (1.0 - s))).min(1.0)
            }
        }
        LinearLight => (d + 2.0 * s - 1.0).clamp(0.0, 1.0), // Linear Light
        PinLight => {
            // Pin Light
            if s <= 0.5 {
                d.min(2.0 * s)
            } else {
                d.max(2.0 * s - 1.0)
            }
        }
        HardMix => {
            // Hard Mix
            if s + d >= 1.0 {
                1.0
            } else {
                0.0
            }
        }
        Difference => (s - d).abs(),      // Difference
        Exclusion => s + d - 2.0 * s * d, // Exclusion
        Subtract => (d - s).max(0.0),     // Subtract
        Divide => {
            // Divide
            if s == 0.0 {
                1.0
            } else {
                (d / s).min(1.0)
            }
        }
        // Porter-Duff modes don't have per-channel blend functions;
        // they are handled at the compositing level. Fall back to Normal.
        _ => s,
    }
}

/// Apply a Photoshop blend mode to RGB channels (all values 0.0..1.0).
pub fn apply_blend(
    sr: f32,
    sg: f32,
    sb: f32,
    dr: f32,
    dg: f32,
    db: f32,
    mode: crate::blend_mode::BlendMode,
) -> (f32, f32, f32) {
    (
        blend_channel(sr, dr, mode),
        blend_channel(sg, dg, mode),
        blend_channel(sb, db, mode),
    )
}

/// Convert RGB (0.0–1.0 each) to HSL. Returns (h, s, l) where h is in degrees [0, 360).
pub fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) * 0.5;
    if (max - min).abs() < 1e-7 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if (max - r).abs() < 1e-7 {
        let mut h = (g - b) / d;
        if g < b {
            h += 6.0;
        }
        h
    } else if (max - g).abs() < 1e-7 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

/// Convert HSL to RGB (0.0–1.0 each). `h` is in degrees, `s` and `l` in [0, 1].
pub fn hsl_to_rgb(h: f32, s: f32, l: f32) -> [f32; 3] {
    if s.abs() < 1e-7 {
        return [l, l, l];
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let h_norm = ((h % 360.0) + 360.0) % 360.0 / 360.0;
    [
        hue_to_rgb(p, q, h_norm + 1.0 / 3.0),
        hue_to_rgb(p, q, h_norm),
        hue_to_rgb(p, q, h_norm - 1.0 / 3.0),
    ]
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 { t += 1.0; }
    if t > 1.0 { t -= 1.0; }
    if t < 1.0 / 6.0 {
        p + (q - p) * 6.0 * t
    } else if t < 0.5 {
        q
    } else if t < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - t) * 6.0
    } else {
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blend_onto_transparent() {
        let mut dst = [0u8, 0, 0, 0];
        blend_pixel(&mut dst, Color::new(255, 0, 0), 1.0);
        assert_eq!(dst, [255, 0, 0, 255]);
    }

    #[test]
    fn test_blend_half_alpha() {
        let mut dst = [0u8, 0, 0, 0];
        blend_pixel(&mut dst, Color::new(255, 0, 0), 0.5);
        assert_eq!(dst[0], 255); // red channel
        assert_eq!(dst[1], 0);
        assert_eq!(dst[2], 0);
        assert!((dst[3] as f32 - 128.0).abs() < 2.0);
    }

    #[test]
    fn test_blend_over_existing() {
        let mut dst = [255u8, 0, 0, 255]; // opaque red
        blend_pixel(&mut dst, Color::new(0, 0, 255), 0.5); // 50% blue over
                                                           // Result should be a mix, with full opacity
        assert_eq!(dst[3], 255);
        // 50% blue over opaque red: both channels should be ~128
        assert!((dst[0] as i32 - 128).abs() < 2);
        assert!((dst[2] as i32 - 128).abs() < 2);
    }

    #[test]
    fn test_apply_blend_normal() {
        let (r, g, b) = apply_blend(
            1.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            crate::blend_mode::BlendMode::Normal,
        );
        assert_eq!((r, g, b), (1.0, 0.0, 0.0));
    }

    #[test]
    fn test_apply_blend_multiply() {
        let (r, _, _) = apply_blend(
            0.5,
            0.5,
            0.5,
            1.0,
            1.0,
            1.0,
            crate::blend_mode::BlendMode::Multiply,
        );
        assert!((r - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_apply_blend_screen() {
        let (r, _, _) = apply_blend(
            0.5,
            0.5,
            0.5,
            0.5,
            0.5,
            0.5,
            crate::blend_mode::BlendMode::Screen,
        );
        // s + d - s*d = 0.5 + 0.5 - 0.25 = 0.75
        assert!((r - 0.75).abs() < 0.001);
    }

    #[test]
    fn test_apply_blend_difference() {
        let (r, _, _) = apply_blend(
            0.8,
            0.0,
            0.0,
            0.3,
            0.0,
            0.0,
            crate::blend_mode::BlendMode::Difference,
        );
        assert!((r - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_blend_zero_alpha_noop() {
        let mut dst = [100u8, 100, 100, 200];
        let original = dst;
        blend_pixel(&mut dst, Color::new(255, 0, 0), 0.0);
        assert_eq!(dst, original);
    }

    #[test]
    fn test_hsl_round_trip() {
        let colors: &[(f32, f32, f32)] = &[
            (1.0, 0.0, 0.0), // red
            (0.0, 1.0, 0.0), // green
            (0.0, 0.0, 1.0), // blue
            (0.5, 0.5, 0.5), // gray
            (1.0, 1.0, 1.0), // white
            (0.0, 0.0, 0.0), // black
            (0.8, 0.3, 0.6), // arbitrary
        ];
        for &(r, g, b) in colors {
            let (h, s, l) = rgb_to_hsl(r, g, b);
            let [r2, g2, b2] = hsl_to_rgb(h, s, l);
            assert!((r - r2).abs() < 0.01, "R mismatch: {} vs {} for ({},{},{})", r, r2, r, g, b);
            assert!((g - g2).abs() < 0.01, "G mismatch: {} vs {} for ({},{},{})", g, g2, r, g, b);
            assert!((b - b2).abs() < 0.01, "B mismatch: {} vs {} for ({},{},{})", b, b2, r, g, b);
        }
    }

    #[test]
    fn test_hsl_pure_red() {
        let (h, s, l) = rgb_to_hsl(1.0, 0.0, 0.0);
        assert!((h - 0.0).abs() < 0.01, "Red hue should be 0: {}", h);
        assert!((s - 1.0).abs() < 0.01, "Red saturation should be 1: {}", s);
        assert!((l - 0.5).abs() < 0.01, "Red lightness should be 0.5: {}", l);
    }

    #[test]
    fn test_hsl_gray() {
        let (_, s, l) = rgb_to_hsl(0.5, 0.5, 0.5);
        assert!(s.abs() < 0.01, "Gray saturation should be 0: {}", s);
        assert!((l - 0.5).abs() < 0.01, "Gray lightness should be 0.5: {}", l);
    }
}
