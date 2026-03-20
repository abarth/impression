use std::collections::HashMap;

use crate::brush;
use crate::canvas::Canvas;
use crate::color::Color;
use crate::layer::Layer;
use crate::operation::{Operation, SiteId, SiteOperation};
use crate::selection::{CombineMode, SelectionMask};
use crate::site::SiteState;

/// How many undo groups between automatic checkpoints.
pub(crate) const CHECKPOINT_INTERVAL: usize = 50;
/// Maximum number of checkpoints to keep (oldest are evicted first).
const MAX_CHECKPOINTS: usize = 10;

/// A snapshot of the full canvas state, used for incremental undo/redo.
/// Instead of replaying all operations from scratch, we restore the nearest
/// valid checkpoint and replay only the remaining operations.
pub(crate) struct Checkpoint {
    /// Number of oplog groups that existed when this checkpoint was taken.
    pub(crate) group_count: usize,
    /// The undone flag for each group at capture time.
    group_undone: Vec<bool>,
    /// Layer data.
    layers: Vec<Layer>,
    /// Per-site state.
    sites: HashMap<SiteId, SiteState>,
    /// Background color.
    background_color: Color,
    /// Layer ID counter.
    layer_id_counter: u32,
}

impl Canvas {
    /// Capture the current canvas state as a checkpoint.
    pub(crate) fn take_checkpoint(&mut self) {
        if self.checkpoints.len() >= MAX_CHECKPOINTS {
            self.checkpoints.remove(0);
        }
        self.checkpoints.push(Checkpoint {
            group_count: self.oplog.group_count(),
            group_undone: self.oplog.group_undone_flags(),
            layers: self.layers.clone(),
            sites: self.sites.clone(),
            background_color: self.background_color,
            layer_id_counter: self.layer_id_counter,
        });
    }

    /// Find the index of the best (latest) valid checkpoint for the current
    /// undo state. A checkpoint is valid if all groups it covers still have
    /// the same undone flags as when the checkpoint was taken.
    pub(crate) fn find_best_checkpoint(&self) -> Option<usize> {
        let current_flags = self.oplog.group_undone_flags();
        let mut best = None;
        for (i, cp) in self.checkpoints.iter().enumerate() {
            if cp.group_count <= current_flags.len()
                && cp.group_undone == current_flags[..cp.group_count]
            {
                best = Some(i);
            }
        }
        best
    }

    /// Restore canvas state from a checkpoint.
    fn restore_from_checkpoint(&mut self, cp_index: usize) {
        let cp = &self.checkpoints[cp_index];
        self.layers = cp.layers.clone();
        self.sites = cp.sites.clone();
        self.background_color = cp.background_color;
        self.layer_id_counter = cp.layer_id_counter;
    }

    /// Replay active operations, using a checkpoint if available.
    /// Only marks layers as dirty if their pixel content actually changed.
    pub(crate) fn replay_active(&mut self) {
        // Fingerprint each layer's pixels before replay
        let old_fingerprints: Vec<u64> = self.layers.iter().map(|l| l.pixel_fingerprint()).collect();
        let old_count = self.layers.len();

        if let Some(cp_idx) = self.find_best_checkpoint() {
            // Restore from checkpoint and replay only remaining operations
            let group_start = self.checkpoints[cp_idx].group_count;
            self.restore_from_checkpoint(cp_idx);
            let ops = self.oplog.active_operations_from_group(group_start);
            for site_op in ops {
                self.execute_op(site_op);
            }
        } else {
            // Full replay: reset all state
            self.layers.clear();
            for site_state in self.sites.values_mut() {
                *site_state = SiteState::default();
            }
            self.background_color = Color::white();
            self.layer_id_counter = 0;

            let ops = self.oplog.active_operations();
            for site_op in ops {
                self.execute_op(site_op);
            }
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
    pub(crate) fn execute_op(&mut self, site_op: SiteOperation) {
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
                let tip = site_state.active_tip.clone();
                let sel_ref = sel_data.as_deref();
                if let Some(l) = self.layers.iter_mut().find(|l| l.id == layer) {
                    let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
                    brush::stroke_begin(l, stroke_state, &brush, x, y, pressure, tip.as_ref(), sel_ref);
                }
            }
            Operation::StrokeMove { x, y, pressure } => {
                let site_state = self.sites.get(&site).unwrap();
                let stroke_layer = site_state.stroke_layer;
                let sel_data: Option<Vec<u8>> = site_state.selection.as_ref().map(|s| s.data.clone());
                let brush = site_state.brush.clone();
                let tip = site_state.active_tip.clone();
                let sel_ref = sel_data.as_deref();
                if let Some(l) = self.layers.iter_mut().find(|l| l.id == stroke_layer) {
                    let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
                    brush::stroke_move(l, stroke_state, &brush, x, y, pressure, tip.as_ref(), sel_ref);
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
            Operation::SetBrushHardness(hardness) => self.site_for_mut(site).brush.hardness = hardness,
            Operation::SetBrushRoundness(roundness) => self.site_for_mut(site).brush.roundness = roundness,
            Operation::SetBrushAngle(angle) => self.site_for_mut(site).brush.angle = angle,
            Operation::SetBrushTip(ref tip_id) => {
                let cloned_tip = tip_id.as_ref().and_then(|id| self.tip_registry.get(id).cloned());
                let site_state = self.site_for_mut(site);
                site_state.active_tip_id = tip_id.clone();
                site_state.active_tip = cloned_tip;
            }
            Operation::AddLayer { id } => {
                let mut layer = crate::layer::Layer::new(id, self.width, self.height);
                layer.name = format!("Layer {}", self.layers.len() + 1);
                self.layers.push(layer);
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
            Operation::ClearLayer { layer } => {
                let sel_data: Option<Vec<u8>> = self.sites.get(&site)
                    .and_then(|s| s.selection.as_ref())
                    .map(|s| s.data.clone());
                if let Some(l) = self.layer_by_id_mut(layer) {
                    if let Some(mask) = sel_data {
                        // Clear only selected pixels
                        for i in 0..mask.len() {
                            if mask[i] > 0 {
                                let px = i * 4;
                                l.pixels[px] = 0;
                                l.pixels[px + 1] = 0;
                                l.pixels[px + 2] = 0;
                                l.pixels[px + 3] = 0;
                            }
                        }
                        l.mark_fully_dirty();
                    } else {
                        l.clear();
                    }
                }
            }
            Operation::RenameLayer { layer, name } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.name = name;
                }
            }
            Operation::MoveLayer { layer, before } => {
                if let Some(from_idx) = self.layer_index_by_id(layer) {
                    let moved = self.layers.remove(from_idx);
                    let insert_at = match before {
                        Some(before_id) => self.layer_index_by_id(before_id).unwrap_or(self.layers.len()),
                        None => self.layers.len(),
                    };
                    self.layers.insert(insert_at, moved);
                }
            }
            Operation::SetShapeDynamics(dynamics) => {
                self.site_for_mut(site).brush.shape_dynamics = dynamics;
            }
            Operation::SetTransferDynamics(dynamics) => {
                self.site_for_mut(site).brush.transfer_dynamics = dynamics;
            }
            Operation::SetBrushFlipX(flip) => {
                self.site_for_mut(site).brush.flip_x = flip;
            }
            Operation::SetBrushFlipY(flip) => {
                self.site_for_mut(site).brush.flip_y = flip;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::Canvas;

    #[test]
    fn test_checkpoint_taken_at_interval() {
        let mut canvas = Canvas::new(10, 10);
        assert_eq!(canvas.checkpoints.len(), 0);

        // Create CHECKPOINT_INTERVAL undo groups (each set_brush_size starts a new one)
        for i in 0..CHECKPOINT_INTERVAL {
            canvas.set_brush_size(i as f32 + 1.0);
        }

        assert_eq!(canvas.checkpoints.len(), 1, "Should have one checkpoint after {} groups", CHECKPOINT_INTERVAL);
    }

    #[test]
    fn test_checkpoint_used_during_undo() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();

        // Create enough undo groups to trigger a checkpoint
        for i in 0..CHECKPOINT_INTERVAL {
            canvas.set_brush_size(i as f32 + 1.0);
        }
        assert_eq!(canvas.checkpoints.len(), 1);

        // Add one more stroke after the checkpoint
        canvas.stroke_begin(0, 5.0, 5.0, 1.0);
        canvas.stroke_end();

        // Undo the stroke — should use checkpoint instead of full replay
        let px_before_undo = canvas.layer(0).unwrap().pixel(5, 5).unwrap();
        assert!(px_before_undo[3] > 0);

        canvas.undo();

        let px_after_undo = canvas.layer(0).unwrap().pixel(5, 5).unwrap();
        assert_eq!(px_after_undo[3], 0, "Undo should clear the stroke");
        // Checkpoint should still be valid
        assert!(canvas.find_best_checkpoint().is_some());
    }

    #[test]
    fn test_checkpoint_invalidated_by_deep_undo() {
        let mut canvas = Canvas::new(10, 10);

        // Create CHECKPOINT_INTERVAL groups to get a checkpoint
        for i in 0..CHECKPOINT_INTERVAL {
            canvas.set_brush_size(i as f32 + 1.0);
        }
        assert_eq!(canvas.checkpoints.len(), 1);

        // Undo past the checkpoint — all groups before it are now undone
        for _ in 0..CHECKPOINT_INTERVAL {
            canvas.undo();
        }

        // Checkpoint should no longer be valid (groups are undone)
        assert!(canvas.find_best_checkpoint().is_none());
    }

    #[test]
    fn test_undo_redo_with_checkpoints_produces_correct_result() {
        let mut canvas = Canvas::new(20, 20);
        canvas.add_layer();

        // Build up state past a checkpoint
        for i in 0..CHECKPOINT_INTERVAL {
            canvas.set_brush_size(i as f32 + 5.0);
        }

        // Draw after checkpoint
        canvas.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas.stroke_move(0, 15.0, 10.0, 1.0);
        canvas.stroke_end();

        let px_with_stroke = canvas.layer(0).unwrap().pixel(10, 10).unwrap();

        // Undo and redo
        canvas.undo();
        let px_undone = canvas.layer(0).unwrap().pixel(10, 10).unwrap();
        assert_eq!(px_undone[3], 0);

        canvas.redo();
        let px_redone = canvas.layer(0).unwrap().pixel(10, 10).unwrap();
        assert_eq!(px_with_stroke, px_redone, "Redo should restore exact same pixels");
    }

    #[test]
    fn test_multiple_checkpoints() {
        let mut canvas = Canvas::new(10, 10);

        // Create 2 * CHECKPOINT_INTERVAL groups
        for i in 0..(2 * CHECKPOINT_INTERVAL) {
            canvas.set_brush_size(i as f32 + 1.0);
        }

        assert_eq!(canvas.checkpoints.len(), 2, "Should have two checkpoints");
    }

    #[test]
    fn test_checkpoint_discarded_on_new_work_after_undo() {
        let mut canvas = Canvas::new(10, 10);

        for i in 0..CHECKPOINT_INTERVAL {
            canvas.set_brush_size(i as f32 + 1.0);
        }
        assert_eq!(canvas.checkpoints.len(), 1);

        // Undo a few groups
        canvas.undo();
        canvas.undo();

        // New work discards redo groups, which may invalidate checkpoint
        canvas.set_brush_size(99.0);

        // Checkpoint should be discarded since its group_count > current group count
        // (the redo groups were removed)
        let valid = canvas.find_best_checkpoint();
        // The checkpoint covered CHECKPOINT_INTERVAL groups, but some were removed
        // so it should no longer be valid
        assert!(valid.is_none(), "Checkpoint should be invalidated after redo discard");
    }
}
