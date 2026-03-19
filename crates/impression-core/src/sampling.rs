use crate::color::{apply_blend, Color};
use crate::layer::Layer;

/// Sample the composited color at (x, y) across all visible layers,
/// over the background color. Applies each layer's blend mode.
pub fn sample_color(layers: &[Layer], background_color: &Color, x: u32, y: u32) -> [u8; 3] {
    let mut dr = background_color.r as f32 / 255.0;
    let mut dg = background_color.g as f32 / 255.0;
    let mut db = background_color.b as f32 / 255.0;
    let mut da: f32 = 1.0;

    for layer in layers {
        if !layer.visible {
            continue;
        }
        if let Some(px) = layer.pixel(x, y) {
            let src_a = (px[3] as f32 / 255.0) * layer.opacity;
            if src_a <= 0.0 {
                continue;
            }
            let sr = px[0] as f32 / 255.0;
            let sg = px[1] as f32 / 255.0;
            let sb = px[2] as f32 / 255.0;

            let (br, bg, bb) = apply_blend(sr, sg, sb, dr, dg, db, layer.blend_mode);

            dr = src_a * br + (1.0 - src_a) * dr;
            dg = src_a * bg + (1.0 - src_a) * dg;
            db = src_a * bb + (1.0 - src_a) * db;
            da = src_a + da * (1.0 - src_a);
        }
    }

    [
        (dr * 255.0 + 0.5).min(255.0) as u8,
        (dg * 255.0 + 0.5).min(255.0) as u8,
        (db * 255.0 + 0.5).min(255.0) as u8,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blend_mode::BlendMode;

    #[test]
    fn test_sample_color_background_only() {
        let bg = Color::white();
        let c = sample_color(&[], &bg, 5, 5);
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_with_opaque_layer() {
        let bg = Color::white();
        let mut layer = Layer::new(0, 10, 10);
        *layer.pixel_mut(3, 3).unwrap() = [255, 0, 0, 255];

        let c = sample_color(&[layer], &bg, 3, 3);
        assert_eq!(c, [255, 0, 0]);
    }

    #[test]
    fn test_sample_color_unpainted_pixel_is_background() {
        let bg = Color::white();
        let layer = Layer::new(0, 10, 10);

        let c = sample_color(&[layer], &bg, 0, 0);
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_invisible_layer_ignored() {
        let bg = Color::white();
        let mut layer = Layer::new(0, 10, 10);
        *layer.pixel_mut(3, 3).unwrap() = [255, 0, 0, 255];
        layer.visible = false;

        let c = sample_color(&[layer], &bg, 3, 3);
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_with_multiply_blend() {
        let bg = Color::white();
        let mut layer = Layer::new(0, 10, 10);
        *layer.pixel_mut(3, 3).unwrap() = [128, 128, 128, 255];
        layer.blend_mode = BlendMode::Multiply;

        let c = sample_color(&[layer], &bg, 3, 3);
        assert!((c[0] as i32 - 128).abs() <= 1);
    }

    #[test]
    fn test_sample_color_with_screen_blend() {
        let bg = Color::new(128, 128, 128);
        let mut layer = Layer::new(0, 10, 10);
        *layer.pixel_mut(3, 3).unwrap() = [128, 128, 128, 255];
        layer.blend_mode = BlendMode::Screen;

        let c = sample_color(&[layer], &bg, 3, 3);
        assert!((c[0] as i32 - 192).abs() <= 2);
    }

    #[test]
    fn test_sample_color_normal_blend_matches_alpha_over() {
        let bg = Color::white();
        let mut layer = Layer::new(0, 10, 10);
        *layer.pixel_mut(3, 3).unwrap() = [255, 0, 0, 255];
        layer.blend_mode = BlendMode::Normal;

        let c = sample_color(&[layer], &bg, 3, 3);
        assert_eq!(c, [255, 0, 0]);
    }
}
