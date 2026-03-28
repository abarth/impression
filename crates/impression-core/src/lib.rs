mod blend_mode;
mod brush;
mod canvas;
mod color;
pub mod document;
mod dynamics;
mod execute;
mod layer;
pub mod operation;
pub mod oplog;
mod replay;
mod sampling;
mod selection;
mod site;
pub mod stroke;
pub mod wet_media;

use wasm_bindgen::prelude::*;
#[cfg(all(target_arch = "wasm32", not(test)))]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

#[cfg(any(not(target_arch = "wasm32"), test))]
pub fn log(s: &str) {
    println!("{}", s);
}

#[macro_export]
macro_rules! console_log {
     ($($t:tt)*) => (crate::log(&format!($($t)*)))
 }

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
        self.inner.layer(layer).map(|l| l.pixels.len()).unwrap_or(0)
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
        self.inner
            .layer(layer)
            .and_then(|l| l.dirty_bounds)
            .map(|b| b.0)
            .unwrap_or(0)
    }

    /// Get the dirty region Y origin (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_y(&self, layer: u32) -> u32 {
        self.inner
            .layer(layer)
            .and_then(|l| l.dirty_bounds)
            .map(|b| b.1)
            .unwrap_or(0)
    }

    /// Get the dirty region width (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_width(&self, layer: u32) -> u32 {
        self.inner
            .layer(layer)
            .and_then(|l| l.dirty_bounds)
            .map(|b| b.2 - b.0 + 1)
            .unwrap_or(0)
    }

    /// Get the dirty region height (in pixels). Returns 0 if not dirty.
    pub fn layer_dirty_height(&self, layer: u32) -> u32 {
        self.inner
            .layer(layer)
            .and_then(|l| l.dirty_bounds)
            .map(|b| b.3 - b.1 + 1)
            .unwrap_or(0)
    }

    /// Remove a layer by index. Returns true if removed.
    pub fn remove_layer(&mut self, layer: u32) -> bool {
        self.inner.remove_layer(layer)
    }

    /// Get the number of layers.
    pub fn layer_count(&self) -> u32 {
        self.inner.layers.len() as u32
    }

    /// Add an adjustment layer. kind: 0 = GradientMap. Returns layer index.
    pub fn add_adjustment_layer(&mut self, kind: u32, gradient_id: &str) -> u32 {
        let adj_kind = match kind {
            0 => layer::AdjustmentKind::GradientMap {
                gradient_id: gradient_id.to_string(),
            },
            _ => layer::AdjustmentKind::GradientMap {
                gradient_id: gradient_id.to_string(),
            },
        };
        self.inner.add_adjustment_layer(adj_kind)
    }

    /// Check if a layer is an adjustment layer.
    pub fn is_adjustment_layer(&self, layer_idx: u32) -> bool {
        self.inner
            .layer(layer_idx)
            .map(|l| l.is_adjustment())
            .unwrap_or(false)
    }

    /// Get the LayerId for a layer at a given index (as f64 since JS doesn't have u64).
    pub fn layer_id(&self, layer_idx: u32) -> f64 {
        self.inner
            .layer(layer_idx)
            .map(|l| l.id as f64)
            .unwrap_or(0.0)
    }

    /// Get layer kind: 0 = Raster, 1 = GradientMap, 2 = WetMedia.
    pub fn layer_kind(&self, layer_idx: u32) -> u32 {
        match self.inner.layer(layer_idx) {
            Some(l) => match &l.kind {
                layer::LayerKind::Raster => 0,
                layer::LayerKind::Adjustment(layer::AdjustmentKind::GradientMap { .. }) => 1,
                layer::LayerKind::WetMedia => 2,
            },
            None => 0,
        }
    }

    /// Add a wet media layer (paint state lives on GPU). Returns layer index.
    pub fn add_wet_media_layer(&mut self) -> u32 {
        self.inner.add_wet_media_layer()
    }

    /// Number of pending wet media footprints for the active site.
    pub fn wet_media_footprint_count(&self) -> u32 {
        self.inner.site().wet_media_stroke.footprints.len() as u32
    }

    /// Pointer to the mask data of a wet media footprint.
    pub fn wet_media_footprint_mask_ptr(&self, index: u32) -> *const f32 {
        self.inner
            .site()
            .wet_media_stroke
            .footprints
            .get(index as usize)
            .map(|fp| fp.mask.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    /// Length (in f32 elements) of the mask data of a wet media footprint.
    pub fn wet_media_footprint_mask_len(&self, index: u32) -> u32 {
        self.inner
            .site()
            .wet_media_stroke
            .footprints
            .get(index as usize)
            .map(|fp| fp.mask.len() as u32)
            .unwrap_or(0)
    }

    /// Width of a wet media footprint mask.
    pub fn wet_media_footprint_width(&self, index: u32) -> u32 {
        self.inner
            .site()
            .wet_media_stroke
            .footprints
            .get(index as usize)
            .map(|fp| fp.width)
            .unwrap_or(0)
    }

    /// Height of a wet media footprint mask.
    pub fn wet_media_footprint_height(&self, index: u32) -> u32 {
        self.inner
            .site()
            .wet_media_stroke
            .footprints
            .get(index as usize)
            .map(|fp| fp.height)
            .unwrap_or(0)
    }

    /// Get footprint parameters as a JsValue object.
    pub fn wet_media_footprint_params(&self, index: u32) -> JsValue {
        match self
            .inner
            .site()
            .wet_media_stroke
            .footprints
            .get(index as usize)
        {
            Some(fp) => {
                // Return as a flat array: [origin_x, origin_y, r, g, b, paint_load,
                //                          velocity_x, velocity_y, mixing_strength,
                //                          paint_thickness, wetness, width, height,
                //                          canvas_texture_strength, viscosity,
                //                          opacity_multiplier]
                let params: [f32; 16] = [
                    fp.origin_x,
                    fp.origin_y,
                    fp.paint_color[0],
                    fp.paint_color[1],
                    fp.paint_color[2],
                    fp.paint_load,
                    fp.velocity[0],
                    fp.velocity[1],
                    fp.mixing_strength,
                    fp.paint_thickness,
                    fp.wetness,
                    fp.width as f32,
                    fp.height as f32,
                    fp.canvas_texture_strength,
                    fp.viscosity,
                    fp.opacity_multiplier,
                ];
                serde_wasm_bindgen::to_value(&params).unwrap_or(JsValue::NULL)
            }
            None => JsValue::NULL,
        }
    }

    /// Clear all pending wet media footprints for the active site.
    pub fn wet_media_clear_footprints(&mut self) {
        self.inner.site_mut().wet_media_stroke.footprints.clear();
    }

    /// Record a WetMediaSimStep operation in the oplog.
    /// Called by TS before each wet media stroke to record how many simulation
    /// frames elapsed since the last stroke, enabling deterministic replay.
    pub fn record_wet_media_sim_step(&mut self, layer_id_hi: u32, layer_id_lo: u32, frames: u32) {
        if frames == 0 {
            return;
        }
        let layer = ((layer_id_hi as u64) << 32) | (layer_id_lo as u64);
        self.inner.apply(operation::Operation::WetMediaSimStep { layer, frames });
    }

    /// Number of wet media replay events from the most recent undo/redo.
    pub fn wet_media_replay_event_count(&self) -> u32 {
        self.inner.wet_media_replay_events.len() as u32
    }

    /// Get the type of a replay event: 0 = Deposit, 1 = SimStep.
    pub fn wet_media_replay_event_type(&self, index: u32) -> u32 {
        match self.inner.wet_media_replay_events.get(index as usize) {
            Some(canvas::WetMediaReplayEvent::Deposit { .. }) => 0,
            Some(canvas::WetMediaReplayEvent::SimStep { .. }) => 1,
            None => u32::MAX,
        }
    }

    /// For a Deposit replay event, get the footprint mask pointer.
    pub fn wet_media_replay_deposit_mask_ptr(&self, index: u32) -> *const f32 {
        match self.inner.wet_media_replay_events.get(index as usize) {
            Some(canvas::WetMediaReplayEvent::Deposit { footprint, .. }) => footprint.mask.as_ptr(),
            _ => std::ptr::null(),
        }
    }

    /// For a Deposit replay event, get the footprint mask length (in f32 elements).
    pub fn wet_media_replay_deposit_mask_len(&self, index: u32) -> u32 {
        match self.inner.wet_media_replay_events.get(index as usize) {
            Some(canvas::WetMediaReplayEvent::Deposit { footprint, .. }) => footprint.mask.len() as u32,
            _ => 0,
        }
    }

    /// For a Deposit replay event, get params as [originX, originY, r, g, b, load, vx, vy, mixing, thickness, wetness, maskW, maskH, canvasTextureStrength, viscosity].
    pub fn wet_media_replay_deposit_params(&self, index: u32) -> JsValue {
        match self.inner.wet_media_replay_events.get(index as usize) {
            Some(canvas::WetMediaReplayEvent::Deposit { footprint, .. }) => {
                let fp = footprint;
                let arr: js_sys::Float32Array = js_sys::Float32Array::new_with_length(16);
                arr.set_index(0, fp.origin_x);
                arr.set_index(1, fp.origin_y);
                arr.set_index(2, fp.paint_color[0]);
                arr.set_index(3, fp.paint_color[1]);
                arr.set_index(4, fp.paint_color[2]);
                arr.set_index(5, fp.paint_load);
                arr.set_index(6, fp.velocity[0]);
                arr.set_index(7, fp.velocity[1]);
                arr.set_index(8, fp.mixing_strength);
                arr.set_index(9, fp.paint_thickness);
                arr.set_index(10, fp.wetness);
                arr.set_index(11, fp.width as f32);
                arr.set_index(12, fp.height as f32);
                arr.set_index(13, fp.canvas_texture_strength);
                arr.set_index(14, fp.viscosity);
                arr.set_index(15, fp.opacity_multiplier);
                arr.into()
            }
            _ => JsValue::NULL,
        }
    }

    /// For a Deposit replay event, get the target layer index.
    pub fn wet_media_replay_deposit_layer(&self, index: u32) -> u32 {
        match self.inner.wet_media_replay_events.get(index as usize) {
            Some(canvas::WetMediaReplayEvent::Deposit { layer, .. }) => {
                self.inner.layer_index_by_id(*layer).unwrap_or(u32::MAX as usize) as u32
            }
            _ => u32::MAX,
        }
    }

    /// For a SimStep replay event, get the layer index and frame count as [layerIdx, frames].
    pub fn wet_media_replay_sim_step_params(&self, index: u32) -> JsValue {
        match self.inner.wet_media_replay_events.get(index as usize) {
            Some(canvas::WetMediaReplayEvent::SimStep { layer, frames }) => {
                let layer_idx = self.inner.layer_index_by_id(*layer).unwrap_or(u32::MAX as usize) as u32;
                let arr: js_sys::Uint32Array = js_sys::Uint32Array::new_with_length(2);
                arr.set_index(0, layer_idx);
                arr.set_index(1, *frames);
                arr.into()
            }
            _ => JsValue::NULL,
        }
    }

    /// Clear replay events after TS has consumed them.
    pub fn wet_media_clear_replay_events(&mut self) {
        self.inner.wet_media_replay_events.clear();
    }

    /// Get the gradient ID for a gradient map adjustment layer.
    pub fn gradient_map_gradient_id(&self, layer_idx: u32) -> Option<String> {
        match self.inner.layer(layer_idx) {
            Some(l) => match &l.kind {
                layer::LayerKind::Adjustment(layer::AdjustmentKind::GradientMap {
                    gradient_id,
                }) => Some(gradient_id.clone()),
                _ => None,
            },
            None => None,
        }
    }

    /// Set the gradient ID for a gradient map adjustment layer.
    pub fn set_gradient_map_gradient(&mut self, layer_idx: u32, gradient_id: &str) {
        self.inner.set_adjustment_data(
            layer_idx,
            layer::AdjustmentKind::GradientMap {
                gradient_id: gradient_id.to_string(),
            },
        );
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

    /// Apply all brush settings at once. Called from TypeScript before
    /// stroke_begin. The settings are passed as a JsValue (serialized
    /// SerializableBrushSettings). The oplog entry is recorded automatically
    /// by stroke_begin.
    pub fn set_all_brush_settings(&mut self, settings: JsValue) -> Result<(), JsValue> {
        let s: brush::SerializableBrushSettings =
            serde_wasm_bindgen::from_value(settings).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner.apply_brush_settings(0, s);
        Ok(())
    }

    /// Register a custom brush tip image. Called from TypeScript before replay.
    pub fn register_brush_tip(&mut self, id: &str, pixels: &[u8], width: u32, height: u32) {
        self.inner
            .register_brush_tip(id.to_string(), pixels.to_vec(), width, height);
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
        self.inner.site().selection.as_ref().is_some()
    }

    /// Pointer to the active site's selection mask data for GPU upload.
    pub fn selection_mask_ptr(&self) -> *const u8 {
        self.inner
            .site()
            .selection
            .as_ref()
            .map(|s| s.data.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    /// Byte length of the active site's selection mask data.
    pub fn selection_mask_len(&self) -> usize {
        self.inner
            .site()
            .selection
            .as_ref()
            .map(|s| s.data.len())
            .unwrap_or(0)
    }

    /// Check if the active site's selection mask has been modified.
    pub fn is_selection_dirty(&self) -> bool {
        self.inner
            .site()
            .selection
            .as_ref()
            .map(|s| s.dirty)
            .unwrap_or(false)
    }

    /// Clear the active site's selection dirty flag.
    pub fn clear_selection_dirty(&mut self) {
        if let Some(ref mut s) = self.inner.site_mut().selection {
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
