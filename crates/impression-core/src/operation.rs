use serde::{Deserialize, Serialize};

use crate::blend_mode::BlendMode;
use crate::selection::CombineMode;

/// Every state-mutating action in the painting application.
/// Recorded into an append-only log for persistence, undo/redo, and playback.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Operation {
    CreateCanvas {
        width: u32,
        height: u32,
        ppi: u32,
    },
    StrokeBegin {
        layer: u32,
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
    AddLayer,
    RemoveLayer(u32),
    SetLayerOpacity {
        layer: u32,
        opacity: f32,
    },
    SetLayerBlendMode {
        layer: u32,
        mode: BlendMode,
    },
    SetLayerVisible {
        layer: u32,
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
}

/// Serialize a slice of operations to bytes using postcard.
pub fn serialize_operations(ops: &[Operation]) -> Vec<u8> {
    postcard::to_allocvec(ops).expect("serialization should not fail")
}

/// Deserialize operations from bytes.
pub fn deserialize_operations(data: &[u8]) -> Result<Vec<Operation>, postcard::Error> {
    postcard::from_bytes(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(op: Operation) {
        let bytes = postcard::to_allocvec(&op).unwrap();
        let decoded: Operation = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(op, decoded);
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
            layer: 0,
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
        round_trip(Operation::AddLayer);
        round_trip(Operation::RemoveLayer(2));
        round_trip(Operation::SetLayerOpacity {
            layer: 1,
            opacity: 0.5,
        });
        round_trip(Operation::SetLayerBlendMode {
            layer: 0,
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
    fn test_stroke_end_compact() {
        let bytes = postcard::to_allocvec(&Operation::StrokeEnd).unwrap();
        assert!(bytes.len() <= 2, "StrokeEnd should be very compact, got {} bytes", bytes.len());
    }

    #[test]
    fn test_serialize_operations_batch() {
        let ops = vec![
            Operation::SetBrushSize(10.0),
            Operation::StrokeBegin {
                layer: 0,
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
        ];
        let bytes = serialize_operations(&ops);
        let decoded = deserialize_operations(&bytes).unwrap();
        assert_eq!(ops, decoded);
    }
}
