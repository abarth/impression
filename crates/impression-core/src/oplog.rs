use crate::operation::{deserialize_operations, serialize_operations, Operation, SiteId, SiteOperation};

/// An undo group: a range of operations that undo/redo together,
/// tagged with the site that created them for per-site undo.
/// See docs/multiplayer-design.md.
struct UndoGroup {
    site: SiteId,
    /// Start index in the operations vec (inclusive).
    start: usize,
    /// End index in the operations vec (exclusive).
    end: usize,
    /// Whether this group has been undone.
    undone: bool,
}

/// Append-only operation log with per-site undo groups.
///
/// Operations from multiple sites are interleaved in append order. Each undo
/// group is tagged with its originating site. Undo/redo only affects groups
/// belonging to the requesting site, leaving other sites' operations intact.
/// See docs/multiplayer-design.md.
pub struct OpLog {
    /// All recorded operations.
    operations: Vec<SiteOperation>,
    /// Undo groups, in creation order.
    groups: Vec<UndoGroup>,
    /// Index of the first operation not yet flushed to persistent storage.
    flush_index: usize,
}

impl OpLog {
    pub fn new() -> Self {
        Self {
            operations: Vec::new(),
            groups: Vec::new(),
            flush_index: 0,
        }
    }

    /// Begin a new undo group for the given site. All operations pushed until
    /// the next `begin_undo_group` call belong to this group.
    /// Discards any redo groups for this site (new work invalidates redo).
    pub fn begin_undo_group(&mut self, site: SiteId) {
        self.discard_redo_for_site(site);
        self.groups.push(UndoGroup {
            site,
            start: self.operations.len(),
            end: self.operations.len(),
            undone: false,
        });
    }

    /// Append an operation to the log. Coalesces with the previous
    /// operation if they are the same property-change type within
    /// the current undo group.
    pub fn push(&mut self, site_op: SiteOperation) {
        // If no group has been started for this site, implicitly start one
        if self.groups.is_empty() || self.current_group_for_site(site_op.site).is_none() {
            self.begin_undo_group(site_op.site);
        }
        if self.can_coalesce_with_last(&site_op) {
            *self.operations.last_mut().unwrap() = site_op;
        } else {
            self.operations.push(site_op);
        }
        // Update the end of the current group
        if let Some(group) = self.groups.last_mut() {
            group.end = self.operations.len();
        }
    }

    /// Check if `op` can replace the last operation in the current group.
    fn can_coalesce_with_last(&self, site_op: &SiteOperation) -> bool {
        let group = match self.groups.last() {
            Some(g) if g.site == site_op.site && !g.undone => g,
            _ => return false,
        };
        if self.operations.len() <= group.start {
            return false;
        }
        let last = &self.operations[self.operations.len() - 1].op;
        let op = &site_op.op;
        matches!(
            (last, op),
            (Operation::SetBrushSize(_), Operation::SetBrushSize(_))
            | (Operation::SetBrushSpacing(_), Operation::SetBrushSpacing(_))
            | (Operation::SetBrushOpacity(_), Operation::SetBrushOpacity(_))
            | (Operation::SetBrushFlow(_), Operation::SetBrushFlow(_))
            | (Operation::SetBrushBlendMode(_), Operation::SetBrushBlendMode(_))
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

    /// Find the last non-undone group index for a given site.
    fn current_group_for_site(&self, site: SiteId) -> Option<usize> {
        self.groups.iter().rposition(|g| g.site == site && !g.undone)
    }

    /// Number of active operations (in non-undone groups).
    pub fn active_len(&self) -> usize {
        self.groups.iter()
            .filter(|g| !g.undone)
            .map(|g| g.end - g.start)
            .sum()
    }

    /// Collect active operations (excludes undone groups) in log order.
    pub fn active_operations(&self) -> Vec<SiteOperation> {
        let mut ops = Vec::new();
        for group in &self.groups {
            if !group.undone {
                ops.extend_from_slice(&self.operations[group.start..group.end]);
            }
        }
        ops
    }

    /// Undo the last group for the given site. Returns true if an undo occurred.
    pub fn undo(&mut self, site: SiteId) -> bool {
        if let Some(idx) = self.groups.iter().rposition(|g| g.site == site && !g.undone) {
            self.groups[idx].undone = true;
            true
        } else {
            false
        }
    }

    /// Redo the next undone group for the given site. Returns true if a redo occurred.
    pub fn redo(&mut self, site: SiteId) -> bool {
        // Find the earliest undone group for this site that comes after
        // the last active group for this site
        let search_start = self.groups.iter()
            .rposition(|g| g.site == site && !g.undone)
            .map(|i| i + 1)
            .unwrap_or(0);
        for group in &mut self.groups[search_start..] {
            if group.site == site && group.undone {
                group.undone = false;
                return true;
            }
        }
        false
    }

    pub fn can_undo(&self, site: SiteId) -> bool {
        self.groups.iter().any(|g| g.site == site && !g.undone)
    }

    pub fn can_redo(&self, site: SiteId) -> bool {
        let search_start = self.groups.iter()
            .rposition(|g| g.site == site && !g.undone)
            .map(|i| i + 1)
            .unwrap_or(0);
        self.groups[search_start..].iter().any(|g| g.site == site && g.undone)
    }

    /// Total number of undo groups.
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }

    /// Return the undone flag for each group, in order.
    pub fn group_undone_flags(&self) -> Vec<bool> {
        self.groups.iter().map(|g| g.undone).collect()
    }

    /// Number of non-undone groups.
    pub fn active_group_count(&self) -> usize {
        self.groups.iter().filter(|g| !g.undone).count()
    }

    /// Collect active operations from groups at index >= `group_start`.
    pub fn active_operations_from_group(&self, group_start: usize) -> Vec<SiteOperation> {
        let mut ops = Vec::new();
        for group in self.groups[group_start..].iter() {
            if !group.undone {
                ops.extend_from_slice(&self.operations[group.start..group.end]);
            }
        }
        ops
    }

    /// Discard all undone (redo) groups for a site and their operations.
    fn discard_redo_for_site(&mut self, site: SiteId) {
        let last_active = self.groups.iter()
            .rposition(|g| g.site == site && !g.undone);
        let search_start = last_active.map(|i| i + 1).unwrap_or(0);

        // Collect indices of undone groups for this site to remove
        let to_remove: Vec<usize> = self.groups[search_start..].iter()
            .enumerate()
            .filter(|(_, g)| g.site == site && g.undone)
            .map(|(i, _)| search_start + i)
            .collect();

        // Remove in reverse order to maintain indices
        for idx in to_remove.into_iter().rev() {
            // Note: we leave the operations in place (they become orphaned)
            // since removing from the middle of the vec would break all indices.
            // This is acceptable because orphaned ops are never referenced.
            self.groups.remove(idx);
        }
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

    /// Number of active operations not yet flushed to persistent storage.
    pub fn pending_flush_count(&self) -> usize {
        // Count operations in active groups that are past flush_index
        let mut count = 0;
        for group in &self.groups {
            if !group.undone {
                let start = group.start.max(self.flush_index);
                if start < group.end {
                    count += group.end - start;
                }
            }
        }
        count
    }

    /// Serialize and return all pending (unflushed active) operations,
    /// advancing the flush index. Returns None if nothing to flush.
    pub fn flush_pending(&mut self) -> Option<Vec<u8>> {
        let active_ops = self.active_operations();
        // Find operations that haven't been flushed yet
        // For simplicity, flush all active operations past flush_index
        let mut pending = Vec::new();
        for group in &self.groups {
            if !group.undone {
                for i in group.start..group.end {
                    if i >= self.flush_index {
                        pending.push(self.operations[i].clone());
                    }
                }
            }
        }
        if pending.is_empty() {
            return None;
        }
        let data = serialize_operations(&pending);
        // Advance flush index past all active operations
        let max_end = self.groups.iter()
            .filter(|g| !g.undone)
            .map(|g| g.end)
            .max()
            .unwrap_or(0);
        self.flush_index = max_end;
        drop(active_ops);
        Some(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blend_mode::BlendMode;

    /// Helper to create a SiteOperation for site 0.
    fn site_op(op: Operation) -> SiteOperation {
        SiteOperation { site: 0, op }
    }

    #[test]
    fn test_push_and_active_operations() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        log.push(site_op(Operation::SetBrushSpacing(0.15)));

        assert_eq!(log.active_len(), 2);
        let ops = log.active_operations();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op, Operation::SetBrushSize(10.0));
        assert_eq!(ops[1].op, Operation::SetBrushSpacing(0.15));
    }

    #[test]
    fn test_undo_group() {
        let mut log = OpLog::new();

        // Group 1: a stroke
        log.begin_undo_group(0);
        log.push(site_op(Operation::StrokeBegin {
            layer: 1,
            x: 10.0,
            y: 10.0,
            pressure: 1.0,
        }));
        log.push(site_op(Operation::StrokeMove {
            x: 20.0,
            y: 10.0,
            pressure: 0.9,
        }));
        log.push(site_op(Operation::StrokeEnd));

        // Group 2: a property change
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(50.0)));

        assert_eq!(log.active_len(), 4);

        // Undo group 2
        assert!(log.undo(0));
        assert_eq!(log.active_len(), 3);

        // Undo group 1
        assert!(log.undo(0));
        assert_eq!(log.active_len(), 0);

        // Nothing left to undo
        assert!(!log.undo(0));
    }

    #[test]
    fn test_redo_after_undo() {
        let mut log = OpLog::new();

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(20.0)));

        log.undo(0);
        assert_eq!(log.active_len(), 1);
        assert!(log.can_redo(0));

        assert!(log.redo(0));
        assert_eq!(log.active_len(), 2);
        assert!(!log.can_redo(0));
    }

    #[test]
    fn test_push_after_undo_discards_redo() {
        let mut log = OpLog::new();

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(20.0)));

        // Undo group 2
        log.undo(0);
        assert!(log.can_redo(0));

        // Push new operation — should discard redo history
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(30.0)));

        assert!(!log.can_redo(0));
        assert_eq!(log.active_len(), 2);
        let ops = log.active_operations();
        assert_eq!(ops[1].op, Operation::SetBrushSize(30.0));
    }

    #[test]
    fn test_can_undo_can_redo() {
        let mut log = OpLog::new();
        assert!(!log.can_undo(0));
        assert!(!log.can_redo(0));

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        assert!(log.can_undo(0));
        assert!(!log.can_redo(0));

        log.undo(0);
        assert!(!log.can_undo(0));
        assert!(log.can_redo(0));

        log.redo(0);
        assert!(log.can_undo(0));
        assert!(!log.can_redo(0));
    }

    #[test]
    fn test_serialize_range_and_deserialize() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        log.push(site_op(Operation::SetBrushSpacing(0.15)));

        let bytes = log.serialize_range(0..2);

        let mut log2 = OpLog::new();
        log2.begin_undo_group(0);
        log2.deserialize_and_append(&bytes).unwrap();

        let ops1 = log.active_operations();
        let ops2_raw: Vec<SiteOperation> = log2.operations.clone();
        assert_eq!(ops1.len(), ops2_raw.len());
    }

    #[test]
    fn test_multiple_undo_groups() {
        let mut log = OpLog::new();

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetLayerBlendMode {
            layer: 1,
            mode: BlendMode::Multiply,
        }));

        log.begin_undo_group(0);
        log.push(site_op(Operation::AddLayer { id: 2 }));

        assert_eq!(log.active_len(), 3);

        log.undo(0);
        assert_eq!(log.active_len(), 2);
        log.undo(0);
        assert_eq!(log.active_len(), 1);
        log.undo(0);
        assert_eq!(log.active_len(), 0);

        log.redo(0);
        assert_eq!(log.active_len(), 1);
        log.redo(0);
        assert_eq!(log.active_len(), 2);
        log.redo(0);
        assert_eq!(log.active_len(), 3);
    }

    #[test]
    fn test_implicit_group_on_push() {
        let mut log = OpLog::new();
        log.push(site_op(Operation::SetBrushSize(10.0)));
        assert_eq!(log.active_len(), 1);
        assert!(log.can_undo(0));
    }

    // -- Coalescing tests --

    #[test]
    fn test_coalesce_brush_size() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        for i in 1..=10 {
            log.push(site_op(Operation::SetBrushSize(i as f32)));
        }
        assert_eq!(log.active_len(), 1);
        assert_eq!(log.active_operations()[0].op, Operation::SetBrushSize(10.0));
    }

    #[test]
    fn test_no_coalesce_different_types() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        log.push(site_op(Operation::SetBrushSpacing(0.5)));
        assert_eq!(log.active_len(), 2);
    }

    #[test]
    fn test_coalesce_layer_opacity_same_layer() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetLayerOpacity { layer: 1, opacity: 0.3 }));
        log.push(site_op(Operation::SetLayerOpacity { layer: 1, opacity: 0.7 }));
        assert_eq!(log.active_len(), 1);
        assert_eq!(
            log.active_operations()[0].op,
            Operation::SetLayerOpacity { layer: 1, opacity: 0.7 }
        );
    }

    #[test]
    fn test_no_coalesce_layer_opacity_different_layers() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetLayerOpacity { layer: 1, opacity: 0.3 }));
        log.push(site_op(Operation::SetLayerOpacity { layer: 2, opacity: 0.7 }));
        assert_eq!(log.active_len(), 2);
    }

    #[test]
    fn test_no_coalesce_stroke_move() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::StrokeMove { x: 1.0, y: 1.0, pressure: 1.0 }));
        log.push(site_op(Operation::StrokeMove { x: 2.0, y: 2.0, pressure: 1.0 }));
        log.push(site_op(Operation::StrokeMove { x: 3.0, y: 3.0, pressure: 1.0 }));
        assert_eq!(log.active_len(), 3);
    }

    #[test]
    fn test_no_coalesce_across_undo_groups() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(20.0)));

        assert_eq!(log.active_len(), 2);
        let ops = log.active_operations();
        assert_eq!(ops[0].op, Operation::SetBrushSize(10.0));
        assert_eq!(ops[1].op, Operation::SetBrushSize(20.0));
    }

    #[test]
    fn test_coalesce_background_color() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBackgroundColor { r: 255, g: 0, b: 0 }));
        log.push(site_op(Operation::SetBackgroundColor { r: 0, g: 255, b: 0 }));
        assert_eq!(log.active_len(), 1);
        assert_eq!(
            log.active_operations()[0].op,
            Operation::SetBackgroundColor { r: 0, g: 255, b: 0 }
        );
    }

    #[test]
    fn test_coalesce_blend_mode_same_layer() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetLayerBlendMode { layer: 1, mode: BlendMode::Multiply }));
        log.push(site_op(Operation::SetLayerBlendMode { layer: 1, mode: BlendMode::Screen }));
        assert_eq!(log.active_len(), 1);
        assert_eq!(
            log.active_operations()[0].op,
            Operation::SetLayerBlendMode { layer: 1, mode: BlendMode::Screen }
        );
    }

    // -- Flush tests --

    #[test]
    fn test_pending_flush_count() {
        let mut log = OpLog::new();
        assert_eq!(log.pending_flush_count(), 0);

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        log.push(site_op(Operation::SetBrushSpacing(0.15)));
        assert_eq!(log.pending_flush_count(), 2);
    }

    #[test]
    fn test_flush_pending_serializes_and_advances() {
        let mut log = OpLog::new();
        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        log.push(site_op(Operation::AddLayer { id: 1 }));

        let data = log.flush_pending().unwrap();
        assert!(!data.is_empty());
        assert_eq!(log.pending_flush_count(), 0);

        let ops = deserialize_operations(&data).unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op, Operation::SetBrushSize(10.0));
        assert_eq!(ops[1].op, Operation::AddLayer { id: 1 });
    }

    #[test]
    fn test_flush_returns_none_when_empty() {
        let mut log = OpLog::new();
        assert!(log.flush_pending().is_none());

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        log.flush_pending();
        assert!(log.flush_pending().is_none());
    }

    #[test]
    fn test_incremental_flush() {
        let mut log = OpLog::new();

        log.begin_undo_group(0);
        log.push(site_op(Operation::SetBrushSize(10.0)));
        let data1 = log.flush_pending().unwrap();

        log.begin_undo_group(0);
        log.push(site_op(Operation::AddLayer { id: 1 }));
        log.push(site_op(Operation::SetBrushFlow(0.5)));
        let data2 = log.flush_pending().unwrap();

        let ops1 = deserialize_operations(&data1).unwrap();
        assert_eq!(ops1.len(), 1);
        assert_eq!(ops1[0].op, Operation::SetBrushSize(10.0));

        let ops2 = deserialize_operations(&data2).unwrap();
        assert_eq!(ops2.len(), 2);
        assert_eq!(ops2[0].op, Operation::AddLayer { id: 1 });
    }

    // -- Per-site undo tests --

    #[test]
    fn test_per_site_undo_only_affects_own_site() {
        let mut log = OpLog::new();

        // Site 0 draws
        log.begin_undo_group(0);
        log.push(SiteOperation { site: 0, op: Operation::SetBrushSize(10.0) });

        // Site 1 draws
        log.begin_undo_group(1);
        log.push(SiteOperation { site: 1, op: Operation::SetBrushSize(20.0) });

        assert_eq!(log.active_len(), 2);

        // Site 0 undoes — should only remove site 0's operation
        assert!(log.undo(0));
        assert_eq!(log.active_len(), 1);
        let ops = log.active_operations();
        assert_eq!(ops[0].site, 1);
        assert_eq!(ops[0].op, Operation::SetBrushSize(20.0));
    }

    #[test]
    fn test_per_site_redo_only_affects_own_site() {
        let mut log = OpLog::new();

        log.begin_undo_group(0);
        log.push(SiteOperation { site: 0, op: Operation::SetBrushSize(10.0) });

        log.begin_undo_group(1);
        log.push(SiteOperation { site: 1, op: Operation::SetBrushSize(20.0) });

        // Undo site 0
        log.undo(0);
        assert_eq!(log.active_len(), 1);

        // Redo site 0
        assert!(log.redo(0));
        assert_eq!(log.active_len(), 2);
    }

    #[test]
    fn test_cannot_undo_other_sites_ops() {
        let mut log = OpLog::new();

        log.begin_undo_group(1);
        log.push(SiteOperation { site: 1, op: Operation::SetBrushSize(20.0) });

        // Site 0 has nothing to undo
        assert!(!log.can_undo(0));
        assert!(!log.undo(0));
        // Site 1 can undo
        assert!(log.can_undo(1));
    }
}
