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
    fn test_blend_zero_alpha_noop() {
        let mut dst = [100u8, 100, 100, 200];
        let original = dst;
        blend_pixel(&mut dst, Color::new(255, 0, 0), 0.0);
        assert_eq!(dst, original);
    }
}
