use crate::brush::{BrushSettings, BrushTip, StrokeState};
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
    /// Active brush tip ID (references Canvas::tip_registry).
    pub active_tip_id: Option<String>,
    /// Cloned tip data for the active brush tip (set when active_tip_id changes).
    pub active_tip: Option<BrushTip>,
    /// Secondary (dual brush) tip ID.
    pub secondary_tip_id: Option<String>,
    /// Cloned tip data for the secondary brush tip.
    pub secondary_tip: Option<BrushTip>,
    /// Texture pattern tip ID.
    pub texture_tip_id: Option<String>,
    /// Cloned tip data for the texture pattern.
    pub texture_tip: Option<BrushTip>,
}

impl Default for SiteState {
    fn default() -> Self {
        Self {
            brush: BrushSettings::default(),
            stroke_state: StrokeState::new(),
            selection: None,
            lasso_points: Vec::new(),
            stroke_layer: 0,
            active_tip_id: None,
            active_tip: None,
            secondary_tip_id: None,
            secondary_tip: None,
            texture_tip_id: None,
            texture_tip: None,
        }
    }
}
