use serde::{Deserialize, Serialize};

use crate::dynamics::Rng;

/// Paint medium type — each has distinct physical behavior.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum MediumType {
    Oil,
    Acrylic,
    Watercolor,
}

impl Default for MediumType {
    fn default() -> Self {
        MediumType::Oil
    }
}

/// Physical simulation parameters derived from medium type.
#[derive(Debug, Clone, Copy)]
pub struct MediumPhysics {
    pub viscosity: f32,
    pub drying_rate: f32,
    pub diffusion_rate: f32,
    pub advection_dissipation: f32,
}

impl MediumType {
    /// Returns default physics parameters for this medium.
    pub fn physics(&self) -> MediumPhysics {
        match self {
            MediumType::Oil => MediumPhysics {
                viscosity: 0.85,
                drying_rate: 0.001,
                diffusion_rate: 0.05,
                advection_dissipation: 0.99,
            },
            MediumType::Acrylic => MediumPhysics {
                viscosity: 0.5,
                drying_rate: 0.005,
                diffusion_rate: 0.15,
                advection_dissipation: 0.97,
            },
            MediumType::Watercolor => MediumPhysics {
                viscosity: 0.2,
                drying_rate: 0.003,
                diffusion_rate: 0.4,
                advection_dissipation: 0.95,
            },
        }
    }
}

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
    /// Paint medium type (oil, acrylic, watercolor).
    #[serde(default)]
    pub medium_type: MediumType,
    /// Paint viscosity override (0.0–1.0). Defaults to medium's default.
    #[serde(default = "default_viscosity")]
    pub viscosity: f32,
}

fn default_viscosity() -> f32 {
    0.7
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
            medium_type: MediumType::Oil,
            viscosity: 0.7,
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

/// A bristle footprint: a pressure mask showing where each bristle touches
/// the canvas, plus paint parameters for the GPU deposition shader.
#[derive(Clone, Debug)]
pub struct BristleFootprint {
    /// Per-pixel pressure values (0.0–1.0), row-major, width × height.
    pub mask: Vec<f32>,
    pub width: u32,
    pub height: u32,
    /// Canvas position of the footprint center.
    pub origin_x: f32,
    pub origin_y: f32,
    /// Paint color (RGB, 0.0–1.0).
    pub paint_color: [f32; 3],
    /// Remaining paint load on the brush (0.0–1.0).
    pub paint_load: f32,
    /// Brush movement velocity (canvas pixels per input event).
    pub velocity: [f32; 2],
    /// Wet media settings snapshot for the deposition shader.
    pub mixing_strength: f32,
    pub paint_thickness: f32,
    pub wetness: f32,
    pub canvas_texture_strength: f32,
}

/// Per-stroke state for wet media brushes.
#[derive(Clone, Debug)]
pub struct WetMediaStrokeState {
    /// Remaining paint on the brush, depletes over the stroke.
    pub paint_load_remaining: f32,
    /// Generated footprints waiting to be read by the TypeScript side.
    pub footprints: Vec<BristleFootprint>,
    /// Residual distance for spacing interpolation.
    pub residual_distance: f32,
    /// Last point for interpolation.
    pub last_point: Option<(f32, f32, f32)>,
    /// Per-stroke PRNG seed.
    pub stroke_seed: u32,
    /// Per-stroke PRNG.
    pub rng: Rng,
}

impl Default for WetMediaStrokeState {
    fn default() -> Self {
        Self {
            paint_load_remaining: 1.0,
            footprints: Vec::new(),
            residual_distance: 0.0,
            last_point: None,
            stroke_seed: 0,
            rng: Rng::from_coords(0.0, 0.0),
        }
    }
}

/// Generate a bristle footprint mask for the given brush position and settings.
///
/// The mask is a square of side `ceil(size)` pixels, centered at (origin_x, origin_y).
/// Each bristle is placed deterministically using the PRNG and produces a small
/// soft dot in the mask. Pressure affects how spread the bristles are and
/// how hard each bristle presses (higher pressure = more spread, more pressure per bristle).
pub fn generate_bristle_footprint(
    origin_x: f32,
    origin_y: f32,
    pressure: f32,
    brush_size: f32,
    brush_angle: f32,
    brush_roundness: f32,
    settings: &WetMediaBrushSettings,
    paint_color: [f32; 3],
    paint_load: f32,
    velocity: [f32; 2],
    rng: &mut Rng,
) -> BristleFootprint {
    let radius = brush_size * 0.5;
    let footprint_size = (brush_size.ceil() as u32).max(1);
    let mask_len = (footprint_size * footprint_size) as usize;
    let mut mask = vec![0.0f32; mask_len];

    let center = footprint_size as f32 * 0.5;
    let angle_rad = brush_angle.to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    // Each bristle is a small soft dot placed within the brush ellipse.
    // Bristle radius scales with brush size.
    let bristle_radius = (radius / (settings.bristle_count as f32).sqrt()).max(0.5);

    // Spread increases with pressure
    let spread = settings.bristle_spread * pressure;

    for _ in 0..settings.bristle_count {
        // Random position within unit circle, then scale by radius and spread
        let r = rng.next_f32().sqrt() * (0.5 + 0.5 * spread);
        let theta = rng.next_f32() * std::f32::consts::TAU;
        let local_x = r * theta.cos() * radius;
        let local_y = r * theta.sin() * radius * brush_roundness;

        // Rotate by brush angle
        let bx = center + local_x * cos_a - local_y * sin_a;
        let by = center + local_x * sin_a + local_y * cos_a;

        // Per-bristle pressure variation
        let bristle_pressure = (0.5 + 0.5 * rng.next_f32()) * pressure;

        // Stamp a soft dot at (bx, by)
        let br = bristle_radius;
        let x_min = ((bx - br).floor() as i32).max(0) as u32;
        let x_max = ((bx + br).ceil() as i32).min(footprint_size as i32 - 1) as u32;
        let y_min = ((by - br).floor() as i32).max(0) as u32;
        let y_max = ((by + br).ceil() as i32).min(footprint_size as i32 - 1) as u32;

        for py in y_min..=y_max {
            for px in x_min..=x_max {
                let dx = px as f32 + 0.5 - bx;
                let dy = py as f32 + 0.5 - by;
                let dist = (dx * dx + dy * dy).sqrt();
                if dist <= br {
                    // Smoothstep falloff
                    let t = (1.0 - dist / br).clamp(0.0, 1.0);
                    let alpha = t * t * (3.0 - 2.0 * t) * bristle_pressure;
                    let idx = (py * footprint_size + px) as usize;
                    // Accumulate (max blend so bristles don't over-brighten)
                    mask[idx] = mask[idx].max(alpha);
                }
            }
        }
    }

    BristleFootprint {
        mask,
        width: footprint_size,
        height: footprint_size,
        origin_x,
        origin_y,
        paint_color,
        paint_load,
        velocity,
        mixing_strength: settings.mixing_strength,
        paint_thickness: settings.paint_thickness,
        wetness: settings.wetness,
        canvas_texture_strength: settings.canvas_texture_strength,
    }
}

/// Begin a wet media stroke: generate the first footprint.
pub fn wet_media_stroke_begin(
    state: &mut WetMediaStrokeState,
    x: f32,
    y: f32,
    pressure: f32,
    brush_size: f32,
    brush_angle: f32,
    brush_roundness: f32,
    brush_spacing: f32,
    settings: &WetMediaBrushSettings,
    paint_color: [f32; 3],
) {
    let seed = x.to_bits() ^ y.to_bits().rotate_left(16);
    state.stroke_seed = if seed == 0 { 1 } else { seed };
    state.rng = Rng::from_coords(x, y);
    state.paint_load_remaining = settings.paint_load;
    state.footprints.clear();

    let footprint = generate_bristle_footprint(
        x, y, pressure,
        brush_size, brush_angle, brush_roundness,
        settings,
        paint_color,
        state.paint_load_remaining,
        [0.0, 0.0], // no velocity on first stamp
        &mut state.rng,
    );
    state.footprints.push(footprint);

    // Set residual so stroke_move starts from the next spacing interval
    let step = (brush_spacing * brush_size).max(1.0);
    state.residual_distance = step;
    state.last_point = Some((x, y, pressure));
}

/// Continue a wet media stroke: interpolate along the segment and generate footprints.
pub fn wet_media_stroke_move(
    state: &mut WetMediaStrokeState,
    x: f32,
    y: f32,
    pressure: f32,
    brush_size: f32,
    brush_angle: f32,
    brush_roundness: f32,
    brush_spacing: f32,
    settings: &WetMediaBrushSettings,
    paint_color: [f32; 3],
) {
    let (lx, ly, lp) = match state.last_point {
        Some(p) => p,
        None => return,
    };

    let dx = x - lx;
    let dy = y - ly;
    let seg_len = (dx * dx + dy * dy).sqrt();
    if seg_len < 0.001 {
        return;
    }

    let velocity = [dx, dy];
    let step = (brush_spacing * brush_size * pressure).max(1.0);
    let mut dist = state.residual_distance;

    while dist <= seg_len {
        let t = dist / seg_len;
        let px = lx + dx * t;
        let py = ly + dy * t;
        let pp = lp + (pressure - lp) * t;

        // Deplete paint
        state.paint_load_remaining =
            (state.paint_load_remaining - settings.paint_depletion_rate * step / brush_size)
                .max(0.0);

        let footprint = generate_bristle_footprint(
            px, py, pp,
            brush_size, brush_angle, brush_roundness,
            settings,
            paint_color,
            state.paint_load_remaining,
            velocity,
            &mut state.rng,
        );
        state.footprints.push(footprint);

        dist += step;
    }

    state.residual_distance = dist - seg_len;
    state.last_point = Some((x, y, pressure));
}

/// End a wet media stroke.
pub fn wet_media_stroke_end(state: &mut WetMediaStrokeState) {
    state.last_point = None;
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
            medium_type: MediumType::Acrylic,
            viscosity: 0.5,
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

    #[test]
    fn test_bristle_footprint_deterministic() {
        let settings = WetMediaBrushSettings::default();
        let mut rng1 = Rng::from_coords(10.0, 20.0);
        let mut rng2 = Rng::from_coords(10.0, 20.0);

        let fp1 = generate_bristle_footprint(
            50.0, 50.0, 0.8, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.8, [1.0, 0.0], &mut rng1,
        );
        let fp2 = generate_bristle_footprint(
            50.0, 50.0, 0.8, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.8, [1.0, 0.0], &mut rng2,
        );

        assert_eq!(fp1.mask.len(), fp2.mask.len());
        assert_eq!(fp1.width, fp2.width);
        for (a, b) in fp1.mask.iter().zip(fp2.mask.iter()) {
            assert!((a - b).abs() < f32::EPSILON, "Footprints must be deterministic");
        }
    }

    #[test]
    fn test_bristle_footprint_has_nonzero_pixels() {
        let settings = WetMediaBrushSettings {
            bristle_count: 32,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let fp = generate_bristle_footprint(
            25.0, 25.0, 1.0, 30.0, 0.0, 1.0,
            &settings, [0.0, 0.0, 1.0], 1.0, [0.0, 0.0], &mut rng,
        );
        let nonzero = fp.mask.iter().filter(|&&v| v > 0.0).count();
        assert!(nonzero > 0, "Footprint should have some nonzero pixels");
    }

    #[test]
    fn test_paint_depletion_over_stroke() {
        let settings = WetMediaBrushSettings {
            paint_load: 1.0,
            paint_depletion_rate: 0.5,
            bristle_count: 8,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 0.0, 0.0, 1.0, 10.0, 0.0, 1.0, 0.25, &settings, color,
        );
        let initial_load = state.paint_load_remaining;

        // Move far enough to generate several footprints
        wet_media_stroke_move(
            &mut state, 100.0, 0.0, 1.0, 10.0, 0.0, 1.0, 0.25, &settings, color,
        );

        assert!(
            state.paint_load_remaining < initial_load,
            "Paint should deplete: {} should be < {}",
            state.paint_load_remaining,
            initial_load,
        );
        assert!(state.footprints.len() > 1, "Should have generated multiple footprints");
    }

    #[test]
    fn test_wet_media_stroke_lifecycle() {
        let settings = WetMediaBrushSettings::default();
        let mut state = WetMediaStrokeState::default();
        let color = [0.5, 0.5, 0.5];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0, 20.0, 0.0, 1.0, 0.25, &settings, color,
        );
        assert_eq!(state.footprints.len(), 1);
        assert!(state.last_point.is_some());

        wet_media_stroke_move(
            &mut state, 50.0, 10.0, 0.8, 20.0, 0.0, 1.0, 0.25, &settings, color,
        );
        assert!(state.footprints.len() > 1);

        wet_media_stroke_end(&mut state);
        assert!(state.last_point.is_none());
    }

    #[test]
    fn test_medium_type_serialization_round_trip() {
        for medium in [MediumType::Oil, MediumType::Acrylic, MediumType::Watercolor] {
            let bytes = rmp_serde::to_vec(&medium).unwrap();
            let decoded: MediumType = rmp_serde::from_slice(&bytes).unwrap();
            assert_eq!(medium, decoded);
        }
    }

    #[test]
    fn test_medium_physics_valid_ranges() {
        for medium in [MediumType::Oil, MediumType::Acrylic, MediumType::Watercolor] {
            let p = medium.physics();
            assert!(p.viscosity >= 0.0 && p.viscosity <= 1.0, "viscosity out of range for {:?}", medium);
            assert!(p.drying_rate > 0.0 && p.drying_rate < 1.0, "drying_rate out of range for {:?}", medium);
            assert!(p.diffusion_rate >= 0.0 && p.diffusion_rate <= 1.0, "diffusion_rate out of range for {:?}", medium);
            assert!(p.advection_dissipation > 0.0 && p.advection_dissipation <= 1.0, "advection_dissipation out of range for {:?}", medium);
        }
    }

    #[test]
    fn test_wet_media_settings_backwards_compat() {
        // Old format without medium_type and viscosity should deserialize with defaults
        let old_settings = WetMediaBrushSettings {
            paint_load: 0.8,
            paint_thickness: 0.5,
            wetness: 0.7,
            mixing_strength: 0.5,
            bristle_count: 64,
            bristle_spread: 0.3,
            paint_depletion_rate: 0.1,
            canvas_texture_strength: 0.3,
            medium_type: MediumType::Oil,
            viscosity: 0.7,
        };
        // Serialize without the new fields by using JSON (simulates old format)
        let json = r#"{"paint_load":0.8,"paint_thickness":0.5,"wetness":0.7,"mixing_strength":0.5,"bristle_count":64,"bristle_spread":0.3,"paint_depletion_rate":0.1,"canvas_texture_strength":0.3}"#;
        let decoded: WetMediaBrushSettings = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.medium_type, MediumType::Oil);
        assert!((decoded.viscosity - 0.7).abs() < f32::EPSILON);
        assert_eq!(decoded, old_settings);
    }

    #[test]
    fn test_medium_type_default_is_oil() {
        assert_eq!(MediumType::default(), MediumType::Oil);
    }

    #[test]
    fn test_oil_dries_slower_than_acrylic() {
        let oil = MediumType::Oil.physics();
        let acrylic = MediumType::Acrylic.physics();
        assert!(oil.drying_rate < acrylic.drying_rate);
    }
}
