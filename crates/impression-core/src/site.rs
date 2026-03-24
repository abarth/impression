use crate::brush::{BrushSettings, BrushTip};
use crate::operation::LayerId;
use crate::selection::SelectionMask;
use crate::stroke::StrokeState;
use crate::wet_media::WetMediaStrokeState;

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
    /// Cloned tip data for the active brush tip (set when active_tip_id changes).
    pub active_tip: Option<BrushTip>,
    /// Cloned tip data for the secondary brush tip.
    pub secondary_tip: Option<BrushTip>,
    /// Cloned tip data for the texture pattern.
    pub texture_tip: Option<BrushTip>,
    /// Per-stroke state for wet media brush model.
    pub wet_media_stroke: WetMediaStrokeState,
}

impl Default for SiteState {
    fn default() -> Self {
        Self {
            brush: BrushSettings::default(),
            stroke_state: StrokeState::new(),
            selection: None,
            lasso_points: Vec::new(),
            stroke_layer: 0,
            active_tip: None,
            secondary_tip: None,
            texture_tip: None,
            wet_media_stroke: WetMediaStrokeState::default(),
        }
    }
}
