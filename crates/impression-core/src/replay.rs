use std::collections::HashMap;

use crate::canvas::Canvas;
use crate::color::Color;
use crate::layer::Layer;
use crate::operation::SiteId;
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
    /// Also populates `wet_media_replay_events` with GPU operations for TS.
    pub(crate) fn replay_active(&mut self) {
        // Clear replay events — will be populated by execute_op calls
        self.wet_media_replay_events.clear();
        self.is_replaying = true;

        // Fingerprint each layer's pixels before replay
        let old_fingerprints: Vec<u64> =
            self.layers.iter().map(|l| l.pixel_fingerprint()).collect();
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

        self.is_replaying = false;

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::{Canvas, WetMediaReplayEvent};
    use crate::operation::Operation;

    /// Helper: modify the active site's brush size and record a SetBrushSettings op.
    /// This creates a new undo group each time (SetBrushSettings starts_undo_group = true).
    fn set_brush_size(canvas: &mut Canvas, size: f32) {
        canvas.site_mut().brush.size = size;
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));
    }

    #[test]
    fn test_checkpoint_taken_at_interval() {
        let mut canvas = Canvas::new(10, 10);
        assert_eq!(canvas.checkpoints.len(), 0);

        // Create CHECKPOINT_INTERVAL undo groups (each set_brush_size starts a new one)
        for i in 0..CHECKPOINT_INTERVAL {
            set_brush_size(&mut canvas, i as f32 + 1.0);
        }

        assert_eq!(
            canvas.checkpoints.len(),
            1,
            "Should have one checkpoint after {} groups",
            CHECKPOINT_INTERVAL
        );
    }

    #[test]
    fn test_checkpoint_used_during_undo() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();

        // Create enough undo groups to trigger a checkpoint
        for i in 0..CHECKPOINT_INTERVAL {
            set_brush_size(&mut canvas, i as f32 + 1.0);
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
            set_brush_size(&mut canvas, i as f32 + 1.0);
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
            set_brush_size(&mut canvas, i as f32 + 5.0);
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
        assert_eq!(
            px_with_stroke, px_redone,
            "Redo should restore exact same pixels"
        );
    }

    #[test]
    fn test_multiple_checkpoints() {
        let mut canvas = Canvas::new(10, 10);

        // Create 2 * CHECKPOINT_INTERVAL groups
        for i in 0..(2 * CHECKPOINT_INTERVAL) {
            set_brush_size(&mut canvas, i as f32 + 1.0);
        }

        assert_eq!(canvas.checkpoints.len(), 2, "Should have two checkpoints");
    }

    #[test]
    fn test_checkpoint_discarded_on_new_work_after_undo() {
        let mut canvas = Canvas::new(10, 10);

        for i in 0..CHECKPOINT_INTERVAL {
            set_brush_size(&mut canvas, i as f32 + 1.0);
        }
        assert_eq!(canvas.checkpoints.len(), 1);

        // Undo a few groups
        canvas.undo();
        canvas.undo();

        // New work discards redo groups, which may invalidate checkpoint
        set_brush_size(&mut canvas, 99.0);

        // Checkpoint should be discarded since its group_count > current group count
        // (the redo groups were removed)
        let valid = canvas.find_best_checkpoint();
        // The checkpoint covered CHECKPOINT_INTERVAL groups, but some were removed
        // so it should no longer be valid
        assert!(
            valid.is_none(),
            "Checkpoint should be invalidated after redo discard"
        );
    }

    /// Helper: configure canvas for wet media brush and do a stroke.
    fn wet_media_stroke(canvas: &mut Canvas, layer_idx: u32, x1: f32, y1: f32, x2: f32, y2: f32) {
        // Switch to wet media brush model
        canvas.site_mut().brush.brush_model = crate::wet_media::BrushModel::WetMedia;
        canvas.site_mut().brush.wet_media = crate::wet_media::WetMediaBrushSettings {
            bristle_count: 4,
            ..Default::default()
        };
        canvas.site_mut().brush.size = 10.0;
        canvas.site_mut().brush.spacing = 0.25;
        let bytes = canvas.site().brush.to_serializable().to_bytes();
        canvas.apply(Operation::SetBrushSettings(bytes));

        let layer_id = canvas.layers[layer_idx as usize].id;
        canvas.apply(Operation::StrokeBegin {
            layer: layer_id,
            x: x1,
            y: y1,
            pressure: 1.0,
        });
        canvas.apply(Operation::StrokeMove {
            x: x2,
            y: y2,
            pressure: 1.0,
        });
        canvas.apply(Operation::StrokeEnd);
    }

    #[test]
    fn test_wet_media_replay_events_accumulated_on_undo() {
        let mut canvas = Canvas::new(64, 64);
        canvas.add_wet_media_layer();

        // Do a wet media stroke
        wet_media_stroke(&mut canvas, 0, 10.0, 10.0, 30.0, 10.0);

        // During normal execution, replay events should NOT accumulate —
        // footprints stay in SiteState for TS to read directly.
        // Only WetMediaSimStep (which has no CPU-side effect) accumulates always.
        assert_eq!(canvas.wet_media_replay_events.len(), 0,
            "Normal execution should not drain footprints into replay events");

        // Record some sim steps
        let layer_id = canvas.layers[0].id;
        canvas.apply(Operation::WetMediaSimStep { layer: layer_id, frames: 60 });

        let _event_count_before = canvas.wet_media_replay_events.len();

        // Undo the stroke — this calls replay_active which clears and re-populates events
        canvas.undo();

        // After undoing the stroke, replay events should be empty (stroke is undone)
        assert_eq!(
            canvas.wet_media_replay_events.len(),
            0,
            "After undoing the only stroke, no replay events should remain"
        );

        // Redo — should re-populate replay events with the stroke deposits + sim step
        canvas.redo();

        assert!(
            canvas.wet_media_replay_events.len() > 0,
            "After redo, replay events should contain deposit events"
        );

        // Verify we have both deposit and sim step events
        let has_deposit = canvas.wet_media_replay_events.iter().any(|e| matches!(e, WetMediaReplayEvent::Deposit { .. }));
        let has_sim = canvas.wet_media_replay_events.iter().any(|e| matches!(e, WetMediaReplayEvent::SimStep { .. }));
        assert!(has_deposit, "Should have deposit events after redo");
        assert!(has_sim, "Should have sim step events after redo");

        // Check that sim step has correct frame count
        let sim_event = canvas.wet_media_replay_events.iter().find(|e| matches!(e, WetMediaReplayEvent::SimStep { .. }));
        if let Some(WetMediaReplayEvent::SimStep { frames, .. }) = sim_event {
            assert_eq!(*frames, 60, "Sim step should have 60 frames");
        }
    }

    #[test]
    fn test_wet_media_replay_events_cleared_before_replay() {
        let mut canvas = Canvas::new(32, 32);
        canvas.add_wet_media_layer();

        // Do two strokes
        wet_media_stroke(&mut canvas, 0, 5.0, 5.0, 15.0, 5.0);
        wet_media_stroke(&mut canvas, 0, 5.0, 15.0, 15.0, 15.0);

        // Undo one stroke
        canvas.undo();

        // Only the first stroke's deposits should be in replay events
        let deposit_count = canvas.wet_media_replay_events.iter()
            .filter(|e| matches!(e, WetMediaReplayEvent::Deposit { .. }))
            .count();
        assert!(deposit_count > 0, "Should have deposits from the remaining stroke");

        // Redo
        canvas.redo();

        // Both strokes' deposits should now be present
        let deposit_count_after = canvas.wet_media_replay_events.iter()
            .filter(|e| matches!(e, WetMediaReplayEvent::Deposit { .. }))
            .count();
        assert!(
            deposit_count_after > deposit_count,
            "Redo should add more deposit events: {} vs {}",
            deposit_count_after,
            deposit_count
        );
    }

    #[test]
    fn test_round_trip_wet_media_sim_step_in_oplog() {
        let mut canvas = Canvas::new(32, 32);
        canvas.add_wet_media_layer();
        let layer_id = canvas.layers[0].id;

        // Record a sim step
        canvas.apply(Operation::WetMediaSimStep {
            layer: layer_id,
            frames: 120,
        });

        // Verify it can be serialized/deserialized via the oplog
        let ops_data = canvas.flush_pending_operations().unwrap_or_default();
        assert!(!ops_data.is_empty());

        let decoded = crate::operation::deserialize_operations(&ops_data).unwrap();
        let sim_step_op = decoded.iter().find(|so| matches!(so.op, Operation::WetMediaSimStep { .. }));
        assert!(sim_step_op.is_some(), "Should find WetMediaSimStep in serialized ops");
    }
}
