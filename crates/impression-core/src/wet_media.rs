use serde::{Deserialize, Serialize};

/// Settings specific to the wet media brush model.
/// Controls paint behavior for oil/acrylic simulation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WetMediaBrushSettings {
    /// How much paint is loaded on the brush (0.0–1.0).
    pub paint_load: f32,
    /// Thickness of applied paint for impasto effect (0.0–1.0).
    pub paint_thickness: f32,
    /// How wet the applied paint is (0.0–1.0). Wetter paint mixes more.
    pub wetness: f32,
    /// How much new paint mixes with existing wet paint on the canvas (0.0–1.0).
    pub mixing_strength: f32,
    /// Number of bristle marks in the brush footprint.
    pub bristle_count: u32,
    /// How far bristles spread apart under pressure (0.0–1.0).
    pub bristle_spread: f32,
    /// How quickly paint depletes over the length of a stroke (0.0–1.0).
    pub paint_depletion_rate: f32,
    /// Strength of canvas texture interaction (0.0–1.0).
    pub canvas_texture_strength: f32,
}

impl Default for WetMediaBrushSettings {
    fn default() -> Self {
        Self {
            paint_load: 0.8,
            paint_thickness: 0.5,
            wetness: 0.7,
            mixing_strength: 0.5,
            bristle_count: 64,
            bristle_spread: 0.3,
            paint_depletion_rate: 0.1,
            canvas_texture_strength: 0.3,
        }
    }
}

/// Which brush engine model to use for a stroke.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum BrushModel {
    /// Traditional stamp-based Photoshop-style brush.
    Stamp,
    /// Wet media simulation (oil, acrylic) with GPU-side paint physics.
    WetMedia,
}

impl Default for BrushModel {
    fn default() -> Self {
        BrushModel::Stamp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_wet_media_settings() {
        let settings = WetMediaBrushSettings::default();
        assert!((settings.paint_load - 0.8).abs() < f32::EPSILON);
        assert!((settings.wetness - 0.7).abs() < f32::EPSILON);
        assert_eq!(settings.bristle_count, 64);
    }

    #[test]
    fn test_brush_model_default_is_stamp() {
        assert_eq!(BrushModel::default(), BrushModel::Stamp);
    }

    #[test]
    fn test_wet_media_settings_serialization_round_trip() {
        let settings = WetMediaBrushSettings {
            paint_load: 0.6,
            paint_thickness: 0.8,
            wetness: 0.3,
            mixing_strength: 0.9,
            bristle_count: 128,
            bristle_spread: 0.5,
            paint_depletion_rate: 0.2,
            canvas_texture_strength: 0.4,
        };
        let bytes = rmp_serde::to_vec(&settings).unwrap();
        let decoded: WetMediaBrushSettings = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(settings, decoded);
    }

    #[test]
    fn test_brush_model_serialization_round_trip() {
        for model in [BrushModel::Stamp, BrushModel::WetMedia] {
            let bytes = rmp_serde::to_vec(&model).unwrap();
            let decoded: BrushModel = rmp_serde::from_slice(&bytes).unwrap();
            assert_eq!(model, decoded);
        }
    }
}
