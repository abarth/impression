use crate::brush::{self, BrushSettings, StrokeState};
use crate::color::Color;
use crate::layer::Layer;

pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<Layer>,
    pub brush: BrushSettings,
    pub stroke_state: StrokeState,
    pub background_color: Color,
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
    /// over the background color. Returns [R, G, B].
    pub fn sample_color(&self, x: u32, y: u32) -> [u8; 3] {
        // Start with the background color at full opacity
        let mut r = self.background_color.r as f32;
        let mut g = self.background_color.g as f32;
        let mut b = self.background_color.b as f32;
        let mut a: f32 = 1.0;

        for layer in &self.layers {
            if !layer.visible {
                continue;
            }
            if let Some(px) = layer.pixel(x, y) {
                let src_a = (px[3] as f32 / 255.0) * layer.opacity;
                if src_a <= 0.0 {
                    continue;
                }
                let src_r = px[0] as f32;
                let src_g = px[1] as f32;
                let src_b = px[2] as f32;

                // Alpha-over compositing (both dst and src in straight alpha)
                r = src_r * src_a + r * (1.0 - src_a);
                g = src_g * src_a + g * (1.0 - src_a);
                b = src_b * src_a + b * (1.0 - src_a);
                a = src_a + a * (1.0 - src_a);
            }
        }

        [
            (r + 0.5).min(255.0) as u8,
            (g + 0.5).min(255.0) as u8,
            (b + 0.5).min(255.0) as u8,
        ]
    }

    pub fn stroke_begin(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        if let Some(l) = self.layers.get_mut(layer as usize) {
            brush::stroke_begin(l, &mut self.stroke_state, &self.brush, x, y, pressure);
        }
    }

    pub fn stroke_move(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        if let Some(l) = self.layers.get_mut(layer as usize) {
            brush::stroke_move(l, &mut self.stroke_state, &self.brush, x, y, pressure);
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
    fn test_stroke_on_invalid_layer() {
        let mut canvas = Canvas::new(100, 100);
        // Should not panic
        canvas.stroke_begin(99, 50.0, 50.0, 1.0);
        canvas.stroke_move(99, 60.0, 50.0, 1.0);
        canvas.stroke_end();
    }
}
