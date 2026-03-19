use std::collections::HashMap;

use crate::blend_mode::BlendMode;
use crate::brush::BrushTip;
use crate::color::Color;
use crate::dynamics::{ShapeDynamics, TransferDynamics};
use crate::layer::Layer;
use crate::operation::{LayerId, Operation, SiteId, SiteOperation};
use crate::oplog::OpLog;
use crate::replay::{Checkpoint, CHECKPOINT_INTERVAL};
use crate::selection::CombineMode;
use crate::site::SiteState;

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
    pub(crate) layer_id_counter: u32,
    /// Periodic state checkpoints for incremental undo/redo.
    pub(crate) checkpoints: Vec<Checkpoint>,
    /// Registry of custom brush tip images, keyed by tip ID.
    pub tip_registry: HashMap<String, BrushTip>,
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
            checkpoints: Vec::new(),
            tip_registry: HashMap::new(),
        }
    }

    /// Register a custom brush tip image in the tip registry.
    pub fn register_brush_tip(&mut self, id: String, pixels: Vec<u8>, width: u32, height: u32) {
        self.tip_registry.insert(id, BrushTip { pixels, width, height });
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
    pub(crate) fn site_for_mut(&mut self, site: SiteId) -> &mut SiteState {
        self.sites.entry(site).or_default()
    }

    /// Generate a new globally unique LayerId for the active site.
    fn next_layer_id(&mut self) -> LayerId {
        let id = ((self.active_site as u64) << 32) | self.layer_id_counter as u64;
        self.layer_id_counter += 1;
        id
    }

    /// Begin a new undo group for the active site, taking a checkpoint if due.
    fn begin_group(&mut self) {
        // After begin_undo_group discards redo groups, invalidate stale checkpoints
        self.oplog.begin_undo_group(self.active_site);
        let group_count = self.oplog.group_count();
        self.checkpoints.retain(|cp| cp.group_count <= group_count);

        // Take a checkpoint every CHECKPOINT_INTERVAL active groups
        let active_groups = self.oplog.active_group_count();
        if active_groups > 0 && active_groups % CHECKPOINT_INTERVAL == 0 {
            self.take_checkpoint();
        }
    }

    /// Record an operation as a new undo group and execute it.
    fn apply(&mut self, op: Operation) {
        let site_op = SiteOperation { site: self.active_site, op };
        self.begin_group();
        self.oplog.push(site_op.clone());
        self.execute_op(site_op);
    }

    /// Record an operation in the current undo group and execute it.
    fn apply_continue(&mut self, op: Operation) {
        let site_op = SiteOperation { site: self.active_site, op };
        self.oplog.push(site_op.clone());
        self.execute_op(site_op);
    }

    // -- Layer access by index (for WASM API) --

    pub fn layer(&self, index: u32) -> Option<&Layer> {
        self.layers.get(index as usize)
    }

    pub fn layer_mut(&mut self, index: u32) -> Option<&mut Layer> {
        self.layers.get_mut(index as usize)
    }

    // -- Layer access by ID --

    pub(crate) fn layer_by_id_mut(&mut self, id: LayerId) -> Option<&mut Layer> {
        self.layers.iter_mut().find(|l| l.id == id)
    }

    pub(crate) fn layer_index_by_id(&self, id: LayerId) -> Option<usize> {
        self.layers.iter().position(|l| l.id == id)
    }

    // -- Operations --

    pub fn add_layer(&mut self) -> u32 {
        let id = self.next_layer_id();
        self.apply(Operation::AddLayer { id });
        (self.layers.len() - 1) as u32
    }

    pub fn remove_layer(&mut self, index: u32) -> bool {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::RemoveLayer(id));
            true
        } else {
            false
        }
    }

    pub fn set_layer_opacity(&mut self, index: u32, opacity: f32) {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::SetLayerOpacity { layer: id, opacity });
        }
    }

    pub fn set_layer_blend_mode(&mut self, index: u32, mode: BlendMode) {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::SetLayerBlendMode { layer: id, mode });
        }
    }

    pub fn set_layer_visible(&mut self, index: u32, visible: bool) {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::SetLayerVisible { layer: id, visible });
        }
    }

    pub fn set_background_color(&mut self, color: Color) {
        self.apply(Operation::SetBackgroundColor {
            r: color.r,
            g: color.g,
            b: color.b,
        });
    }

    pub fn set_canvas_visible(&mut self, visible: bool) {
        self.apply(Operation::SetCanvasVisible(visible));
    }

    // -- Brush settings (per-site) --

    pub fn set_brush_size(&mut self, size: f32) {
        self.apply(Operation::SetBrushSize(size));
    }

    pub fn set_brush_spacing(&mut self, spacing: f32) {
        self.apply(Operation::SetBrushSpacing(spacing));
    }

    pub fn set_brush_color(&mut self, r: u8, g: u8, b: u8) {
        self.apply(Operation::SetBrushColor { r, g, b });
    }

    pub fn set_brush_opacity(&mut self, opacity: f32) {
        self.apply(Operation::SetBrushOpacity(opacity));
    }

    pub fn set_brush_flow(&mut self, flow: f32) {
        self.apply(Operation::SetBrushFlow(flow));
    }

    pub fn set_brush_blend_mode(&mut self, mode: BlendMode) {
        self.apply(Operation::SetBrushBlendMode(mode));
    }

    pub fn set_brush_hardness(&mut self, hardness: f32) {
        self.apply(Operation::SetBrushHardness(hardness));
    }

    pub fn set_brush_roundness(&mut self, roundness: f32) {
        self.apply(Operation::SetBrushRoundness(roundness));
    }

    pub fn set_brush_angle(&mut self, angle: f32) {
        self.apply(Operation::SetBrushAngle(angle));
    }

    pub fn set_brush_tip(&mut self, id: &str) {
        self.apply(Operation::SetBrushTip(Some(id.to_string())));
    }

    pub fn clear_brush_tip(&mut self) {
        self.apply(Operation::SetBrushTip(None));
    }

    pub fn set_shape_dynamics(&mut self, dynamics: ShapeDynamics) {
        self.apply(Operation::SetShapeDynamics(dynamics));
    }

    pub fn set_transfer_dynamics(&mut self, dynamics: TransferDynamics) {
        self.apply(Operation::SetTransferDynamics(dynamics));
    }

    /// Sample the composited color at (x, y) across all visible layers,
    /// over the background color. Applies each layer's blend mode.
    pub fn sample_color(&self, x: u32, y: u32) -> [u8; 3] {
        crate::sampling::sample_color(&self.layers, &self.background_color, x, y)
    }

    // -- Strokes --

    pub fn stroke_begin(&mut self, layer_index: u32, x: f32, y: f32, pressure: f32) {
        let layer_id = match self.layers.get(layer_index as usize) {
            Some(l) => l.id,
            None => return,
        };
        self.apply(Operation::StrokeBegin { layer: layer_id, x, y, pressure });
    }

    pub fn stroke_move(&mut self, _layer_index: u32, x: f32, y: f32, pressure: f32) {
        self.apply_continue(Operation::StrokeMove { x, y, pressure });
    }

    pub fn stroke_end(&mut self) {
        self.apply_continue(Operation::StrokeEnd);
    }

    // -- Selection operations --

    pub fn selection_rect(&mut self, x: u32, y: u32, w: u32, h: u32, mode: CombineMode) {
        self.apply(Operation::SelectionRect { x, y, w, h, mode });
    }

    pub fn selection_lasso_begin(&mut self) {
        self.site_mut().lasso_points.clear();
    }

    pub fn selection_lasso_point(&mut self, x: f32, y: f32) {
        self.site_mut().lasso_points.push((x, y));
    }

    pub fn selection_lasso_end(&mut self, mode: CombineMode) {
        let points: Vec<(f32, f32)> = self.site_mut().lasso_points.drain(..).collect();
        self.apply(Operation::SelectionLasso { points, mode });
    }

    pub fn select_all(&mut self) {
        self.apply(Operation::SelectAll);
    }

    pub fn deselect(&mut self) {
        self.apply(Operation::Deselect);
    }

    /// Clear the selected region on a layer (or the whole layer if no selection).
    pub fn clear_layer(&mut self, index: u32) {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::ClearLayer { layer: id });
        }
    }

    /// Rename a layer.
    pub fn rename_layer(&mut self, index: u32, name: String) {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::RenameLayer { layer: id, name });
        }
    }

    /// Move a layer to a new position. `to_index` is the target index in the
    /// layer stack. The layer at `from_index` is removed and re-inserted so
    /// that it ends up at `to_index`.
    pub fn move_layer(&mut self, from_index: u32, to_index: u32) {
        if from_index == to_index {
            return;
        }
        let from = from_index as usize;
        if from >= self.layers.len() {
            return;
        }
        let layer_id = self.layers[from].id;
        // Determine the `before` LayerId: the layer currently at to_index
        // after the source is conceptually removed.
        let before = if (to_index as usize) >= self.layers.len() {
            None
        } else {
            // Build the list without the source to find what's at to_index
            let without_src: Vec<LayerId> = self.layers.iter()
                .filter(|l| l.id != layer_id)
                .map(|l| l.id)
                .collect();
            let ti = to_index as usize;
            if ti < without_src.len() {
                Some(without_src[ti])
            } else {
                None
            }
        };
        self.apply(Operation::MoveLayer { layer: layer_id, before });
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
                | Operation::SetBrushHardness(_)
                | Operation::SetBrushRoundness(_)
                | Operation::SetBrushAngle(_)
                | Operation::SetBrushTip(_)
                | Operation::SetLayerOpacity { .. }
                | Operation::SetLayerBlendMode { .. }
                | Operation::SetLayerVisible { .. }
                | Operation::SetBackgroundColor { .. }
                | Operation::SetCanvasVisible(_)
                | Operation::SelectionRect { .. }
                | Operation::SelectionLasso { .. }
                | Operation::SelectAll
                | Operation::Deselect
                | Operation::ClearLayer { .. }
                | Operation::RenameLayer { .. }
                | Operation::MoveLayer { .. }
                | Operation::SetShapeDynamics(_)
                | Operation::SetTransferDynamics(_)
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

    // -- Multi-site integration tests --

    /// Helper to switch the active site on a canvas.
    fn switch_site(canvas: &mut Canvas, site: SiteId) {
        canvas.active_site = site;
        // Ensure site state exists
        canvas.sites.entry(site).or_default();
    }

    #[test]
    fn test_multi_site_interleaved_strokes() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer(); // layer 0
        canvas.add_layer(); // layer 1

        // Site 0 draws on layer 0
        switch_site(&mut canvas, 0);
        canvas.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas.stroke_move(0, 20.0, 10.0, 1.0);
        canvas.stroke_end();

        // Site 1 draws on layer 1
        switch_site(&mut canvas, 1);
        canvas.stroke_begin(1, 50.0, 50.0, 1.0);
        canvas.stroke_move(1, 60.0, 50.0, 1.0);
        canvas.stroke_end();

        // Both strokes should be present
        let px0 = canvas.layer(0).unwrap().pixel(10, 10).unwrap();
        assert!(px0[3] > 0, "Site 0's stroke should be on layer 0");

        let px1 = canvas.layer(1).unwrap().pixel(50, 50).unwrap();
        assert!(px1[3] > 0, "Site 1's stroke should be on layer 1");
    }

    #[test]
    fn test_multi_site_undo_isolation() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();

        // Site 0 draws on layer 0
        switch_site(&mut canvas, 0);
        canvas.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas.stroke_end();

        // Site 1 draws on layer 1
        switch_site(&mut canvas, 1);
        canvas.stroke_begin(1, 50.0, 50.0, 1.0);
        canvas.stroke_end();

        // Undo site 1 — should only affect site 1's stroke
        switch_site(&mut canvas, 1);
        assert!(canvas.undo());

        let px0 = canvas.layer(0).unwrap().pixel(10, 10).unwrap();
        assert!(px0[3] > 0, "Site 0's stroke should remain after site 1 undo");

        let px1 = canvas.layer(1).unwrap().pixel(50, 50).unwrap();
        assert_eq!(px1[3], 0, "Site 1's stroke should be gone after undo");
    }

    #[test]
    fn test_multi_site_undo_does_not_affect_other_site() {
        let mut canvas = Canvas::new(100, 100);

        // Site 0 changes brush
        switch_site(&mut canvas, 0);
        canvas.set_brush_size(30.0);

        // Site 1 changes brush
        switch_site(&mut canvas, 1);
        canvas.set_brush_size(50.0);

        // Undo site 0
        switch_site(&mut canvas, 0);
        canvas.undo();

        // Site 0 should revert to default
        assert!((canvas.sites.get(&0).unwrap().brush.size - 10.0).abs() < 0.01,
            "Site 0 brush should revert to default");

        // Site 1 should be unaffected
        assert!((canvas.sites.get(&1).unwrap().brush.size - 50.0).abs() < 0.01,
            "Site 1 brush should remain at 50");
    }

    #[test]
    fn test_multi_site_independent_selections() {
        let mut canvas = Canvas::new(100, 100);

        // Site 0 makes a selection
        switch_site(&mut canvas, 0);
        canvas.selection_rect(10, 10, 20, 20, CombineMode::Replace);

        // Site 1 makes a different selection
        switch_site(&mut canvas, 1);
        canvas.selection_rect(50, 50, 30, 30, CombineMode::Replace);

        // Verify selections are independent
        let sel0 = canvas.sites.get(&0).unwrap().selection.as_ref().unwrap();
        let sel1 = canvas.sites.get(&1).unwrap().selection.as_ref().unwrap();

        // Site 0's selection should cover (15, 15) but not (55, 55)
        let idx_15_15 = (15 * 100 + 15) as usize;
        let idx_55_55 = (55 * 100 + 55) as usize;

        assert!(sel0.data[idx_15_15] > 0, "Site 0 should have selection at (15,15)");
        assert_eq!(sel0.data[idx_55_55], 0, "Site 0 should not have selection at (55,55)");

        assert_eq!(sel1.data[idx_15_15], 0, "Site 1 should not have selection at (15,15)");
        assert!(sel1.data[idx_55_55] > 0, "Site 1 should have selection at (55,55)");
    }

    #[test]
    fn test_multi_site_load_chunk() {
        let mut canvas1 = Canvas::new(50, 50);

        // Site 0 adds a layer and draws
        switch_site(&mut canvas1, 0);
        canvas1.add_layer();
        canvas1.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas1.stroke_end();

        // Site 1 changes brush
        switch_site(&mut canvas1, 1);
        canvas1.set_brush_size(42.0);

        let data = canvas1.flush_pending_operations().unwrap();

        // Load into fresh canvas
        let mut canvas2 = Canvas::new(50, 50);
        assert!(canvas2.load_chunk(&data).is_ok());

        // Verify state
        assert_eq!(canvas2.layers.len(), 1);
        let px = canvas2.layer(0).unwrap().pixel(10, 10).unwrap();
        assert!(px[3] > 0, "Loaded canvas should have site 0's stroke");

        // Site 1's brush size should be restored
        assert!((canvas2.sites.get(&1).unwrap().brush.size - 42.0).abs() < 0.01,
            "Site 1's brush size should be loaded");
    }

    #[test]
    fn test_multi_site_redo_isolation() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();

        // Site 0 draws
        switch_site(&mut canvas, 0);
        canvas.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas.stroke_end();

        // Site 1 draws
        switch_site(&mut canvas, 1);
        canvas.stroke_begin(1, 50.0, 50.0, 1.0);
        canvas.stroke_end();

        // Undo both
        switch_site(&mut canvas, 0);
        canvas.undo();
        switch_site(&mut canvas, 1);
        canvas.undo();

        // Redo site 0 only
        switch_site(&mut canvas, 0);
        assert!(canvas.redo());

        let px0 = canvas.layer(0).unwrap().pixel(10, 10).unwrap();
        assert!(px0[3] > 0, "Site 0's stroke should be back after redo");

        let px1 = canvas.layer(1).unwrap().pixel(50, 50).unwrap();
        assert_eq!(px1[3], 0, "Site 1's stroke should still be undone");
    }

    #[test]
    fn test_clear_layer_no_selection() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        // Paint a pixel
        {
            let px = canvas.layer_mut(0).unwrap().pixel_mut(5, 5).unwrap();
            *px = [255, 0, 0, 255];
        }
        canvas.layer_mut(0).unwrap().clear_dirty();

        canvas.clear_layer(0);

        let px = canvas.layer(0).unwrap().pixel(5, 5).unwrap();
        assert_eq!(px, [0, 0, 0, 0], "Pixel should be cleared");
        assert!(canvas.layer(0).unwrap().dirty, "Layer should be dirty after clear");
    }

    #[test]
    fn test_clear_layer_with_selection() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        // Paint two pixels
        {
            let l = canvas.layer_mut(0).unwrap();
            *l.pixel_mut(2, 2).unwrap() = [255, 0, 0, 255];
            *l.pixel_mut(5, 5).unwrap() = [0, 255, 0, 255];
        }
        // Select only a rect covering (5,5) but not (2,2)
        canvas.selection_rect(4, 4, 3, 3, CombineMode::Replace);

        canvas.clear_layer(0);

        let px_outside = canvas.layer(0).unwrap().pixel(2, 2).unwrap();
        assert_eq!(px_outside, [255, 0, 0, 255], "Pixel outside selection should be untouched");

        let px_inside = canvas.layer(0).unwrap().pixel(5, 5).unwrap();
        assert_eq!(px_inside, [0, 0, 0, 0], "Pixel inside selection should be cleared");
    }

    #[test]
    fn test_clear_layer_is_undoable() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let px = canvas.layer_mut(0).unwrap().pixel_mut(3, 3).unwrap();
            *px = [100, 200, 50, 255];
        }

        canvas.clear_layer(0);
        assert_eq!(canvas.layer(0).unwrap().pixel(3, 3).unwrap(), [0, 0, 0, 0]);

        canvas.undo();
        // After undo, the clear should be reverted — pixel data restored via replay
        // Note: the pixel was set directly (not via operation), so after undo+replay
        // it will be transparent since there was no stroke operation.
        // Let's test with a proper stroke instead.
    }

    #[test]
    fn test_clear_layer_undo_with_stroke() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.set_brush_size(20.0);
        canvas.set_brush_flow(1.0);
        canvas.set_brush_opacity(1.0);

        // Draw a stroke
        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_end();

        let px_before = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert!(px_before[3] > 0, "Should have painted pixel");

        // Clear the layer
        canvas.clear_layer(0);
        let px_cleared = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert_eq!(px_cleared[3], 0, "Pixel should be cleared");

        // Undo the clear
        assert!(canvas.undo());
        let px_restored = canvas.layer(0).unwrap().pixel(50, 50).unwrap();
        assert!(px_restored[3] > 0, "Pixel should be restored after undo");
    }

    #[test]
    fn test_layer_default_name() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        assert_eq!(canvas.layer(0).unwrap().name, "Layer 1");
        canvas.add_layer();
        assert_eq!(canvas.layer(1).unwrap().name, "Layer 2");
    }

    #[test]
    fn test_rename_layer() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        canvas.rename_layer(0, "Background".to_string());
        assert_eq!(canvas.layer(0).unwrap().name, "Background");
    }

    #[test]
    fn test_move_layer_forward() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer(); // index 0
        canvas.add_layer(); // index 1
        canvas.add_layer(); // index 2
        let id0 = canvas.layers[0].id;
        let id1 = canvas.layers[1].id;
        let id2 = canvas.layers[2].id;

        // Move layer 0 to index 2 (end)
        canvas.move_layer(0, 2);
        assert_eq!(canvas.layers[0].id, id1);
        assert_eq!(canvas.layers[1].id, id2);
        assert_eq!(canvas.layers[2].id, id0);
    }

    #[test]
    fn test_move_layer_backward() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer(); // index 0
        canvas.add_layer(); // index 1
        canvas.add_layer(); // index 2
        let id0 = canvas.layers[0].id;
        let id1 = canvas.layers[1].id;
        let id2 = canvas.layers[2].id;

        // Move layer 2 to index 0
        canvas.move_layer(2, 0);
        assert_eq!(canvas.layers[0].id, id2);
        assert_eq!(canvas.layers[1].id, id0);
        assert_eq!(canvas.layers[2].id, id1);
    }

    #[test]
    fn test_move_layer_same_index_noop() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        canvas.add_layer();
        let id0 = canvas.layers[0].id;
        let id1 = canvas.layers[1].id;

        canvas.move_layer(1, 1);
        assert_eq!(canvas.layers[0].id, id0);
        assert_eq!(canvas.layers[1].id, id1);
    }

    #[test]
    fn test_move_layer_is_undoable() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        canvas.add_layer();
        canvas.add_layer();
        let id0 = canvas.layers[0].id;
        let id1 = canvas.layers[1].id;
        let id2 = canvas.layers[2].id;

        canvas.move_layer(0, 2);
        assert_eq!(canvas.layers[0].id, id1);

        canvas.undo();
        assert_eq!(canvas.layers[0].id, id0);
        assert_eq!(canvas.layers[1].id, id1);
        assert_eq!(canvas.layers[2].id, id2);

        canvas.redo();
        assert_eq!(canvas.layers[0].id, id1);
        assert_eq!(canvas.layers[1].id, id2);
        assert_eq!(canvas.layers[2].id, id0);
    }

    #[test]
    fn test_move_layer_persists_through_load_chunk() {
        let mut canvas1 = Canvas::new(10, 10);
        canvas1.add_layer();
        canvas1.add_layer();
        canvas1.add_layer();
        let id0 = canvas1.layers[0].id;
        let id1 = canvas1.layers[1].id;
        let id2 = canvas1.layers[2].id;

        canvas1.move_layer(0, 2);
        let data = canvas1.flush_pending_operations().unwrap();

        let mut canvas2 = Canvas::new(10, 10);
        canvas2.load_chunk(&data).unwrap();

        assert_eq!(canvas2.layers[0].id, id1);
        assert_eq!(canvas2.layers[1].id, id2);
        assert_eq!(canvas2.layers[2].id, id0);
    }

    #[test]
    fn test_rename_layer_persists_through_undo_redo() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        canvas.rename_layer(0, "My Layer".to_string());
        assert_eq!(canvas.layer(0).unwrap().name, "My Layer");

        canvas.undo();
        assert_eq!(canvas.layer(0).unwrap().name, "Layer 1");

        canvas.redo();
        assert_eq!(canvas.layer(0).unwrap().name, "My Layer");
    }
}
