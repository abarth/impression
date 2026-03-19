use crate::brush::{BrushSettings, StrokeState};
use crate::operation::LayerId;
use crate::selection::SelectionMask;

/// Per-site state: brush settings, selection, stroke state, and lasso points.
/// Each connected user (site) has their own isolated copy of these.
/// See docs/multiplayer-design.md.
#[derive(Clone)]
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
