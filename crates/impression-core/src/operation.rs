use serde::{Deserialize, Serialize};

use crate::blend_mode::BlendMode;
use crate::brush::{DualBrushSettings, ScatterSettings, TextureSettings};
use crate::dynamics::{ShapeDynamics, TransferDynamics};
use crate::selection::CombineMode;

/// Unique identifier for a site (user session). In single-player mode, this
/// is always 0. In multiplayer, each connected user receives a unique ID.
/// See docs/multiplayer-design.md for the full design.
pub type SiteId = u32;

/// Unique identifier for a layer. Generated as `(site_id << 32) | counter`
/// to guarantee uniqueness across sites without coordination.
/// See docs/multiplayer-design.md for the full design.
pub type LayerId = u64;

/// An operation tagged with the site that created it. Every entry in the
/// operation log is a `SiteOperation`. The site ID determines undo scope
/// (per-site undo) and which per-site state (brush, selection) to use.
/// See docs/multiplayer-design.md for the full design.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiteOperation {
    pub site: SiteId,
    pub op: Operation,
}

/// Every state-mutating action in the painting application.
/// Recorded into an append-only log for persistence, undo/redo, and playback.
///
/// Layer references use `LayerId` (globally unique) rather than positional
/// indices to avoid conflicts when multiple sites add or remove layers
/// concurrently. See docs/multiplayer-design.md.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Operation {
    CreateCanvas {
        width: u32,
        height: u32,
        ppi: u32,
    },
    StrokeBegin {
        layer: LayerId,
        x: f32,
        y: f32,
        pressure: f32,
    },
    StrokeMove {
        x: f32,
        y: f32,
        pressure: f32,
    },
    StrokeEnd,
    SetBrushSize(f32),
    SetBrushSpacing(f32),
    SetBrushColor {
        r: u8,
        g: u8,
        b: u8,
    },
    SetBrushOpacity(f32),
    SetBrushFlow(f32),
    SetBrushBlendMode(BlendMode),
    SetBrushHardness(f32),
    SetBrushRoundness(f32),
    SetBrushAngle(f32),
    SetBrushTip(Option<String>),
    /// Add a new layer with the given globally unique ID.
    AddLayer {
        id: LayerId,
    },
    /// Remove a layer by its unique ID.
    RemoveLayer(LayerId),
    SetLayerOpacity {
        layer: LayerId,
        opacity: f32,
    },
    SetLayerBlendMode {
        layer: LayerId,
        mode: BlendMode,
    },
    SetLayerVisible {
        layer: LayerId,
        visible: bool,
    },
    SetBackgroundColor {
        r: u8,
        g: u8,
        b: u8,
    },
    SetCanvasVisible(bool),
    SelectionRect {
        x: u32,
        y: u32,
        w: u32,
        h: u32,
        mode: CombineMode,
    },
    SelectionLasso {
        points: Vec<(f32, f32)>,
        mode: CombineMode,
    },
    SelectAll,
    Deselect,
    /// Clear the selected area on a layer (or entire layer if no selection).
    ClearLayer {
        layer: LayerId,
    },
    /// Rename a layer.
    RenameLayer {
        layer: LayerId,
        name: String,
    },
    /// Move a layer to a new position. `before` is the LayerId of the layer
    /// it should be placed before, or `None` to move to the end.
    MoveLayer {
        layer: LayerId,
        before: Option<LayerId>,
    },
    SetShapeDynamics(ShapeDynamics),
    SetTransferDynamics(TransferDynamics),
    SetBrushFlipX(bool),
    SetBrushFlipY(bool),
    SetScatter(ScatterSettings),
    SetDualBrush(DualBrushSettings),
    SetSecondaryBrushTip(Option<String>),
    SetTexture(TextureSettings),
    SetTextureTip(Option<String>),
    /// Reset brush settings to defaults, preserving color. Ensures replay
    /// matches live execution even if the frontend omits some properties.
    ResetBrush,
    /// Add an adjustment layer with the given kind.
    AddAdjustmentLayer {
        id: LayerId,
        kind: crate::layer::AdjustmentKind,
    },
    /// Update the adjustment data for an adjustment layer.
    SetAdjustmentData {
        layer: LayerId,
        kind: crate::layer::AdjustmentKind,
    },
}

impl Operation {
    /// Returns true if this operation should start a new undo group when appended
    /// to the op log. Most operations start a group, but stroke continuations
    /// default to extending the active group.
    pub fn starts_undo_group(&self) -> bool {
        !matches!(self, Operation::StrokeMove { .. } | Operation::StrokeEnd)
    }
}

/// Magic byte prefix indicating a versioned format.
/// 0xFF is chosen because postcard varint uses the high bit as a continuation
/// flag, so a Vec with 127+ elements would need multiple bytes. This makes
/// 0xFF extremely unlikely as the first byte of unversioned postcard data.
const VERSION_MAGIC: u8 = 0xFF;

/// Current serialization format version.
const FORMAT_VERSION: u8 = 1;

/// Serialize a slice of site operations to bytes using postcard, with a version header.
pub fn serialize_operations(ops: &[SiteOperation]) -> Vec<u8> {
    let payload = postcard::to_allocvec(ops).expect("serialization should not fail");
    let mut out = Vec::with_capacity(2 + payload.len());
    out.push(VERSION_MAGIC);
    out.push(FORMAT_VERSION);
    out.extend_from_slice(&payload);
    out
}

/// Deserialize site operations from bytes.
/// Accepts versioned format (magic + version + postcard) and legacy (raw postcard).
pub fn deserialize_operations(data: &[u8]) -> Result<Vec<SiteOperation>, postcard::Error> {
    if data.is_empty() {
        return Ok(Vec::new());
    }
    if data.len() >= 2 && data[0] == VERSION_MAGIC {
        match data[1] {
            FORMAT_VERSION => postcard::from_bytes(&data[2..]),
            _ => Err(postcard::Error::DeserializeUnexpectedEnd),
        }
    } else {
        // Legacy format: no version header, parse directly
        postcard::from_bytes(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(op: Operation) {
        let site_op = SiteOperation {
            site: 0,
            op: op.clone(),
        };
        let bytes = postcard::to_allocvec(&site_op).unwrap();
        let decoded: SiteOperation = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(site_op, decoded);
    }

    #[test]
    fn test_round_trip_create_canvas() {
        round_trip(Operation::CreateCanvas {
            width: 1920,
            height: 1080,
            ppi: 72,
        });
    }

    #[test]
    fn test_round_trip_stroke_begin() {
        round_trip(Operation::StrokeBegin {
            layer: 1,
            x: 100.5,
            y: 200.3,
            pressure: 0.75,
        });
    }

    #[test]
    fn test_round_trip_stroke_move() {
        round_trip(Operation::StrokeMove {
            x: 101.0,
            y: 201.0,
            pressure: 0.8,
        });
    }

    #[test]
    fn test_round_trip_stroke_end() {
        round_trip(Operation::StrokeEnd);
    }

    #[test]
    fn test_round_trip_brush_settings() {
        round_trip(Operation::SetBrushSize(20.0));
        round_trip(Operation::SetBrushSpacing(0.15));
        round_trip(Operation::SetBrushColor {
            r: 255,
            g: 128,
            b: 0,
        });
        round_trip(Operation::SetBrushOpacity(0.8));
        round_trip(Operation::SetBrushFlow(0.6));
    }

    #[test]
    fn test_round_trip_layer_operations() {
        round_trip(Operation::AddLayer { id: 1 });
        round_trip(Operation::RemoveLayer(2));
        round_trip(Operation::SetLayerOpacity {
            layer: 1,
            opacity: 0.5,
        });
        round_trip(Operation::SetLayerBlendMode {
            layer: 1,
            mode: BlendMode::Multiply,
        });
        round_trip(Operation::SetLayerVisible {
            layer: 3,
            visible: false,
        });
    }

    #[test]
    fn test_round_trip_background() {
        round_trip(Operation::SetBackgroundColor {
            r: 30,
            g: 30,
            b: 30,
        });
        round_trip(Operation::SetCanvasVisible(false));
    }

    #[test]
    fn test_round_trip_selection_rect() {
        round_trip(Operation::SelectionRect {
            x: 10,
            y: 20,
            w: 100,
            h: 200,
            mode: CombineMode::Add,
        });
    }

    #[test]
    fn test_round_trip_selection_lasso() {
        let points: Vec<(f32, f32)> = (0..1000).map(|i| (i as f32, i as f32 * 0.5)).collect();
        round_trip(Operation::SelectionLasso {
            points,
            mode: CombineMode::Subtract,
        });
    }

    #[test]
    fn test_round_trip_select_all_deselect() {
        round_trip(Operation::SelectAll);
        round_trip(Operation::Deselect);
    }

    #[test]
    fn test_round_trip_clear_layer() {
        round_trip(Operation::ClearLayer { layer: 42 });
    }

    #[test]
    fn test_round_trip_rename_layer() {
        round_trip(Operation::RenameLayer {
            layer: 1,
            name: "Background".to_string(),
        });
    }

    #[test]
    fn test_round_trip_move_layer() {
        round_trip(Operation::MoveLayer {
            layer: 5,
            before: Some(2),
        });
        round_trip(Operation::MoveLayer {
            layer: 3,
            before: None,
        });
    }

    #[test]
    fn test_round_trip_dual_brush() {
        use crate::brush::{DualBrushMode, DualBrushSettings, ScatterSettings};
        round_trip(Operation::SetDualBrush(DualBrushSettings {
            enabled: true,
            mode: DualBrushMode::Darken,
            hardness: 0.5,
            size_ratio: 1.5,
            spacing: 0.15,
            flip: true,
            scatter: ScatterSettings {
                scatter: 1.5,
                both_axes: true,
                count: 2,
                count_jitter: 0.0,
            },
        }));
    }

    #[test]
    fn test_round_trip_secondary_brush_tip() {
        round_trip(Operation::SetSecondaryBrushTip(Some("tip-123".to_string())));
        round_trip(Operation::SetSecondaryBrushTip(None));
    }

    #[test]
    fn test_round_trip_scatter() {
        use crate::brush::ScatterSettings;
        round_trip(Operation::SetScatter(ScatterSettings {
            scatter: 2.5,
            both_axes: true,
            count: 3,
            count_jitter: 0.5,
        }));
    }

    #[test]
    fn test_round_trip_texture() {
        use crate::brush::TextureSettings;
        round_trip(Operation::SetTexture(TextureSettings {
            enabled: true,
            scale: 200.0,
            depth: 0.75,
            texture_each_tip: true,
        }));
    }

    #[test]
    fn test_round_trip_texture_tip() {
        round_trip(Operation::SetTextureTip(Some("pattern-abc".to_string())));
        round_trip(Operation::SetTextureTip(None));
    }

    #[test]
    fn test_round_trip_reset_brush() {
        round_trip(Operation::ResetBrush);
    }

    #[test]
    fn test_stroke_end_compact() {
        let site_op = SiteOperation {
            site: 0,
            op: Operation::StrokeEnd,
        };
        let bytes = postcard::to_allocvec(&site_op).unwrap();
        assert!(
            bytes.len() <= 4,
            "SiteOperation(StrokeEnd) should be compact, got {} bytes",
            bytes.len()
        );
    }

    #[test]
    fn test_serialize_operations_batch() {
        let ops: Vec<SiteOperation> = vec![
            Operation::SetBrushSize(10.0),
            Operation::StrokeBegin {
                layer: 1,
                x: 50.0,
                y: 50.0,
                pressure: 1.0,
            },
            Operation::StrokeMove {
                x: 60.0,
                y: 50.0,
                pressure: 0.9,
            },
            Operation::StrokeEnd,
        ]
        .into_iter()
        .map(|op| SiteOperation { site: 0, op })
        .collect();
        let bytes = serialize_operations(&ops);
        let decoded = deserialize_operations(&bytes).unwrap();
        assert_eq!(ops, decoded);
    }

    #[test]
    fn test_site_operation_with_different_sites() {
        let op1 = SiteOperation {
            site: 0,
            op: Operation::SetBrushSize(10.0),
        };
        let op2 = SiteOperation {
            site: 1,
            op: Operation::SetBrushSize(10.0),
        };
        assert_ne!(
            op1, op2,
            "Same operation from different sites should not be equal"
        );
    }

    #[test]
    fn test_layer_id_encoding() {
        // Verify the (site_id << 32) | counter encoding produces unique IDs
        let site_0_layer_0: LayerId = (0u64 << 32) | 0;
        let site_0_layer_1: LayerId = (0u64 << 32) | 1;
        let site_1_layer_0: LayerId = (1u64 << 32) | 0;
        assert_ne!(site_0_layer_0, site_0_layer_1);
        assert_ne!(site_0_layer_0, site_1_layer_0);
        assert_ne!(site_0_layer_1, site_1_layer_0);
    }

    #[test]
    fn test_serialization_has_version_header() {
        let ops = vec![SiteOperation {
            site: 0,
            op: Operation::StrokeEnd,
        }];
        let bytes = serialize_operations(&ops);
        assert_eq!(bytes[0], 0xFF, "First byte should be version magic");
        assert_eq!(bytes[1], 1, "Second byte should be version 1");
    }

    #[test]
    fn test_deserialize_legacy_format() {
        // Legacy format: no version header, raw postcard bytes
        let ops = vec![SiteOperation {
            site: 0,
            op: Operation::StrokeEnd,
        }];
        let legacy_bytes = postcard::to_allocvec(&ops).unwrap();
        // Should still deserialize successfully (fallback)
        let decoded = deserialize_operations(&legacy_bytes).unwrap();
        assert_eq!(ops, decoded);
    }

    #[test]
    fn test_deserialize_empty_data() {
        let decoded = deserialize_operations(&[]).unwrap();
        assert!(decoded.is_empty());
    }

    #[test]
    fn test_round_trip_add_adjustment_layer() {
        round_trip(Operation::AddAdjustmentLayer {
            id: 42,
            kind: crate::layer::AdjustmentKind::GradientMap {
                gradient_id: "my-gradient".to_string(),
            },
        });
    }

    #[test]
    fn test_round_trip_set_adjustment_data() {
        round_trip(Operation::SetAdjustmentData {
            layer: 99,
            kind: crate::layer::AdjustmentKind::GradientMap {
                gradient_id: "updated-gradient".to_string(),
            },
        });
    }
}
