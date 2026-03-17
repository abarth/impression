use crate::brush::{self, BrushSettings, StrokeState};
use crate::color::Color;
use crate::layer::Layer;
use crate::selection::SelectionMask;

pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<Layer>,
    pub brush: BrushSettings,
    pub stroke_state: StrokeState,
    pub background_color: Color,
    pub selection: Option<SelectionMask>,
    pub lasso_points: Vec<(f32, f32)>,
}

impl Canvas {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            layers: Vec::new(),
            brush: BrushSettings::default(),
            stroke_state: StrokeState::new(),
            background_color: Color::white(),
            selection: None,
            lasso_points: Vec::new(),
        }
    }

    pub fn add_layer(&mut self) -> u32 {
        let layer = Layer::new(self.width, self.height);
        let index = self.layers.len() as u32;
        self.layers.push(layer);
        index
    }

    pub fn layer(&self, index: u32) -> Option<&Layer> {
        self.layers.get(index as usize)
    }

    pub fn layer_mut(&mut self, index: u32) -> Option<&mut Layer> {
        self.layers.get_mut(index as usize)
    }

    pub fn remove_layer(&mut self, index: u32) -> bool {
        let i = index as usize;
        if i < self.layers.len() {
            self.layers.remove(i);
            true
        } else {
            false
        }
    }

    /// Sample the composited color at (x, y) across all visible layers,
    /// over the background color. Applies each layer's blend mode.
    /// Returns [R, G, B].
    pub fn sample_color(&self, x: u32, y: u32) -> [u8; 3] {
        // Start with the background color at full opacity (values in 0..1)
        let mut dr = self.background_color.r as f32 / 255.0;
        let mut dg = self.background_color.g as f32 / 255.0;
        let mut db = self.background_color.b as f32 / 255.0;
        let mut da: f32 = 1.0;

        for layer in &self.layers {
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

                // Apply blend mode, then composite with alpha
                let (br, bg, bb) =
                    crate::color::apply_blend(sr, sg, sb, dr, dg, db, layer.blend_mode);

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

    pub fn stroke_begin(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        let sel = self.selection.as_ref().map(|s| s.data.as_slice());
        if let Some(l) = self.layers.get_mut(layer as usize) {
            brush::stroke_begin(l, &mut self.stroke_state, &self.brush, x, y, pressure, sel);
        }
    }

    pub fn stroke_move(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        let sel = self.selection.as_ref().map(|s| s.data.as_slice());
        if let Some(l) = self.layers.get_mut(layer as usize) {
            brush::stroke_move(l, &mut self.stroke_state, &self.brush, x, y, pressure, sel);
        }
    }

    pub fn stroke_end(&mut self) {
        brush::stroke_end(&mut self.stroke_state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canvas_creation() {
        let canvas = Canvas::new(800, 600);
        assert_eq!(canvas.width, 800);
        assert_eq!(canvas.height, 600);
        assert!(canvas.layers.is_empty());
        assert_eq!(canvas.background_color, Color::white());
    }

    #[test]
    fn test_add_layers() {
        let mut canvas = Canvas::new(100, 100);
        assert_eq!(canvas.add_layer(), 0);
        assert_eq!(canvas.add_layer(), 1);
        assert_eq!(canvas.layers.len(), 2);
    }

    #[test]
    fn test_stroke_on_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_move(0, 60.0, 50.0, 1.0);
        canvas.stroke_end();

        let layer = canvas.layer(0).unwrap();
        assert!(layer.dirty);
        // Check that some pixels were drawn
        let px = layer.pixel(50, 50).unwrap();
        assert!(px[3] > 0, "Should have drawn at stroke start");
    }

    #[test]
    fn test_remove_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();
        canvas.add_layer();
        assert_eq!(canvas.layers.len(), 3);

        assert!(canvas.remove_layer(1));
        assert_eq!(canvas.layers.len(), 2);

        // Out of bounds
        assert!(!canvas.remove_layer(99));
        assert_eq!(canvas.layers.len(), 2);
    }

    #[test]
    fn test_sample_color_background_only() {
        let canvas = Canvas::new(10, 10);
        // No layers — should return the background color (white)
        let c = canvas.sample_color(5, 5);
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_with_opaque_layer() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255]; // opaque red
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 0, 0]);

        // Transparent pixel should show background
        let c2 = canvas.sample_color(0, 0);
        assert_eq!(c2, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_invisible_layer_ignored() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255];
            layer.visible = false;
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 255, 255]); // background shows through
    }

    #[test]
    fn test_sample_color_with_multiply_blend() {
        let mut canvas = Canvas::new(10, 10);
        // Background is white (255, 255, 255)
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [128, 128, 128, 255]; // opaque mid-gray
            layer.blend_mode = 2; // Multiply
        }
        let c = canvas.sample_color(3, 3);
        // Multiply: src * dst = 0.502 * 1.0 = 0.502 → ~128
        assert!((c[0] as i32 - 128).abs() <= 1);
        assert!((c[1] as i32 - 128).abs() <= 1);
        assert!((c[2] as i32 - 128).abs() <= 1);
    }

    #[test]
    fn test_sample_color_with_screen_blend() {
        let mut canvas = Canvas::new(10, 10);
        canvas.background_color = Color::new(128, 128, 128); // mid-gray bg
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [128, 128, 128, 255]; // opaque mid-gray
            layer.blend_mode = 6; // Screen
        }
        let c = canvas.sample_color(3, 3);
        // Screen: s + d - s*d ≈ 0.502 + 0.502 - 0.252 ≈ 0.752 → ~192
        assert!((c[0] as i32 - 192).abs() <= 2);
    }

    #[test]
    fn test_sample_color_normal_blend_matches_alpha_over() {
        // Normal blend (mode 0) should give same result as before
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255]; // opaque red
            layer.blend_mode = 0; // Normal
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 0, 0]);
    }

    #[test]
    fn test_stroke_on_invalid_layer() {
        let mut canvas = Canvas::new(100, 100);
        // Should not panic
        canvas.stroke_begin(99, 50.0, 50.0, 1.0);
        canvas.stroke_move(99, 60.0, 50.0, 1.0);
        canvas.stroke_end();
    }
}
