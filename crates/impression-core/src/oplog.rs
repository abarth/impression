use crate::operation::{deserialize_operations, serialize_operations, Operation};

/// Append-only operation log with undo group boundaries.
pub struct OpLog {
    /// All recorded operations.
    operations: Vec<Operation>,
    /// Indices into `operations` marking the start of each undo group.
    undo_boundaries: Vec<usize>,
    /// Current position in undo_boundaries (one past the last active group).
    undo_cursor: usize,
    /// Index of the first operation not yet flushed to persistent storage.
    flush_index: usize,
}

impl OpLog {
    pub fn new() -> Self {
        Self {
            operations: Vec::new(),
            undo_boundaries: Vec::new(),
            undo_cursor: 0,
            flush_index: 0,
        }
    }

    /// Begin a new undo group. All operations pushed until the next
    /// `begin_undo_group` call belong to this group.
    pub fn begin_undo_group(&mut self) {
        // If there are redo groups, discard them
        self.truncate_redo();
        self.undo_boundaries.push(self.operations.len());
        self.undo_cursor = self.undo_boundaries.len();
    }

    /// Append an operation to the log. Coalesces with the previous
    /// operation if they are the same property-change type within
    /// the current undo group.
    pub fn push(&mut self, op: Operation) {
        // If no group has been started, implicitly start one
        if self.undo_boundaries.is_empty()
            || self.undo_cursor < self.undo_boundaries.len()
        {
            self.begin_undo_group();
        }
        if self.can_coalesce_with_last(&op) {
            *self.operations.last_mut().unwrap() = op;
        } else {
            self.operations.push(op);
        }
    }

    /// Check if `op` can replace the last operation in the current group.
    fn can_coalesce_with_last(&self, op: &Operation) -> bool {
        // Must have operations in the current group
        let group_start = match self.undo_boundaries.last() {
            Some(&s) => s,
            None => return false,
        };
        if self.operations.len() <= group_start {
            return false;
        }
        let last = &self.operations[self.operations.len() - 1];
        matches!(
            (last, op),
            (Operation::SetBrushSize(_), Operation::SetBrushSize(_))
            | (Operation::SetBrushSpacing(_), Operation::SetBrushSpacing(_))
            | (Operation::SetBrushOpacity(_), Operation::SetBrushOpacity(_))
            | (Operation::SetBrushFlow(_), Operation::SetBrushFlow(_))
            | (Operation::SetBrushColor { .. }, Operation::SetBrushColor { .. })
            | (Operation::SetBackgroundColor { .. }, Operation::SetBackgroundColor { .. })
        ) || matches!(
            (last, op),
            (
                Operation::SetLayerOpacity { layer: a, .. },
                Operation::SetLayerOpacity { layer: b, .. }
            ) if a == b
        ) || matches!(
            (last, op),
            (
                Operation::SetLayerBlendMode { layer: a, .. },
                Operation::SetLayerBlendMode { layer: b, .. }
            ) if a == b
        )
    }

    /// Number of active operations (up to current undo cursor position).
    pub fn active_len(&self) -> usize {
        if self.undo_cursor == 0 {
            return 0;
        }
        self.operations.len()
            - self.redo_operations_count()
    }

    /// Slice of active operations (excludes undone groups).
    pub fn active_operations(&self) -> &[Operation] {
        let len = self.active_len();
        &self.operations[..len]
    }

    /// Undo the last group. Returns the range of operations undone.
    pub fn undo(&mut self) -> Option<std::ops::Range<usize>> {
        if self.undo_cursor == 0 {
            return None;
        }
        self.undo_cursor -= 1;
        let start = self.undo_boundaries[self.undo_cursor];
        let end = if self.undo_cursor + 1 < self.undo_boundaries.len() {
            self.undo_boundaries[self.undo_cursor + 1]
        } else {
            self.operations.len()
        };
        Some(start..end)
    }

    /// Redo the next group. Returns the range of operations redone.
    pub fn redo(&mut self) -> Option<std::ops::Range<usize>> {
        if self.undo_cursor >= self.undo_boundaries.len() {
            return None;
        }
        let start = self.undo_boundaries[self.undo_cursor];
        self.undo_cursor += 1;
        let end = if self.undo_cursor < self.undo_boundaries.len() {
            self.undo_boundaries[self.undo_cursor]
        } else {
            self.operations.len()
        };
        Some(start..end)
    }

    pub fn can_undo(&self) -> bool {
        self.undo_cursor > 0
    }

    pub fn can_redo(&self) -> bool {
        self.undo_cursor < self.undo_boundaries.len()
    }

    /// Serialize a range of operations to bytes using postcard.
    pub fn serialize_range(&self, range: std::ops::Range<usize>) -> Vec<u8> {
        serialize_operations(&self.operations[range])
    }

    /// Deserialize and append operations from bytes.
    pub fn deserialize_and_append(&mut self, data: &[u8]) -> Result<(), postcard::Error> {
        let ops = deserialize_operations(data)?;
        for op in ops {
            self.operations.push(op);
        }
        Ok(())
    }

    /// Discard all redo groups (operations after the cursor).
    fn truncate_redo(&mut self) {
        if self.undo_cursor < self.undo_boundaries.len() {
            let keep_ops = self.undo_boundaries[self.undo_cursor];
            self.operations.truncate(keep_ops);
            self.undo_boundaries.truncate(self.undo_cursor);
            // Clamp flush_index so it doesn't point past truncated ops
            if self.flush_index > keep_ops {
                self.flush_index = keep_ops;
            }
        }
    }

    /// Number of active operations not yet flushed to persistent storage.
    pub fn pending_flush_count(&self) -> usize {
        let active = self.active_len();
        active.saturating_sub(self.flush_index)
    }

    /// Serialize and return all pending (unflushed active) operations,
    /// advancing the flush index. Returns None if nothing to flush.
    pub fn flush_pending(&mut self) -> Option<Vec<u8>> {
        let active = self.active_len();
        if self.flush_index >= active {
            return None;
        }
        let data = serialize_operations(&self.operations[self.flush_index..active]);
        self.flush_index = active;
        Some(data)
    }

    /// Count of operations in undone (redo-able) groups.
    fn redo_operations_count(&self) -> usize {
        if self.undo_cursor >= self.undo_boundaries.len() {
            return 0;
        }
        let active_end = self.undo_boundaries[self.undo_cursor];
        self.operations.len() - active_end
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blend_mode::BlendMode;

    #[test]
    fn test_push_and_active_operations() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.push(Operation::SetBrushSpacing(0.15));

        assert_eq!(log.active_len(), 2);
        assert_eq!(log.active_operations().len(), 2);
        assert_eq!(log.active_operations()[0], Operation::SetBrushSize(10.0));
        assert_eq!(log.active_operations()[1], Operation::SetBrushSpacing(0.15));
    }

    #[test]
    fn test_undo_group() {
        let mut log = OpLog::new();

        // Group 1: a stroke
        log.begin_undo_group();
        log.push(Operation::StrokeBegin {
            layer: 0,
            x: 10.0,
            y: 10.0,
            pressure: 1.0,
        });
        log.push(Operation::StrokeMove {
            x: 20.0,
            y: 10.0,
            pressure: 0.9,
        });
        log.push(Operation::StrokeEnd);

        // Group 2: a property change
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(50.0));

        assert_eq!(log.active_len(), 4);

        // Undo group 2
        let range = log.undo().unwrap();
        assert_eq!(range, 3..4);
        assert_eq!(log.active_len(), 3);

        // Undo group 1
        let range = log.undo().unwrap();
        assert_eq!(range, 0..3);
        assert_eq!(log.active_len(), 0);

        // Nothing left to undo
        assert!(log.undo().is_none());
    }

    #[test]
    fn test_redo_after_undo() {
        let mut log = OpLog::new();

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(20.0));

        log.undo();
        assert_eq!(log.active_len(), 1);
        assert!(log.can_redo());

        let range = log.redo().unwrap();
        assert_eq!(range, 1..2);
        assert_eq!(log.active_len(), 2);
        assert!(!log.can_redo());
    }

    #[test]
    fn test_push_after_undo_discards_redo() {
        let mut log = OpLog::new();

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(20.0));

        // Undo group 2
        log.undo();
        assert!(log.can_redo());

        // Push new operation — should discard redo history
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(30.0));

        assert!(!log.can_redo());
        assert_eq!(log.active_len(), 2);
        assert_eq!(
            log.active_operations()[1],
            Operation::SetBrushSize(30.0)
        );
    }

    #[test]
    fn test_can_undo_can_redo() {
        let mut log = OpLog::new();
        assert!(!log.can_undo());
        assert!(!log.can_redo());

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        assert!(log.can_undo());
        assert!(!log.can_redo());

        log.undo();
        assert!(!log.can_undo());
        assert!(log.can_redo());

        log.redo();
        assert!(log.can_undo());
        assert!(!log.can_redo());
    }

    #[test]
    fn test_serialize_range_and_deserialize() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.push(Operation::SetBrushSpacing(0.15));

        let bytes = log.serialize_range(0..2);

        let mut log2 = OpLog::new();
        log2.begin_undo_group();
        log2.deserialize_and_append(&bytes).unwrap();

        assert_eq!(log2.active_operations(), log.active_operations());
    }

    #[test]
    fn test_multiple_undo_groups() {
        let mut log = OpLog::new();

        // Group 1
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));

        // Group 2
        log.begin_undo_group();
        log.push(Operation::SetLayerBlendMode {
            layer: 0,
            mode: BlendMode::Multiply,
        });

        // Group 3
        log.begin_undo_group();
        log.push(Operation::AddLayer);

        assert_eq!(log.active_len(), 3);

        // Undo all three
        log.undo();
        assert_eq!(log.active_len(), 2);
        log.undo();
        assert_eq!(log.active_len(), 1);
        log.undo();
        assert_eq!(log.active_len(), 0);

        // Redo all three
        log.redo();
        assert_eq!(log.active_len(), 1);
        log.redo();
        assert_eq!(log.active_len(), 2);
        log.redo();
        assert_eq!(log.active_len(), 3);
    }

    #[test]
    fn test_implicit_group_on_push() {
        let mut log = OpLog::new();
        // Push without begin_undo_group — should auto-start a group
        log.push(Operation::SetBrushSize(10.0));
        assert_eq!(log.active_len(), 1);
        assert!(log.can_undo());
    }

    // -- Coalescing tests --

    #[test]
    fn test_coalesce_brush_size() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        for i in 1..=10 {
            log.push(Operation::SetBrushSize(i as f32));
        }
        assert_eq!(log.active_len(), 1);
        assert_eq!(log.active_operations()[0], Operation::SetBrushSize(10.0));
    }

    #[test]
    fn test_no_coalesce_different_types() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.push(Operation::SetBrushSpacing(0.5));
        assert_eq!(log.active_len(), 2);
    }

    #[test]
    fn test_coalesce_layer_opacity_same_layer() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetLayerOpacity { layer: 0, opacity: 0.3 });
        log.push(Operation::SetLayerOpacity { layer: 0, opacity: 0.7 });
        assert_eq!(log.active_len(), 1);
        assert_eq!(
            log.active_operations()[0],
            Operation::SetLayerOpacity { layer: 0, opacity: 0.7 }
        );
    }

    #[test]
    fn test_no_coalesce_layer_opacity_different_layers() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetLayerOpacity { layer: 0, opacity: 0.3 });
        log.push(Operation::SetLayerOpacity { layer: 1, opacity: 0.7 });
        assert_eq!(log.active_len(), 2);
    }

    #[test]
    fn test_no_coalesce_stroke_move() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::StrokeMove { x: 1.0, y: 1.0, pressure: 1.0 });
        log.push(Operation::StrokeMove { x: 2.0, y: 2.0, pressure: 1.0 });
        log.push(Operation::StrokeMove { x: 3.0, y: 3.0, pressure: 1.0 });
        assert_eq!(log.active_len(), 3);
    }

    #[test]
    fn test_no_coalesce_across_undo_groups() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(20.0));

        // Both should exist — coalescing doesn't cross group boundaries
        assert_eq!(log.active_len(), 2);
        assert_eq!(log.active_operations()[0], Operation::SetBrushSize(10.0));
        assert_eq!(log.active_operations()[1], Operation::SetBrushSize(20.0));
    }

    #[test]
    fn test_coalesce_background_color() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetBackgroundColor { r: 255, g: 0, b: 0 });
        log.push(Operation::SetBackgroundColor { r: 0, g: 255, b: 0 });
        assert_eq!(log.active_len(), 1);
        assert_eq!(
            log.active_operations()[0],
            Operation::SetBackgroundColor { r: 0, g: 255, b: 0 }
        );
    }

    #[test]
    fn test_coalesce_blend_mode_same_layer() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetLayerBlendMode { layer: 0, mode: BlendMode::Multiply });
        log.push(Operation::SetLayerBlendMode { layer: 0, mode: BlendMode::Screen });
        assert_eq!(log.active_len(), 1);
        assert_eq!(
            log.active_operations()[0],
            Operation::SetLayerBlendMode { layer: 0, mode: BlendMode::Screen }
        );
    }

    // -- Flush tests --

    #[test]
    fn test_pending_flush_count() {
        let mut log = OpLog::new();
        assert_eq!(log.pending_flush_count(), 0);

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.push(Operation::SetBrushSpacing(0.15));
        assert_eq!(log.pending_flush_count(), 2);
    }

    #[test]
    fn test_flush_pending_serializes_and_advances() {
        let mut log = OpLog::new();
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.push(Operation::AddLayer);

        let data = log.flush_pending().unwrap();
        assert!(!data.is_empty());
        assert_eq!(log.pending_flush_count(), 0);

        // Verify round-trip
        let ops = deserialize_operations(&data).unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0], Operation::SetBrushSize(10.0));
        assert_eq!(ops[1], Operation::AddLayer);
    }

    #[test]
    fn test_flush_returns_none_when_empty() {
        let mut log = OpLog::new();
        assert!(log.flush_pending().is_none());

        // Also returns None after everything is already flushed
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.flush_pending();
        assert!(log.flush_pending().is_none());
    }

    #[test]
    fn test_incremental_flush() {
        let mut log = OpLog::new();

        // First batch
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        let data1 = log.flush_pending().unwrap();

        // Second batch
        log.begin_undo_group();
        log.push(Operation::AddLayer);
        log.push(Operation::SetBrushFlow(0.5));
        let data2 = log.flush_pending().unwrap();

        let ops1 = deserialize_operations(&data1).unwrap();
        assert_eq!(ops1.len(), 1);
        assert_eq!(ops1[0], Operation::SetBrushSize(10.0));

        let ops2 = deserialize_operations(&data2).unwrap();
        assert_eq!(ops2.len(), 2);
        assert_eq!(ops2[0], Operation::AddLayer);
    }

    #[test]
    fn test_flush_index_clamped_on_undo_then_push() {
        let mut log = OpLog::new();

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(10.0));
        log.flush_pending(); // flush_index = 1

        log.begin_undo_group();
        log.push(Operation::SetBrushSize(20.0));
        log.flush_pending(); // flush_index = 2

        // Undo group 2, then push new op (truncates redo)
        log.undo();
        log.begin_undo_group();
        log.push(Operation::SetBrushSize(30.0));

        // flush_index was clamped from 2 to 1 by truncate_redo
        assert_eq!(log.pending_flush_count(), 1);
        let data = log.flush_pending().unwrap();
        let ops = deserialize_operations(&data).unwrap();
        assert_eq!(ops[0], Operation::SetBrushSize(30.0));
    }
}
