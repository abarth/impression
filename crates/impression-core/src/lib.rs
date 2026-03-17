mod blend_mode;
mod brush;
mod canvas;
mod color;
pub mod document;
mod layer;
pub mod operation;
pub mod oplog;
mod selection;

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
        self.inner.set_layer_opacity(layer, opacity);
    }

    /// Get the layer blend mode.
    pub fn layer_blend_mode(&self, layer: u32) -> u32 {
        self.inner
            .layer(layer)
            .map(|l| l.blend_mode.to_u32())
            .unwrap_or(0)
    }

    /// Set the layer blend mode.
    pub fn set_layer_blend_mode(&mut self, layer: u32, mode: u32) {
        self.inner
            .set_layer_blend_mode(layer, blend_mode::BlendMode::from_u32(mode));
    }

    /// Get the layer visibility.
    pub fn layer_visible(&self, layer: u32) -> bool {
        self.inner.layer(layer).map(|l| l.visible).unwrap_or(false)
    }

    /// Set the layer visibility.
    pub fn set_layer_visible(&mut self, layer: u32, visible: bool) {
        self.inner.set_layer_visible(layer, visible);
    }

    // -- Brush settings --

    pub fn set_brush_size(&mut self, size: f32) {
        self.inner.set_brush_size(size);
    }

    pub fn set_brush_spacing(&mut self, spacing: f32) {
        self.inner.set_brush_spacing(spacing);
    }

    pub fn set_brush_color(&mut self, r: u8, g: u8, b: u8) {
        self.inner.set_brush_color(r, g, b);
    }

    pub fn set_brush_opacity(&mut self, opacity: f32) {
        self.inner.set_brush_opacity(opacity);
    }

    pub fn set_brush_flow(&mut self, flow: f32) {
        self.inner.set_brush_flow(flow);
    }

    pub fn set_background_color(&mut self, r: u8, g: u8, b: u8) {
        self.inner.set_background_color(color::Color::new(r, g, b));
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
        self.inner.stroke_begin(layer, x, y, pressure);
    }

    pub fn stroke_move(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        self.inner.stroke_move(layer, x, y, pressure);
    }

    pub fn stroke_end(&mut self) {
        self.inner.stroke_end();
    }

    // -- Selection --

    /// Set selection from a rectangle. mode: 0=replace, 1=add, 2=subtract, 3=intersect.
    pub fn selection_rect(&mut self, x: u32, y: u32, w: u32, h: u32, mode: u8) {
        self.inner
            .selection_rect(x, y, w, h, selection::CombineMode::from_u8(mode));
    }

    /// Start collecting lasso polygon points.
    pub fn selection_lasso_begin(&mut self) {
        self.inner.selection_lasso_begin();
    }

    /// Add a point to the lasso polygon.
    pub fn selection_lasso_point(&mut self, x: f32, y: f32) {
        self.inner.selection_lasso_point(x, y);
    }

    /// Close the polygon and rasterize into the selection mask.
    pub fn selection_lasso_end(&mut self, mode: u8) {
        self.inner
            .selection_lasso_end(selection::CombineMode::from_u8(mode));
    }

    /// Select all (fill mask with 255).
    pub fn select_all(&mut self) {
        self.inner.select_all();
    }

    /// Clear the selection.
    pub fn deselect(&mut self) {
        self.inner.deselect();
    }

    /// Returns true if a selection mask is active.
    pub fn has_selection(&self) -> bool {
        self.inner.selection.is_some()
    }

    /// Pointer to selection mask data for GPU upload.
    pub fn selection_mask_ptr(&self) -> *const u8 {
        self.inner
            .selection
            .as_ref()
            .map(|s| s.data.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    /// Byte length of selection mask data.
    pub fn selection_mask_len(&self) -> usize {
        self.inner
            .selection
            .as_ref()
            .map(|s| s.data.len())
            .unwrap_or(0)
    }

    /// Check if selection mask has been modified.
    pub fn is_selection_dirty(&self) -> bool {
        self.inner
            .selection
            .as_ref()
            .map(|s| s.dirty)
            .unwrap_or(false)
    }

    /// Clear selection dirty flag.
    pub fn clear_selection_dirty(&mut self) {
        if let Some(ref mut s) = self.inner.selection {
            s.dirty = false;
        }
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

    /// Record canvas visibility change in oplog.
    pub fn set_canvas_visible(&mut self, visible: bool) {
        self.inner.set_canvas_visible(visible);
    }

    // -- Undo/Redo --

    pub fn can_undo(&self) -> bool {
        self.inner.oplog.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.inner.oplog.can_redo()
    }

    /// Get the number of active operations.
    pub fn active_operation_count(&self) -> usize {
        self.inner.oplog.active_len()
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
