mod blend_mode;
mod brush;
mod canvas;
mod color;
pub mod document;
mod dynamics;
mod layer;
pub mod operation;
pub mod oplog;
mod replay;
mod sampling;
mod selection;
mod site;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ImpressionCanvas {
    inner: canvas::Canvas,
    flush_buffer: Vec<u8>,
}

#[wasm_bindgen]
impl ImpressionCanvas {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            inner: canvas::Canvas::new(width, height),
            flush_buffer: Vec::new(),
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

    /// Clear the dirty flag and bounds for a layer.
    pub fn clear_layer_dirty(&mut self, layer: u32) {
        if let Some(l) = self.inner.layer_mut(layer) {
            l.clear_dirty();
        }
    }

    /// Get the dirty region X origin (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_x(&self, layer: u32) -> u32 {
        self.inner.layer(layer).and_then(|l| l.dirty_bounds).map(|b| b.0).unwrap_or(0)
    }

    /// Get the dirty region Y origin (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_y(&self, layer: u32) -> u32 {
        self.inner.layer(layer).and_then(|l| l.dirty_bounds).map(|b| b.1).unwrap_or(0)
    }

    /// Get the dirty region width (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_width(&self, layer: u32) -> u32 {
        self.inner.layer(layer).and_then(|l| l.dirty_bounds).map(|b| b.2 - b.0 + 1).unwrap_or(0)
    }

    /// Get the dirty region height (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_height(&self, layer: u32) -> u32 {
        self.inner.layer(layer).and_then(|l| l.dirty_bounds).map(|b| b.3 - b.1 + 1).unwrap_or(0)
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

    pub fn set_brush_blend_mode(&mut self, mode: u32) {
        self.inner
            .set_brush_blend_mode(blend_mode::BlendMode::from_u32(mode));
    }

    pub fn set_brush_hardness(&mut self, hardness: f32) {
        self.inner.set_brush_hardness(hardness);
    }

    pub fn set_brush_roundness(&mut self, roundness: f32) {
        self.inner.set_brush_roundness(roundness);
    }

    pub fn set_brush_angle(&mut self, angle: f32) {
        self.inner.set_brush_angle(angle);
    }

    pub fn set_brush_flip_x(&mut self, flip: bool) {
        self.inner.set_brush_flip_x(flip);
    }

    pub fn set_brush_flip_y(&mut self, flip: bool) {
        self.inner.set_brush_flip_y(flip);
    }

    /// Register a custom brush tip image. Called from TypeScript before replay.
    pub fn register_brush_tip(&mut self, id: &str, pixels: &[u8], width: u32, height: u32) {
        self.inner.register_brush_tip(id.to_string(), pixels.to_vec(), width, height);
    }

    /// Set the active brush tip by ID (must be registered first).
    pub fn set_brush_tip(&mut self, id: &str) {
        self.inner.set_brush_tip(id);
    }

    /// Clear the active brush tip (revert to computed circle).
    pub fn clear_brush_tip(&mut self) {
        self.inner.clear_brush_tip();
    }

    /// Set shape dynamics. Control values: 0=Off, 1=PenPressure, 2=Random.
    pub fn set_shape_dynamics(
        &mut self,
        size_jitter: f32,
        size_control: u8,
        size_min: f32,
        angle_jitter: f32,
        angle_control: u8,
        roundness_jitter: f32,
        roundness_control: u8,
        roundness_min: f32,
    ) {
        use dynamics::{DynamicControl, DynamicParam, ShapeDynamics};
        self.inner.set_shape_dynamics(ShapeDynamics {
            size: DynamicParam {
                jitter: size_jitter,
                control: DynamicControl::from_u8(size_control),
                minimum: size_min,
            },
            angle: DynamicParam {
                jitter: angle_jitter,
                control: DynamicControl::from_u8(angle_control),
                minimum: 0.0, // angle minimum is not meaningful (additive)
            },
            roundness: DynamicParam {
                jitter: roundness_jitter,
                control: DynamicControl::from_u8(roundness_control),
                minimum: roundness_min,
            },
        });
    }

    /// Set transfer dynamics. Control values: 0=Off, 1=PenPressure, 2=Random.
    pub fn set_transfer_dynamics(
        &mut self,
        opacity_jitter: f32,
        opacity_control: u8,
        opacity_min: f32,
        flow_jitter: f32,
        flow_control: u8,
        flow_min: f32,
    ) {
        use dynamics::{DynamicControl, DynamicParam, TransferDynamics};
        self.inner.set_transfer_dynamics(TransferDynamics {
            opacity: DynamicParam {
                jitter: opacity_jitter,
                control: DynamicControl::from_u8(opacity_control),
                minimum: opacity_min,
            },
            flow: DynamicParam {
                jitter: flow_jitter,
                control: DynamicControl::from_u8(flow_control),
                minimum: flow_min,
            },
        });
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

    /// Clear the selected region on a layer, or the whole layer if no selection.
    pub fn clear_layer(&mut self, layer: u32) {
        self.inner.clear_layer(layer);
    }

    /// Get the layer name.
    pub fn layer_name(&self, layer: u32) -> String {
        self.inner
            .layer(layer)
            .map(|l| l.name.clone())
            .unwrap_or_default()
    }

    /// Rename a layer.
    pub fn rename_layer(&mut self, layer: u32, name: &str) {
        self.inner.rename_layer(layer, name.to_string());
    }

    /// Move a layer from one position to another.
    pub fn move_layer(&mut self, from_index: u32, to_index: u32) {
        self.inner.move_layer(from_index, to_index);
    }

    /// Returns true if the active site has a selection mask.
    pub fn has_selection(&self) -> bool {
        self.inner.sites.get(&self.inner.active_site)
            .and_then(|s| s.selection.as_ref())
            .is_some()
    }

    /// Pointer to the active site's selection mask data for GPU upload.
    pub fn selection_mask_ptr(&self) -> *const u8 {
        self.inner.sites.get(&self.inner.active_site)
            .and_then(|s| s.selection.as_ref())
            .map(|s| s.data.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    /// Byte length of the active site's selection mask data.
    pub fn selection_mask_len(&self) -> usize {
        self.inner.sites.get(&self.inner.active_site)
            .and_then(|s| s.selection.as_ref())
            .map(|s| s.data.len())
            .unwrap_or(0)
    }

    /// Check if the active site's selection mask has been modified.
    pub fn is_selection_dirty(&self) -> bool {
        self.inner.sites.get(&self.inner.active_site)
            .and_then(|s| s.selection.as_ref())
            .map(|s| s.dirty)
            .unwrap_or(false)
    }

    /// Clear the active site's selection dirty flag.
    pub fn clear_selection_dirty(&mut self) {
        if let Some(site) = self.inner.sites.get_mut(&self.inner.active_site) {
            if let Some(ref mut s) = site.selection {
                s.dirty = false;
            }
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
        self.inner.oplog.can_undo(self.inner.active_site)
    }

    pub fn can_redo(&self) -> bool {
        self.inner.oplog.can_redo(self.inner.active_site)
    }

    /// Undo the last operation group for the active site and replay.
    pub fn undo(&mut self) -> bool {
        self.inner.undo()
    }

    /// Redo the next operation group for the active site and replay.
    pub fn redo(&mut self) -> bool {
        self.inner.redo()
    }

    /// Get the number of active operations.
    pub fn active_operation_count(&self) -> usize {
        self.inner.oplog.active_len()
    }

    // -- Persistence --

    /// Number of active operations not yet flushed.
    pub fn pending_operation_count(&self) -> usize {
        self.inner.pending_operation_count()
    }

    /// Serialize and flush pending operations. Returns the byte length
    /// (0 if nothing to flush). Use `flush_data_ptr` to get the pointer.
    pub fn flush_pending_operations(&mut self) -> usize {
        match self.inner.flush_pending_operations() {
            Some(data) => {
                let len = data.len();
                self.flush_buffer = data;
                len
            }
            None => {
                self.flush_buffer.clear();
                0
            }
        }
    }

    /// Pointer to the last flushed data.
    pub fn flush_data_ptr(&self) -> *const u8 {
        self.flush_buffer.as_ptr()
    }

    /// Load a serialized chunk of operations (for loading saved documents).
    /// Returns true on success, false on deserialization error.
    pub fn load_chunk(&mut self, data: &[u8]) -> bool {
        self.inner.load_chunk(data).is_ok()
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
