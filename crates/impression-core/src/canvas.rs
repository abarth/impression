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
    fn test_stroke_on_invalid_layer() {
        let mut canvas = Canvas::new(100, 100);
        // Should not panic
        canvas.stroke_begin(99, 50.0, 50.0, 1.0);
        canvas.stroke_move(99, 60.0, 50.0, 1.0);
        canvas.stroke_end();
    }
}
