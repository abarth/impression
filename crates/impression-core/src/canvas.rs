use std::collections::HashMap;

use crate::blend_mode::BlendMode;
use crate::brush::{BrushTip, SerializableBrushSettings};
use crate::color::Color;
use crate::layer::{AdjustmentKind, Layer};
use crate::operation::{LayerId, Operation, SiteId, SiteOperation};
use crate::oplog::OpLog;
use crate::replay::{Checkpoint, CHECKPOINT_INTERVAL};
use crate::selection::CombineMode;
use crate::site::SiteState;
use crate::wet_media::BristleFootprint;

/// An event recorded during wet media replay for the TS side to re-execute on GPU.
#[derive(Clone, Debug)]
pub enum WetMediaReplayEvent {
    /// Deposit a bristle footprint onto the GPU canvas.
    Deposit {
        layer: LayerId,
        footprint: BristleFootprint,
    },
    /// Run N simulation frames (advection, diffusion, drying) on the GPU.
    SimStep {
        layer: LayerId,
        frames: u32,
    },
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
    pub(crate) layer_id_counter: u32,
    /// Periodic state checkpoints for incremental undo/redo.
    pub(crate) checkpoints: Vec<Checkpoint>,
    /// Registry of custom brush tip images, keyed by tip ID.
    pub tip_registry: HashMap<String, BrushTip>,
    /// Accumulated wet media replay events from the most recent `replay_active`.
    /// TS reads these after undo/redo to re-execute GPU operations in order.
    pub wet_media_replay_events: Vec<WetMediaReplayEvent>,
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
            wet_media_replay_events: Vec::new(),
        }
    }

    /// Register a custom brush tip image in the tip registry.
    pub fn register_brush_tip(&mut self, id: String, pixels: Vec<u8>, width: u32, height: u32) {
        self.tip_registry.insert(
            id,
            BrushTip {
                pixels,
                width,
                height,
            },
        );
    }

    /// Get the active site's state.
    pub(crate) fn site(&self) -> &SiteState {
        self.sites
            .get(&self.active_site)
            .expect("active site must exist")
    }

    /// Get the active site's state mutably.
    pub(crate) fn site_mut(&mut self) -> &mut SiteState {
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

    /// Record an operation and execute it, starting a new undo group if appropriate.
    pub(crate) fn apply(&mut self, op: Operation) {
        if op.starts_undo_group() {
            self.begin_group();
        }
        let site_op = SiteOperation {
            site: self.active_site,
            op,
        };
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

    pub fn add_wet_media_layer(&mut self) -> u32 {
        let id = self.next_layer_id();
        self.apply(Operation::AddWetMediaLayer { id });
        (self.layers.len() - 1) as u32
    }

    pub fn add_adjustment_layer(&mut self, kind: AdjustmentKind) -> u32 {
        let id = self.next_layer_id();
        self.apply(Operation::AddAdjustmentLayer { id, kind });
        (self.layers.len() - 1) as u32
    }

    pub fn set_adjustment_data(&mut self, index: u32, kind: AdjustmentKind) {
        if let Some(l) = self.layers.get(index as usize) {
            let id = l.id;
            self.apply(Operation::SetAdjustmentData { layer: id, kind });
        }
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

    /// Apply brush settings directly to site state without recording to oplog.
    /// Called from the WASM API before stroke_begin; the oplog entry is recorded
    /// automatically inside stroke_begin.
    pub fn apply_brush_settings(&mut self, site: SiteId, settings: SerializableBrushSettings) {
        self.apply_brush_settings_internal(site, &settings);
    }

    /// Internal helper: apply a SerializableBrushSettings snapshot to a site,
    /// resolving tip IDs against the tip registry. Shared by execute_op and
    /// the public apply_brush_settings.
    pub(crate) fn apply_brush_settings_internal(
        &mut self,
        site: SiteId,
        settings: &SerializableBrushSettings,
    ) {
        // Clone tips from registry before borrowing site mutably
        let active = settings
            .active_tip_id
            .as_ref()
            .and_then(|id| self.tip_registry.get(id).cloned());
        let secondary = settings
            .secondary_tip_id
            .as_ref()
            .and_then(|id| self.tip_registry.get(id).cloned());
        let texture = settings
            .texture_tip_id
            .as_ref()
            .and_then(|id| self.tip_registry.get(id).cloned());

        let site_state = self.sites.entry(site).or_default();
        // apply_serializable sets all fields; we already resolved tips above
        let _ = site_state.brush.apply_serializable(settings, &HashMap::new());
        site_state.active_tip = active;
        site_state.secondary_tip = secondary;
        site_state.texture_tip = texture;
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
        // SetBrushSettings starts the undo group (starts_undo_group = true).
        // StrokeBegin joins the same group (starts_undo_group = false).
        // This ensures brush state is recorded atomically with the stroke.
        let settings_bytes = self.site().brush.to_serializable().to_bytes();
        // Record but don't re-execute — settings are already in site state.
        let settings_op = Operation::SetBrushSettings(settings_bytes);
        self.begin_group();
        let site_op = SiteOperation {
            site: self.active_site,
            op: settings_op,
        };
        self.oplog.push(site_op);

        // Record and execute StrokeBegin in the same undo group.
        let stroke_op = SiteOperation {
            site: self.active_site,
            op: Operation::StrokeBegin {
                layer: layer_id,
                x,
                y,
                pressure,
            },
        };
        self.oplog.push(stroke_op.clone());
        self.execute_op(stroke_op);
    }

    pub fn stroke_move(&mut self, _layer_index: u32, x: f32, y: f32, pressure: f32) {
        self.apply(Operation::StrokeMove { x, y, pressure });
    }

    pub fn stroke_end(&mut self) {
        self.apply(Operation::StrokeEnd);
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
            let without_src: Vec<LayerId> = self
                .layers
                .iter()
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
        self.apply(Operation::MoveLayer {
            layer: layer_id,
            before,
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
            if site_op.op.starts_undo_group() {
                self.oplog.begin_undo_group(site_op.site);
            }
            self.oplog.push(site_op.clone());
            self.execute_op(site_op);
        }
        // Mark loaded operations as already persisted so they are not
        // re-flushed into new chunks (which would cause duplicate ops on reload).
        self.oplog.mark_flushed();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brush::BrushSettings;
    use crate::layer::LayerKind;

    /// Helper: modify the active site's brush size and record a SetBrushSettings op.
    fn set_brush_size(canvas: &mut Canvas, size: f32) {
        canvas.site_mut().brush.size = size;
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));
    }

    /// Helper: modify the active site's brush color and record a SetBrushSettings op.
    fn set_brush_color(canvas: &mut Canvas, r: u8, g: u8, b: u8) {
        canvas.site_mut().brush.color = Color::new(r, g, b);
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));
    }

    /// Helper: modify the active site's brush flow and record a SetBrushSettings op.
    fn set_brush_flow(canvas: &mut Canvas, flow: f32) {
        canvas.site_mut().brush.flow = flow;
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));
    }

    /// Helper: modify the active site's brush opacity and record a SetBrushSettings op.
    fn set_brush_opacity(canvas: &mut Canvas, opacity: f32) {
        canvas.site_mut().brush.opacity = opacity;
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));
    }

    /// Helper: reset brush to defaults (preserving color) and record a SetBrushSettings op.
    fn reset_brush(canvas: &mut Canvas) {
        let color = canvas.site().brush.color;
        canvas.site_mut().brush = BrushSettings::default();
        canvas.site_mut().brush.color = color;
        // Clear tip references
        canvas.site_mut().active_tip = None;
        canvas.site_mut().secondary_tip = None;
        canvas.site_mut().texture_tip = None;
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));
    }

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
        // SetBrushSettings + StrokeBegin + StrokeMove + StrokeEnd
        assert_eq!(ops.len(), pre + 4);
        assert!(matches!(ops[pre].op, Operation::SetBrushSettings(_)));
        assert!(matches!(ops[pre + 1].op, Operation::StrokeBegin { .. }));
        assert!(matches!(ops[pre + 2].op, Operation::StrokeMove { .. }));
        assert!(matches!(ops[pre + 3].op, Operation::StrokeEnd));
    }

    #[test]
    fn test_oplog_records_property_changes() {
        let mut canvas = Canvas::new(100, 100);
        set_brush_size(&mut canvas, 30.0);
        set_brush_color(&mut canvas, 255, 0, 0);

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 2);
        assert!(matches!(ops[0].op, Operation::SetBrushSettings(_)));
        assert!(matches!(ops[1].op, Operation::SetBrushSettings(_)));
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
        assert_eq!(before - after, 5); // SetBrushSettings + StrokeBegin + 2*StrokeMove + StrokeEnd
    }

    #[test]
    fn test_oplog_records_layer_operations() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        let _layer_id = canvas.layers[0].id;
        canvas.set_layer_opacity(0, 0.5);
        canvas.set_layer_blend_mode(0, BlendMode::Multiply);
        canvas.set_layer_visible(0, false);

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 4);
        assert!(matches!(ops[0].op, Operation::AddLayer { .. }));
        assert!(
            matches!(ops[1].op, Operation::SetLayerOpacity { opacity, .. } if (opacity - 0.5).abs() < 0.001)
        );
        assert!(matches!(
            ops[2].op,
            Operation::SetLayerBlendMode {
                mode: BlendMode::Multiply,
                ..
            }
        ));
        assert!(matches!(
            ops[3].op,
            Operation::SetLayerVisible { visible: false, .. }
        ));
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
        set_brush_size(&mut canvas, 30.0);
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
        assert!(
            px1[3] > 0,
            "First stroke should remain after undoing second"
        );

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

        assert!(
            !canvas.layers[0].dirty,
            "Unchanged layer should not be dirty after undo"
        );
        assert!(
            canvas.layers[1].dirty,
            "Changed layer should be dirty after undo"
        );
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

        assert!(
            !canvas.layers[0].dirty,
            "Unchanged layer should not be dirty after redo"
        );
        assert!(
            canvas.layers[1].dirty,
            "Changed layer should be dirty after redo"
        );
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
        set_brush_size(&mut canvas1, 42.0);
        set_brush_flow(&mut canvas1, 0.3);

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
                assert_eq!(
                    *layer, layer_id,
                    "Operation should reference LayerId, not index"
                );
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
        assert!(
            px0[3] > 0,
            "Site 0's stroke should remain after site 1 undo"
        );

        let px1 = canvas.layer(1).unwrap().pixel(50, 50).unwrap();
        assert_eq!(px1[3], 0, "Site 1's stroke should be gone after undo");
    }

    #[test]
    fn test_multi_site_undo_does_not_affect_other_site() {
        let mut canvas = Canvas::new(100, 100);

        // Site 0 changes brush
        switch_site(&mut canvas, 0);
        set_brush_size(&mut canvas, 30.0);

        // Site 1 changes brush
        switch_site(&mut canvas, 1);
        set_brush_size(&mut canvas, 50.0);

        // Undo site 0
        switch_site(&mut canvas, 0);
        canvas.undo();

        // Site 0 should revert to default
        assert!(
            (canvas.sites.get(&0).unwrap().brush.size - 10.0).abs() < 0.01,
            "Site 0 brush should revert to default"
        );

        // Site 1 should be unaffected
        assert!(
            (canvas.sites.get(&1).unwrap().brush.size - 50.0).abs() < 0.01,
            "Site 1 brush should remain at 50"
        );
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

        assert!(
            sel0.data[idx_15_15] > 0,
            "Site 0 should have selection at (15,15)"
        );
        assert_eq!(
            sel0.data[idx_55_55], 0,
            "Site 0 should not have selection at (55,55)"
        );

        assert_eq!(
            sel1.data[idx_15_15], 0,
            "Site 1 should not have selection at (15,15)"
        );
        assert!(
            sel1.data[idx_55_55] > 0,
            "Site 1 should have selection at (55,55)"
        );
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
        set_brush_size(&mut canvas1, 42.0);

        let data = canvas1.flush_pending_operations().unwrap();

        // Load into fresh canvas
        let mut canvas2 = Canvas::new(50, 50);
        assert!(canvas2.load_chunk(&data).is_ok());

        // Verify state
        assert_eq!(canvas2.layers.len(), 1);
        let px = canvas2.layer(0).unwrap().pixel(10, 10).unwrap();
        assert!(px[3] > 0, "Loaded canvas should have site 0's stroke");

        // Site 1's brush size should be restored
        assert!(
            (canvas2.sites.get(&1).unwrap().brush.size - 42.0).abs() < 0.01,
            "Site 1's brush size should be loaded"
        );
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
        assert!(
            canvas.layer(0).unwrap().dirty,
            "Layer should be dirty after clear"
        );
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
        assert_eq!(
            px_outside,
            [255, 0, 0, 255],
            "Pixel outside selection should be untouched"
        );

        let px_inside = canvas.layer(0).unwrap().pixel(5, 5).unwrap();
        assert_eq!(
            px_inside,
            [0, 0, 0, 0],
            "Pixel inside selection should be cleared"
        );
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
        set_brush_size(&mut canvas, 20.0);
        set_brush_flow(&mut canvas, 1.0);
        set_brush_opacity(&mut canvas, 1.0);

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

    #[test]
    fn test_reset_brush_is_recorded_in_oplog() {
        let mut canvas = Canvas::new(10, 10);
        set_brush_size(&mut canvas, 42.0);
        reset_brush(&mut canvas);

        let ops = canvas.oplog.active_operations();
        assert!(matches!(
            ops.last().unwrap().op,
            Operation::SetBrushSettings(_)
        ));
    }

    #[test]
    fn test_reset_brush_clears_tip_ids() {
        let mut canvas = Canvas::new(10, 10);
        // Register a tip and set it active
        canvas.register_brush_tip("tip-1".to_string(), vec![255, 128], 1, 2);
        let cloned_tip = canvas.tip_registry.get("tip-1").cloned();
        {
            let site = canvas.site_mut();
            site.brush.active_tip_id = Some("tip-1".to_string());
            site.brush.secondary_tip_id = Some("tip-1".to_string());
            site.brush.texture_tip_id = Some("tip-1".to_string());
            site.active_tip = cloned_tip;
        }

        let site = canvas.site_for_mut(0);
        assert!(site.brush.active_tip_id.is_some());
        assert!(site.active_tip.is_some());

        reset_brush(&mut canvas);

        let site = canvas.site_for_mut(0);
        assert!(
            site.brush.active_tip_id.is_none(),
            "reset should clear active tip ID"
        );
        assert!(
            site.brush.secondary_tip_id.is_none(),
            "reset should clear secondary tip ID"
        );
        assert!(
            site.brush.texture_tip_id.is_none(),
            "reset should clear texture tip ID"
        );
        assert!(
            site.active_tip.is_none(),
            "reset should clear cached active tip"
        );
        assert!(
            site.secondary_tip.is_none(),
            "reset should clear cached secondary tip"
        );
        assert!(
            site.texture_tip.is_none(),
            "reset should clear cached texture tip"
        );
    }

    #[test]
    fn test_reset_brush_preserves_color() {
        let mut canvas = Canvas::new(10, 10);
        set_brush_color(&mut canvas, 255, 0, 128);
        reset_brush(&mut canvas);

        let site = canvas.site_for_mut(0);
        assert_eq!(site.brush.color.r, 255);
        assert_eq!(site.brush.color.g, 0);
        assert_eq!(site.brush.color.b, 128);
    }

    #[test]
    fn test_reset_brush_replay_matches_live() {
        // Live: set brush size, reset, then draw
        let mut canvas1 = Canvas::new(20, 20);
        canvas1.add_layer();
        set_brush_size(&mut canvas1, 50.0);
        reset_brush(&mut canvas1);
        // Don't re-set size — should be default (10.0) after reset
        canvas1.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas1.stroke_end();

        // Serialize and replay
        let data = canvas1.flush_pending_operations().unwrap();
        let mut canvas2 = Canvas::new(20, 20);
        assert!(canvas2.load_chunk(&data).is_ok());

        // Both should have the same brush size (default after reset)
        let site1 = canvas1.site_for_mut(0);
        let site2 = canvas2.site_for_mut(0);
        assert!(
            (site1.brush.size - site2.brush.size).abs() < 0.01,
            "Replay brush size ({}) should match live ({})",
            site2.brush.size,
            site1.brush.size
        );
    }

    #[test]
    fn test_add_adjustment_layer() {
        let mut canvas = Canvas::new(100, 100);
        let idx = canvas.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "test-grad".to_string(),
        });
        assert_eq!(idx, 0);
        assert_eq!(canvas.layers.len(), 1);

        let layer = &canvas.layers[0];
        assert!(layer.is_adjustment());
        assert!(
            layer.pixels.is_empty(),
            "Adjustment layers should have no pixel buffer"
        );
        assert_eq!(layer.name, "Gradient Map");

        match &layer.kind {
            LayerKind::Adjustment(AdjustmentKind::GradientMap { gradient_id }) => {
                assert_eq!(gradient_id, "test-grad");
            }
            _ => panic!("Expected GradientMap adjustment layer"),
        }
    }

    #[test]
    fn test_set_adjustment_data() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "grad-1".to_string(),
        });

        canvas.set_adjustment_data(
            0,
            AdjustmentKind::GradientMap {
                gradient_id: "grad-2".to_string(),
            },
        );

        match &canvas.layers[0].kind {
            LayerKind::Adjustment(AdjustmentKind::GradientMap { gradient_id }) => {
                assert_eq!(gradient_id, "grad-2");
            }
            _ => panic!("Expected updated GradientMap"),
        }
    }

    #[test]
    fn test_undo_adjustment_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "test".to_string(),
        });
        assert_eq!(canvas.layers.len(), 1);

        assert!(canvas.undo());
        assert_eq!(canvas.layers.len(), 0);

        assert!(canvas.redo());
        assert_eq!(canvas.layers.len(), 1);
        assert!(canvas.layers[0].is_adjustment());
    }

    #[test]
    fn test_mixed_raster_and_adjustment_layers() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer(); // raster
        canvas.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "grad".to_string(),
        });
        canvas.add_layer(); // another raster

        assert_eq!(canvas.layers.len(), 3);
        assert!(!canvas.layers[0].is_adjustment());
        assert!(canvas.layers[1].is_adjustment());
        assert!(!canvas.layers[2].is_adjustment());

        // Adjustment layer has no pixels
        assert!(canvas.layers[1].pixels.is_empty());
        // Raster layers have pixels
        assert!(!canvas.layers[0].pixels.is_empty());
        assert!(!canvas.layers[2].pixels.is_empty());
    }

    #[test]
    fn test_load_chunk_restores_all_layer_types() {
        // Create a canvas, add layers of different types, paint, and flush
        let mut canvas1 = Canvas::new(64, 64);
        canvas1.add_layer();
        set_brush_size(&mut canvas1, 5.0);
        set_brush_color(&mut canvas1, 255, 0, 0);
        canvas1.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas1.stroke_end();
        canvas1.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "test-grad".to_string(),
        });
        canvas1.add_layer();
        set_brush_color(&mut canvas1, 0, 0, 255);
        canvas1.stroke_begin(2, 30.0, 30.0, 1.0);
        canvas1.stroke_end();

        assert_eq!(canvas1.layers.len(), 3);
        assert!(!canvas1.layers[0].is_adjustment());
        assert!(canvas1.layers[1].is_adjustment());
        assert!(!canvas1.layers[2].is_adjustment());

        // Flush all operations to get serialized data
        let data = canvas1.flush_pending_operations().expect("should have ops");

        // Load into a fresh canvas
        let mut canvas2 = Canvas::new(64, 64);
        canvas2.load_chunk(&data).expect("load should succeed");

        // Verify all layers reconstructed
        assert_eq!(canvas2.layers.len(), 3);
        assert!(!canvas2.layers[0].is_adjustment());
        assert!(canvas2.layers[1].is_adjustment());
        assert!(!canvas2.layers[2].is_adjustment());
        assert_eq!(canvas2.layers[0].name, "Layer 1");
        assert_eq!(canvas2.layers[1].name, "Gradient Map");
        assert_eq!(canvas2.layers[2].name, "Layer 3");

        // Verify layer 0 has painted pixels (non-zero)
        let has_paint = canvas2.layers[0].pixels.chunks(4).any(|px| px[3] > 0);
        assert!(has_paint, "Layer 0 should have painted pixels after load");

        // Verify layer 2 also has painted pixels
        let has_paint2 = canvas2.layers[2].pixels.chunks(4).any(|px| px[3] > 0);
        assert!(has_paint2, "Layer 2 should have painted pixels after load");
    }

    #[test]
    fn test_load_chunk_restores_layer_order_after_move() {
        let mut canvas1 = Canvas::new(64, 64);
        canvas1.add_layer(); // Layer 1 at index 0
        canvas1.add_layer(); // Layer 2 at index 1
        canvas1.add_layer(); // Layer 3 at index 2

        // Move Layer 1 (index 0) to the end (index 2)
        canvas1.move_layer(0, 2);
        assert_eq!(canvas1.layers[0].name, "Layer 2");
        assert_eq!(canvas1.layers[1].name, "Layer 3");
        assert_eq!(canvas1.layers[2].name, "Layer 1");

        let data = canvas1.flush_pending_operations().expect("should have ops");

        // Load into a fresh canvas and verify order is preserved
        let mut canvas2 = Canvas::new(64, 64);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 3);
        assert_eq!(canvas2.layers[0].name, "Layer 2");
        assert_eq!(canvas2.layers[1].name, "Layer 3");
        assert_eq!(canvas2.layers[2].name, "Layer 1");
    }

    #[test]
    fn test_roundtrip_blend_mode() {
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        canvas1.set_layer_blend_mode(0, BlendMode::Multiply);

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 1);
        assert_eq!(canvas2.layers[0].blend_mode, BlendMode::Multiply);
    }

    #[test]
    fn test_roundtrip_opacity() {
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        canvas1.set_layer_opacity(0, 0.42);

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 1);
        assert!((canvas2.layers[0].opacity - 0.42).abs() < 1e-6);
    }

    #[test]
    fn test_roundtrip_visibility() {
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        canvas1.set_layer_visible(0, false);

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 1);
        assert!(!canvas2.layers[0].visible);
    }

    #[test]
    fn test_roundtrip_rename() {
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        canvas1.rename_layer(0, "My Custom Name".to_string());

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 1);
        assert_eq!(canvas2.layers[0].name, "My Custom Name");
    }

    #[test]
    fn test_roundtrip_delete_layer() {
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer(); // Layer 1
        canvas1.add_layer(); // Layer 2
        canvas1.add_layer(); // Layer 3
        canvas1.remove_layer(1); // Remove Layer 2

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 2);
        assert_eq!(canvas2.layers[0].name, "Layer 1");
        assert_eq!(canvas2.layers[1].name, "Layer 3");
    }

    #[test]
    fn test_roundtrip_gradient_map_blend_mode() {
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        canvas1.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "grad-1".to_string(),
        });
        canvas1.set_layer_blend_mode(1, BlendMode::SoftLight);
        canvas1.set_layer_opacity(1, 0.75);

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        assert_eq!(canvas2.layers.len(), 2);
        assert!(canvas2.layers[1].is_adjustment());
        assert_eq!(canvas2.layers[1].blend_mode, BlendMode::SoftLight);
        assert!((canvas2.layers[1].opacity - 0.75).abs() < 1e-6);
        if let LayerKind::Adjustment(AdjustmentKind::GradientMap { gradient_id }) =
            &canvas2.layers[1].kind
        {
            assert_eq!(gradient_id, "grad-1");
        } else {
            panic!("Expected gradient map adjustment layer");
        }
    }

    #[test]
    fn test_flush_index_advances_after_load_chunk() {
        // Verify that loaded operations are NOT re-flushed
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        canvas1.set_layer_blend_mode(0, BlendMode::Multiply);

        let data = canvas1.flush_pending_operations().expect("should have ops");

        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&data).expect("load should succeed");

        // After load_chunk, pending operations should be zero because
        // mark_flushed() advances flush_index
        assert_eq!(
            canvas2.oplog.pending_flush_count(),
            0,
            "Loaded operations should not be pending for flush"
        );

        // Making a new operation should produce exactly 1 pending op
        canvas2.set_layer_opacity(0, 0.5);
        assert_eq!(
            canvas2.oplog.pending_flush_count(),
            1,
            "Only the new operation should be pending"
        );
    }

    #[test]
    fn test_multi_chunk_no_duplicate_ops() {
        // Simulate the real reload flow: load chunks, make changes, flush, reload
        let mut canvas1 = Canvas::new(32, 32);
        canvas1.add_layer();
        let chunk0 = canvas1.flush_pending_operations().expect("chunk 0");

        canvas1.add_layer();
        let chunk1 = canvas1.flush_pending_operations().expect("chunk 1");

        // Load both chunks into canvas2 (simulates page reload)
        let mut canvas2 = Canvas::new(32, 32);
        canvas2.load_chunk(&chunk0).expect("load chunk0");
        canvas2.load_chunk(&chunk1).expect("load chunk1");
        assert_eq!(canvas2.layers.len(), 2);

        // Make a new change and flush — should only contain the new op
        canvas2.set_layer_blend_mode(0, BlendMode::Screen);
        let chunk2 = canvas2.flush_pending_operations().expect("chunk 2");

        // Load all three chunks into canvas3
        let mut canvas3 = Canvas::new(32, 32);
        canvas3.load_chunk(&chunk0).expect("load");
        canvas3.load_chunk(&chunk1).expect("load");
        canvas3.load_chunk(&chunk2).expect("load");

        // Should still have exactly 2 layers (no duplicates from re-flushed ops)
        assert_eq!(
            canvas3.layers.len(),
            2,
            "Should not have duplicate layers from re-flushed operations"
        );
        assert_eq!(canvas3.layers[0].blend_mode, BlendMode::Screen);
    }

    #[test]
    fn test_roundtrip_all_properties_combined() {
        let mut canvas1 = Canvas::new(64, 64);

        // Layer 0: normal layer with custom properties
        canvas1.add_layer();
        canvas1.rename_layer(0, "Background".to_string());
        canvas1.set_layer_opacity(0, 0.8);
        canvas1.set_layer_blend_mode(0, BlendMode::Normal);
        set_brush_color(&mut canvas1, 255, 0, 0);
        canvas1.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas1.stroke_end();

        // Layer 1: gradient map with soft light
        canvas1.add_adjustment_layer(AdjustmentKind::GradientMap {
            gradient_id: "sunset".to_string(),
        });
        canvas1.set_layer_blend_mode(1, BlendMode::SoftLight);
        canvas1.set_layer_opacity(1, 0.6);
        canvas1.rename_layer(1, "Color Grade".to_string());

        // Layer 2: another normal layer
        canvas1.add_layer();
        canvas1.set_layer_visible(2, false);
        canvas1.set_layer_blend_mode(2, BlendMode::Overlay);
        canvas1.rename_layer(2, "Details".to_string());

        // Move layer 2 before layer 1
        canvas1.move_layer(2, 1);

        // Delete original layer 0
        canvas1.remove_layer(0);

        let data = canvas1.flush_pending_operations().expect("should have ops");
        let mut canvas2 = Canvas::new(64, 64);
        canvas2.load_chunk(&data).expect("load should succeed");

        // After moves and deletes, we should have 2 layers:
        // Original "Details" (moved to index 1, then index 0 after delete)
        // Original "Color Grade" gradient map (shifted)
        assert_eq!(canvas2.layers.len(), 2);

        // Verify the layer order and properties match canvas1
        for i in 0..canvas1.layers.len() {
            assert_eq!(
                canvas2.layers[i].name, canvas1.layers[i].name,
                "name mismatch at {i}"
            );
            assert_eq!(
                canvas2.layers[i].blend_mode, canvas1.layers[i].blend_mode,
                "blend mismatch at {i}"
            );
            assert!(
                (canvas2.layers[i].opacity - canvas1.layers[i].opacity).abs() < 1e-6,
                "opacity mismatch at {i}"
            );
            assert_eq!(
                canvas2.layers[i].visible, canvas1.layers[i].visible,
                "visible mismatch at {i}"
            );
            assert_eq!(
                canvas2.layers[i].is_adjustment(),
                canvas1.layers[i].is_adjustment(),
                "kind mismatch at {i}"
            );
        }
    }
}
