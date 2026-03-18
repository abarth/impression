use std::collections::HashMap;

use crate::blend_mode::BlendMode;
use crate::brush::{self, BrushSettings, StrokeState};
use crate::color::Color;
use crate::layer::Layer;
use crate::operation::{LayerId, Operation, SiteId, SiteOperation};
use crate::oplog::OpLog;
use crate::selection::{CombineMode, SelectionMask};

/// Per-site state: brush settings, selection, stroke state, and lasso points.
/// Each connected user (site) has their own isolated copy of these.
/// See docs/multiplayer-design.md.
pub struct SiteState {
    pub brush: BrushSettings,
    pub stroke_state: StrokeState,
    pub selection: Option<SelectionMask>,
    pub lasso_points: Vec<(f32, f32)>,
    /// The layer currently being stroked (used during replay).
    pub stroke_layer: LayerId,
}

impl Default for SiteState {
    fn default() -> Self {
        Self {
            brush: BrushSettings::default(),
            stroke_state: StrokeState::new(),
            selection: None,
            lasso_points: Vec::new(),
            stroke_layer: 0,
        }
    }
}

pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<Layer>,
    /// Per-site state (brush, selection, stroke). Keyed by SiteId.
    pub sites: HashMap<SiteId, SiteState>,
    /// The currently active site for operations.
    pub active_site: SiteId,
    pub background_color: Color,
    pub oplog: OpLog,
    /// Counter for generating unique LayerIds. Combined with active_site
    /// to produce globally unique IDs: `(active_site << 32) | layer_id_counter`.
    layer_id_counter: u32,
}

impl Canvas {
    pub fn new(width: u32, height: u32) -> Self {
        let mut sites = HashMap::new();
        sites.insert(0, SiteState::default());
        Self {
            width,
            height,
            layers: Vec::new(),
            sites,
            active_site: 0,
            background_color: Color::white(),
            oplog: OpLog::new(),
            layer_id_counter: 0,
        }
    }

    /// Get the active site's state.
    pub(crate) fn site(&self) -> &SiteState {
        self.sites.get(&self.active_site).expect("active site must exist")
    }

    /// Get the active site's state mutably.
    fn site_mut(&mut self) -> &mut SiteState {
        self.sites.entry(self.active_site).or_default()
    }

    /// Get a specific site's state mutably.
    fn site_for_mut(&mut self, site: SiteId) -> &mut SiteState {
        self.sites.entry(site).or_default()
    }

    /// Generate a new globally unique LayerId for the active site.
    fn next_layer_id(&mut self) -> LayerId {
        let id = ((self.active_site as u64) << 32) | self.layer_id_counter as u64;
        self.layer_id_counter += 1;
        id
    }

    // -- Layer access by index (for WASM API) --

    pub fn layer(&self, index: u32) -> Option<&Layer> {
        self.layers.get(index as usize)
    }

    pub fn layer_mut(&mut self, index: u32) -> Option<&mut Layer> {
        self.layers.get_mut(index as usize)
    }

    // -- Layer access by ID --

    fn layer_by_id_mut(&mut self, id: LayerId) -> Option<&mut Layer> {
        self.layers.iter_mut().find(|l| l.id == id)
    }

    fn layer_index_by_id(&self, id: LayerId) -> Option<usize> {
        self.layers.iter().position(|l| l.id == id)
    }

    // -- Operations --

    pub fn add_layer(&mut self) -> u32 {
        let id = self.next_layer_id();
        let layer = Layer::new(id, self.width, self.height);
        let index = self.layers.len() as u32;
        self.layers.push(layer);
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::AddLayer { id },
        });
        index
    }

    pub fn remove_layer(&mut self, index: u32) -> bool {
        let i = index as usize;
        if i < self.layers.len() {
            let id = self.layers[i].id;
            self.layers.remove(i);
            self.oplog.begin_undo_group(self.active_site);
            self.oplog.push(SiteOperation {
                site: self.active_site,
                op: Operation::RemoveLayer(id),
            });
            true
        } else {
            false
        }
    }

    pub fn set_layer_opacity(&mut self, index: u32, opacity: f32) {
        if let Some(l) = self.layers.get_mut(index as usize) {
            let id = l.id;
            l.opacity = opacity;
            self.oplog.begin_undo_group(self.active_site);
            self.oplog.push(SiteOperation {
                site: self.active_site,
                op: Operation::SetLayerOpacity { layer: id, opacity },
            });
        }
    }

    pub fn set_layer_blend_mode(&mut self, index: u32, mode: BlendMode) {
        if let Some(l) = self.layers.get_mut(index as usize) {
            let id = l.id;
            l.blend_mode = mode;
            self.oplog.begin_undo_group(self.active_site);
            self.oplog.push(SiteOperation {
                site: self.active_site,
                op: Operation::SetLayerBlendMode { layer: id, mode },
            });
        }
    }

    pub fn set_layer_visible(&mut self, index: u32, visible: bool) {
        if let Some(l) = self.layers.get_mut(index as usize) {
            let id = l.id;
            l.visible = visible;
            self.oplog.begin_undo_group(self.active_site);
            self.oplog.push(SiteOperation {
                site: self.active_site,
                op: Operation::SetLayerVisible { layer: id, visible },
            });
        }
    }

    pub fn set_background_color(&mut self, color: Color) {
        self.background_color = color;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBackgroundColor {
                r: color.r,
                g: color.g,
                b: color.b,
            },
        });
    }

    pub fn set_canvas_visible(&mut self, visible: bool) {
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetCanvasVisible(visible),
        });
    }

    // -- Brush settings (per-site) --

    pub fn set_brush_size(&mut self, size: f32) {
        self.site_mut().brush.size = size;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBrushSize(size),
        });
    }

    pub fn set_brush_spacing(&mut self, spacing: f32) {
        self.site_mut().brush.spacing = spacing;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBrushSpacing(spacing),
        });
    }

    pub fn set_brush_color(&mut self, r: u8, g: u8, b: u8) {
        self.site_mut().brush.color = Color::new(r, g, b);
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBrushColor { r, g, b },
        });
    }

    pub fn set_brush_opacity(&mut self, opacity: f32) {
        self.site_mut().brush.opacity = opacity;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBrushOpacity(opacity),
        });
    }

    pub fn set_brush_flow(&mut self, flow: f32) {
        self.site_mut().brush.flow = flow;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBrushFlow(flow),
        });
    }

    pub fn set_brush_blend_mode(&mut self, mode: BlendMode) {
        self.site_mut().brush.blend_mode = mode;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SetBrushBlendMode(mode),
        });
    }

    /// Sample the composited color at (x, y) across all visible layers,
    /// over the background color. Applies each layer's blend mode.
    pub fn sample_color(&self, x: u32, y: u32) -> [u8; 3] {
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

    // -- Strokes --

    pub fn stroke_begin(&mut self, layer_index: u32, x: f32, y: f32, pressure: f32) {
        let layer_id = match self.layers.get(layer_index as usize) {
            Some(l) => l.id,
            None => return,
        };
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::StrokeBegin { layer: layer_id, x, y, pressure },
        });
        let site = self.active_site;
        let site_state = self.sites.get(&site).unwrap();
        let sel_data: Option<Vec<u8>> = site_state.selection.as_ref().map(|s| s.data.clone());
        let brush = site_state.brush.clone();
        let sel_ref = sel_data.as_deref();
        if let Some(l) = self.layers.get_mut(layer_index as usize) {
            let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
            brush::stroke_begin(l, stroke_state, &brush, x, y, pressure, sel_ref);
        }
    }

    pub fn stroke_move(&mut self, layer_index: u32, x: f32, y: f32, pressure: f32) {
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::StrokeMove { x, y, pressure },
        });
        let site = self.active_site;
        let site_state = self.sites.get(&site).unwrap();
        let sel_data: Option<Vec<u8>> = site_state.selection.as_ref().map(|s| s.data.clone());
        let brush = site_state.brush.clone();
        let sel_ref = sel_data.as_deref();
        if let Some(l) = self.layers.get_mut(layer_index as usize) {
            let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
            brush::stroke_move(l, stroke_state, &brush, x, y, pressure, sel_ref);
        }
    }

    pub fn stroke_end(&mut self) {
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::StrokeEnd,
        });
        brush::stroke_end(&mut self.site_mut().stroke_state);
    }

    // -- Selection operations --

    pub fn selection_rect(&mut self, x: u32, y: u32, w: u32, h: u32, mode: CombineMode) {
        let (width, height) = (self.width, self.height);
        let site = self.sites.entry(self.active_site).or_default();
        if mode == CombineMode::Replace || site.selection.is_none() {
            let mut mask = SelectionMask::new(width, height);
            mask.fill_rect(x, y, w, h, CombineMode::Replace);
            site.selection = Some(mask);
        } else if let Some(ref mut mask) = site.selection {
            mask.fill_rect(x, y, w, h, mode);
        }
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SelectionRect { x, y, w, h, mode },
        });
    }

    pub fn selection_lasso_begin(&mut self) {
        self.site_mut().lasso_points.clear();
    }

    pub fn selection_lasso_point(&mut self, x: f32, y: f32) {
        self.site_mut().lasso_points.push((x, y));
    }

    pub fn selection_lasso_end(&mut self, mode: CombineMode) {
        let (width, height) = (self.width, self.height);
        let site = self.sites.entry(self.active_site).or_default();
        let points: Vec<(f32, f32)> = site.lasso_points.drain(..).collect();
        if mode == CombineMode::Replace || site.selection.is_none() {
            let mut mask = SelectionMask::new(width, height);
            mask.fill_polygon(&points, CombineMode::Replace);
            site.selection = Some(mask);
        } else if let Some(ref mut mask) = site.selection {
            mask.fill_polygon(&points, mode);
        }
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SelectionLasso { points, mode },
        });
    }

    pub fn select_all(&mut self) {
        let (width, height) = (self.width, self.height);
        let site = self.sites.entry(self.active_site).or_default();
        let mut mask = SelectionMask::new_full(width, height);
        mask.dirty = true;
        site.selection = Some(mask);
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::SelectAll,
        });
    }

    pub fn deselect(&mut self) {
        self.site_mut().selection = None;
        self.oplog.begin_undo_group(self.active_site);
        self.oplog.push(SiteOperation {
            site: self.active_site,
            op: Operation::Deselect,
        });
    }

    // -- Undo/Redo (per-site) --

    pub fn undo(&mut self) -> bool {
        if self.oplog.undo(self.active_site) {
            self.replay_active();
            true
        } else {
            false
        }
    }

    pub fn redo(&mut self) -> bool {
        if self.oplog.redo(self.active_site) {
            self.replay_active();
            true
        } else {
            false
        }
    }

    // -- Persistence --

    pub fn pending_operation_count(&self) -> usize {
        self.oplog.pending_flush_count()
    }

    pub fn flush_pending_operations(&mut self) -> Option<Vec<u8>> {
        self.oplog.flush_pending()
    }

    pub fn load_chunk(&mut self, data: &[u8]) -> Result<(), postcard::Error> {
        let ops = crate::operation::deserialize_operations(data)?;
        for site_op in ops {
            match &site_op.op {
                Operation::StrokeBegin { .. }
                | Operation::AddLayer { .. }
                | Operation::RemoveLayer(_)
                | Operation::SetBrushSize(_)
                | Operation::SetBrushSpacing(_)
                | Operation::SetBrushColor { .. }
                | Operation::SetBrushOpacity(_)
                | Operation::SetBrushFlow(_)
                | Operation::SetBrushBlendMode(_)
                | Operation::SetLayerOpacity { .. }
                | Operation::SetLayerBlendMode { .. }
                | Operation::SetLayerVisible { .. }
                | Operation::SetBackgroundColor { .. }
                | Operation::SetCanvasVisible(_)
                | Operation::SelectionRect { .. }
                | Operation::SelectionLasso { .. }
                | Operation::SelectAll
                | Operation::Deselect
                | Operation::CreateCanvas { .. } => {
                    self.oplog.begin_undo_group(site_op.site);
                }
                Operation::StrokeMove { .. } | Operation::StrokeEnd => {}
            }
            self.oplog.push(site_op.clone());
            self.execute_op(site_op);
        }
        Ok(())
    }

    /// Clear all state and replay active operations from the oplog.
    /// Only marks layers as dirty if their pixel content actually changed.
    fn replay_active(&mut self) {
        // Fingerprint each layer's pixels before replay
        let old_fingerprints: Vec<u64> = self.layers.iter().map(|l| l.pixel_fingerprint()).collect();
        let old_count = self.layers.len();

        // Reset all state
        self.layers.clear();
        for site_state in self.sites.values_mut() {
            *site_state = SiteState::default();
        }
        self.background_color = Color::white();
        self.layer_id_counter = 0;

        // Clone the active operations to avoid borrow conflict
        let ops = self.oplog.active_operations();

        // Replay each operation without recording
        for site_op in ops {
            self.execute_op(site_op);
        }

        // Compare fingerprints: only mark layers dirty if their pixels changed
        for (i, layer) in self.layers.iter_mut().enumerate() {
            if i < old_count {
                let new_fp = layer.pixel_fingerprint();
                if new_fp == old_fingerprints[i] {
                    layer.clear_dirty();
                } else {
                    layer.mark_fully_dirty();
                }
            } else {
                layer.mark_fully_dirty();
            }
        }
    }

    /// Execute a single operation without recording to the oplog.
    fn execute_op(&mut self, site_op: SiteOperation) {
        let site = site_op.site;
        match site_op.op {
            Operation::CreateCanvas { .. } => {
                // Canvas dimensions are fixed; ignore during replay
            }
            Operation::StrokeBegin { layer, x, y, pressure } => {
                self.sites.entry(site).or_default().stroke_layer = layer;
                let site_state = self.sites.get(&site).unwrap();
                let sel_data: Option<Vec<u8>> = site_state.selection.as_ref().map(|s| s.data.clone());
                let brush = site_state.brush.clone();
                let sel_ref = sel_data.as_deref();
                if let Some(l) = self.layers.iter_mut().find(|l| l.id == layer) {
                    let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
                    brush::stroke_begin(l, stroke_state, &brush, x, y, pressure, sel_ref);
                }
            }
            Operation::StrokeMove { x, y, pressure } => {
                let site_state = self.sites.get(&site).unwrap();
                let stroke_layer = site_state.stroke_layer;
                let sel_data: Option<Vec<u8>> = site_state.selection.as_ref().map(|s| s.data.clone());
                let brush = site_state.brush.clone();
                let sel_ref = sel_data.as_deref();
                if let Some(l) = self.layers.iter_mut().find(|l| l.id == stroke_layer) {
                    let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
                    brush::stroke_move(l, stroke_state, &brush, x, y, pressure, sel_ref);
                }
            }
            Operation::StrokeEnd => {
                brush::stroke_end(&mut self.site_for_mut(site).stroke_state);
            }
            Operation::SetBrushSize(size) => self.site_for_mut(site).brush.size = size,
            Operation::SetBrushSpacing(spacing) => self.site_for_mut(site).brush.spacing = spacing,
            Operation::SetBrushColor { r, g, b } => self.site_for_mut(site).brush.color = Color::new(r, g, b),
            Operation::SetBrushOpacity(opacity) => self.site_for_mut(site).brush.opacity = opacity,
            Operation::SetBrushFlow(flow) => self.site_for_mut(site).brush.flow = flow,
            Operation::SetBrushBlendMode(mode) => self.site_for_mut(site).brush.blend_mode = mode,
            Operation::AddLayer { id } => {
                self.layers.push(Layer::new(id, self.width, self.height));
                // Keep layer_id_counter past any loaded IDs
                let counter = (id & 0xFFFFFFFF) as u32;
                if counter >= self.layer_id_counter {
                    self.layer_id_counter = counter + 1;
                }
            }
            Operation::RemoveLayer(id) => {
                if let Some(idx) = self.layer_index_by_id(id) {
                    self.layers.remove(idx);
                }
            }
            Operation::SetLayerOpacity { layer, opacity } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.opacity = opacity;
                }
            }
            Operation::SetLayerBlendMode { layer, mode } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.blend_mode = mode;
                }
            }
            Operation::SetLayerVisible { layer, visible } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.visible = visible;
                }
            }
            Operation::SetBackgroundColor { r, g, b } => {
                self.background_color = Color::new(r, g, b);
            }
            Operation::SetCanvasVisible(_) => {
                // Tracked on the TS side
            }
            Operation::SelectionRect { x, y, w, h, mode } => {
                let (width, height) = (self.width, self.height);
                let site_state = self.sites.entry(site).or_default();
                if mode == CombineMode::Replace || site_state.selection.is_none() {
                    let mut mask = SelectionMask::new(width, height);
                    mask.fill_rect(x, y, w, h, CombineMode::Replace);
                    site_state.selection = Some(mask);
                } else if let Some(ref mut mask) = site_state.selection {
                    mask.fill_rect(x, y, w, h, mode);
                }
            }
            Operation::SelectionLasso { points, mode } => {
                let (width, height) = (self.width, self.height);
                let site_state = self.sites.entry(site).or_default();
                if mode == CombineMode::Replace || site_state.selection.is_none() {
                    let mut mask = SelectionMask::new(width, height);
                    mask.fill_polygon(&points, CombineMode::Replace);
                    site_state.selection = Some(mask);
                } else if let Some(ref mut mask) = site_state.selection {
                    mask.fill_polygon(&points, mode);
                }
            }
            Operation::SelectAll => {
                let (width, height) = (self.width, self.height);
                let site_state = self.sites.entry(site).or_default();
                let mut mask = SelectionMask::new_full(width, height);
                mask.dirty = true;
                site_state.selection = Some(mask);
            }
            Operation::Deselect => {
                self.site_for_mut(site).selection = None;
            }
        }
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
        // Layer IDs should be unique
        assert_ne!(canvas.layers[0].id, canvas.layers[1].id);
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

        assert!(!canvas.remove_layer(99));
        assert_eq!(canvas.layers.len(), 2);
    }

    #[test]
    fn test_sample_color_background_only() {
        let canvas = Canvas::new(10, 10);
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
            *px = [255, 0, 0, 255];
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 0, 0]);

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
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_with_multiply_blend() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [128, 128, 128, 255];
            layer.blend_mode = BlendMode::Multiply;
        }
        let c = canvas.sample_color(3, 3);
        assert!((c[0] as i32 - 128).abs() <= 1);
    }

    #[test]
    fn test_sample_color_with_screen_blend() {
        let mut canvas = Canvas::new(10, 10);
        canvas.background_color = Color::new(128, 128, 128);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [128, 128, 128, 255];
            layer.blend_mode = BlendMode::Screen;
        }
        let c = canvas.sample_color(3, 3);
        assert!((c[0] as i32 - 192).abs() <= 2);
    }

    #[test]
    fn test_sample_color_normal_blend_matches_alpha_over() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255];
            layer.blend_mode = BlendMode::Normal;
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 0, 0]);
    }

    #[test]
    fn test_stroke_on_invalid_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.stroke_begin(99, 50.0, 50.0, 1.0);
        canvas.stroke_move(99, 60.0, 50.0, 1.0);
        canvas.stroke_end();
    }

    #[test]
    fn test_oplog_records_stroke() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        let pre = canvas.oplog.active_len();
        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_move(0, 60.0, 50.0, 0.9);
        canvas.stroke_end();

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), pre + 3);
        assert!(matches!(ops[pre].op, Operation::StrokeBegin { .. }));
        assert!(matches!(ops[pre + 1].op, Operation::StrokeMove { .. }));
        assert!(matches!(ops[pre + 2].op, Operation::StrokeEnd));
    }

    #[test]
    fn test_oplog_records_property_changes() {
        let mut canvas = Canvas::new(100, 100);
        canvas.set_brush_size(30.0);
        canvas.set_brush_color(255, 0, 0);

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op, Operation::SetBrushSize(30.0));
        assert_eq!(ops[1].op, Operation::SetBrushColor { r: 255, g: 0, b: 0 });
    }

    #[test]
    fn test_oplog_stroke_is_one_undo_group() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        canvas.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas.stroke_move(0, 20.0, 10.0, 1.0);
        canvas.stroke_move(0, 30.0, 10.0, 1.0);
        canvas.stroke_end();

        let before = canvas.oplog.active_len();
        assert!(canvas.oplog.undo(0));
        let after = canvas.oplog.active_len();
        assert_eq!(before - after, 4); // StrokeBegin + 2*StrokeMove + StrokeEnd
    }

    #[test]
    fn test_oplog_records_layer_operations() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        let layer_id = canvas.layers[0].id;
        canvas.set_layer_opacity(0, 0.5);
        canvas.set_layer_blend_mode(0, BlendMode::Multiply);
        canvas.set_layer_visible(0, false);

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 4);
        assert!(matches!(ops[0].op, Operation::AddLayer { .. }));
        assert!(matches!(ops[1].op, Operation::SetLayerOpacity { opacity, .. } if (opacity - 0.5).abs() < 0.001));
        assert!(matches!(ops[2].op, Operation::SetLayerBlendMode { mode: BlendMode::Multiply, .. }));
        assert!(matches!(ops[3].op, Operation::SetLayerVisible { visible: false, .. }));
    }

    #[test]
    fn test_oplog_records_selection() {
        let mut canvas = Canvas::new(100, 100);
        canvas.select_all();
        canvas.deselect();

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 2);
        assert!(matches!(ops[0].op, Operation::SelectAll));
        assert!(matches!(ops[1].op, Operation::Deselect));
    }

    #[test]
    fn test_undo_stroke_clears_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_move(0, 60.0, 50.0, 1.0);
        canvas.stroke_end();

        let px = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert!(px[3] > 0);

        assert!(canvas.undo());
        assert_eq!(canvas.layers.len(), 1);
        let px = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert_eq!(px[3], 0, "Layer should be clear after undoing stroke");
    }

    #[test]
    fn test_undo_redo_restores_stroke() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_move(0, 60.0, 50.0, 1.0);
        canvas.stroke_end();

        let px_before = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert!(px_before[3] > 0);

        canvas.undo();
        assert!(canvas.redo());

        let px_after = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert_eq!(px_before, px_after, "Redo should restore the stroke");
    }

    #[test]
    fn test_undo_nothing_returns_false() {
        let mut canvas = Canvas::new(100, 100);
        assert!(!canvas.undo());
    }

    #[test]
    fn test_undo_brush_size_reverts() {
        let mut canvas = Canvas::new(100, 100);
        canvas.set_brush_size(30.0);
        assert!((canvas.site().brush.size - 30.0).abs() < 0.01);

        canvas.undo();
        assert!(
            (canvas.site().brush.size - 10.0).abs() < 0.01,
            "Brush size should revert to default after undo"
        );
    }

    #[test]
    fn test_undo_two_strokes_keeps_first() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_end();

        canvas.stroke_begin(0, 80.0, 80.0, 1.0);
        canvas.stroke_end();

        canvas.undo();

        let px1 = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert!(px1[3] > 0, "First stroke should remain after undoing second");

        let px2 = canvas.layer(0).unwrap().pixel(80, 80).unwrap();
        assert_eq!(px2[3], 0, "Second stroke should be gone after undo");
    }

    #[test]
    fn test_undo_only_dirties_changed_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();

        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_end();
        canvas.layers[0].clear_dirty();
        canvas.layers[1].clear_dirty();

        canvas.stroke_begin(1, 50.0, 50.0, 1.0);
        canvas.stroke_end();
        canvas.layers[0].clear_dirty();
        canvas.layers[1].clear_dirty();

        canvas.undo();

        assert!(!canvas.layers[0].dirty, "Unchanged layer should not be dirty after undo");
        assert!(canvas.layers[1].dirty, "Changed layer should be dirty after undo");
    }

    #[test]
    fn test_redo_only_dirties_changed_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();

        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_end();
        canvas.stroke_begin(1, 50.0, 50.0, 1.0);
        canvas.stroke_end();

        canvas.undo();
        canvas.layers[0].clear_dirty();
        canvas.layers[1].clear_dirty();

        canvas.redo();

        assert!(!canvas.layers[0].dirty, "Unchanged layer should not be dirty after redo");
        assert!(canvas.layers[1].dirty, "Changed layer should be dirty after redo");
    }

    #[test]
    fn test_load_chunk_replays_operations() {
        let mut canvas1 = Canvas::new(50, 50);
        canvas1.add_layer();
        canvas1.stroke_begin(0, 25.0, 25.0, 1.0);
        canvas1.stroke_end();

        let data = canvas1.flush_pending_operations().unwrap();

        let mut canvas2 = Canvas::new(50, 50);
        assert!(canvas2.load_chunk(&data).is_ok());

        assert_eq!(canvas2.layers.len(), 1);
        let px = canvas2.layer(0).unwrap().pixel(25, 25).unwrap();
        assert!(px[3] > 0, "Loaded canvas should have drawn pixels");
    }

    #[test]
    fn test_load_chunk_restores_brush_settings() {
        let mut canvas1 = Canvas::new(50, 50);
        canvas1.set_brush_size(42.0);
        canvas1.set_brush_flow(0.3);

        let data = canvas1.flush_pending_operations().unwrap();

        let mut canvas2 = Canvas::new(50, 50);
        canvas2.load_chunk(&data).unwrap();

        assert!((canvas2.site().brush.size - 42.0).abs() < 0.01);
        assert!((canvas2.site().brush.flow - 0.3).abs() < 0.01);
    }

    #[test]
    fn test_layer_ids_are_globally_unique() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();
        canvas.add_layer();

        let ids: Vec<LayerId> = canvas.layers.iter().map(|l| l.id).collect();
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                assert_ne!(ids[i], ids[j], "Layer IDs must be unique");
            }
        }
    }

    #[test]
    fn test_operations_use_layer_ids_not_indices() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        let layer_id = canvas.layers[0].id;
        canvas.set_layer_opacity(0, 0.5);

        let ops = canvas.oplog.active_operations();
        match &ops[1].op {
            Operation::SetLayerOpacity { layer, .. } => {
                assert_eq!(*layer, layer_id, "Operation should reference LayerId, not index");
            }
            _ => panic!("Expected SetLayerOpacity"),
        }
    }
}
