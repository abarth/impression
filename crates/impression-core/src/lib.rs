mod brush;
mod canvas;
mod color;
mod layer;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ImpressionCanvas {
    inner: canvas::Canvas,
}

#[wasm_bindgen]
impl ImpressionCanvas {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            inner: canvas::Canvas::new(width, height),
        }
    }

    /// Add a new layer and return its index.
    pub fn add_layer(&mut self) -> u32 {
        self.inner.add_layer()
    }

    /// Get a pointer to the layer's pixel data in WASM memory.
    pub fn layer_pixels_ptr(&self, layer: u32) -> *const u8 {
        self.inner
            .layer(layer)
            .map(|l| l.pixels.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    /// Get the byte length of the layer's pixel data.
    pub fn layer_pixels_len(&self, layer: u32) -> usize {
        self.inner
            .layer(layer)
            .map(|l| l.pixels.len())
            .unwrap_or(0)
    }

    /// Check if a layer has been modified since the last clear.
    pub fn is_layer_dirty(&self, layer: u32) -> bool {
        self.inner.layer(layer).map(|l| l.dirty).unwrap_or(false)
    }

    /// Clear the dirty flag for a layer.
    pub fn clear_layer_dirty(&mut self, layer: u32) {
        if let Some(l) = self.inner.layer_mut(layer) {
            l.dirty = false;
        }
    }

    /// Remove a layer by index. Returns true if removed.
    pub fn remove_layer(&mut self, layer: u32) -> bool {
        self.inner.remove_layer(layer)
    }

    /// Get the number of layers.
    pub fn layer_count(&self) -> u32 {
        self.inner.layers.len() as u32
    }

    /// Get the layer opacity.
    pub fn layer_opacity(&self, layer: u32) -> f32 {
        self.inner.layer(layer).map(|l| l.opacity).unwrap_or(0.0)
    }

    /// Set the layer opacity.
    pub fn set_layer_opacity(&mut self, layer: u32, opacity: f32) {
        if let Some(l) = self.inner.layer_mut(layer) {
            l.opacity = opacity;
        }
    }

    // -- Brush settings --

    pub fn set_brush_size(&mut self, size: f32) {
        self.inner.brush.size = size;
    }

    pub fn set_brush_spacing(&mut self, spacing: f32) {
        self.inner.brush.spacing = spacing;
    }

    pub fn set_brush_color(&mut self, r: u8, g: u8, b: u8) {
        self.inner.brush.color = color::Color::new(r, g, b);
    }

    pub fn set_brush_opacity(&mut self, opacity: f32) {
        self.inner.brush.opacity = opacity;
    }

    pub fn set_brush_flow(&mut self, flow: f32) {
        self.inner.brush.flow = flow;
    }

    pub fn set_background_color(&mut self, r: u8, g: u8, b: u8) {
        self.inner.background_color = color::Color::new(r, g, b);
    }

    pub fn background_r(&self) -> u8 {
        self.inner.background_color.r
    }

    pub fn background_g(&self) -> u8 {
        self.inner.background_color.g
    }

    pub fn background_b(&self) -> u8 {
        self.inner.background_color.b
    }

    // -- Stroke input --

    pub fn stroke_begin(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        // Set layer opacity to brush opacity for compositing
        let opacity = self.inner.brush.opacity;
        if let Some(l) = self.inner.layer_mut(layer) {
            l.opacity = opacity;
        }
        self.inner.stroke_begin(layer, x, y, pressure);
    }

    pub fn stroke_move(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        self.inner.stroke_move(layer, x, y, pressure);
    }

    pub fn stroke_end(&mut self) {
        self.inner.stroke_end();
    }

    /// Sample the composited color at (x, y). Returns [R, G, B].
    pub fn sample_color_r(&self, x: u32, y: u32) -> u8 {
        self.inner.sample_color(x, y)[0]
    }

    pub fn sample_color_g(&self, x: u32, y: u32) -> u8 {
        self.inner.sample_color(x, y)[1]
    }

    pub fn sample_color_b(&self, x: u32, y: u32) -> u8 {
        self.inner.sample_color(x, y)[2]
    }

    /// Get canvas width.
    pub fn width(&self) -> u32 {
        self.inner.width
    }

    /// Get canvas height.
    pub fn height(&self) -> u32 {
        self.inner.height
    }
}
