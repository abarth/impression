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
    /// Bristle stiffness (0.0–1.0). Higher = bristles resist bending.
    #[serde(default = "default_bristle_stiffness")]
    pub bristle_stiffness: f32,
}

fn default_viscosity() -> f32 {
    0.7
}

fn default_bristle_stiffness() -> f32 {
    0.5
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
            bristle_stiffness: 0.5,
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
    pub viscosity: f32,
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
    /// Persistent bristle base offsets (unit-circle positions), initialized at stroke_begin.
    pub bristle_offsets: Vec<(f32, f32)>,
    /// Per-bristle color, starts as paint color, drifts over the stroke.
    pub bristle_colors: Vec<[f32; 3]>,
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
            bristle_offsets: Vec::new(),
            bristle_colors: Vec::new(),
        }
    }
}

/// Initialize persistent bristle base offsets using the PRNG.
/// Each offset is a unit-circle position (r, theta) stored as (x, y) in [-1, 1].
pub fn init_bristle_offsets(count: u32, rng: &mut Rng) -> Vec<(f32, f32)> {
    (0..count)
        .map(|_| {
            let r = rng.next_f32().sqrt();
            let theta = rng.next_f32() * std::f32::consts::TAU;
            (r * theta.cos(), r * theta.sin())
        })
        .collect()
}

/// Generate a bristle footprint mask for the given brush position and settings.
///
/// The mask is a square of side `ceil(size)` pixels, centered at (origin_x, origin_y).
/// Uses persistent bristle offsets for consistent marks within a stroke.
/// Pressure affects splay, velocity affects bend direction.
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
    bristle_offsets: &[(f32, f32)],
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

    // Each bristle is a soft dot placed within the brush ellipse.
    // Size the dots so neighboring bristles overlap, producing a continuous
    // coverage field rather than isolated circles.  The 2.5× multiplier
    // ensures good overlap for typical bristle counts (32–128).
    let bristle_radius = (radius * 2.5 / (bristle_offsets.len() as f32).sqrt()).max(0.5);

    // Pressure splay: bristles spread outward under pressure
    let splay = 1.0 + pressure * settings.bristle_spread * 0.5;

    // Velocity bend: bristles bend in the direction of motion
    let vel_len = (velocity[0] * velocity[0] + velocity[1] * velocity[1]).sqrt();
    let stiffness = settings.bristle_stiffness.max(0.1);
    let bend_amount = if vel_len > 0.01 {
        (vel_len * 0.02 / stiffness).min(0.3)
    } else {
        0.0
    };
    let vel_dir = if vel_len > 0.01 {
        [velocity[0] / vel_len, velocity[1] / vel_len]
    } else {
        [0.0, 0.0]
    };

    for &(base_x, base_y) in bristle_offsets {
        // Apply pressure splay to base offset
        let splayed_x = base_x * splay;
        let splayed_y = base_y * splay;

        // Apply velocity bend (shift bristle in movement direction)
        let bent_x = splayed_x + vel_dir[0] * bend_amount;
        let bent_y = splayed_y + vel_dir[1] * bend_amount;

        // Scale to brush radius with roundness
        let scaled_x = bent_x * (0.5 + 0.5 * settings.bristle_spread) * radius;
        let scaled_y = bent_y * (0.5 + 0.5 * settings.bristle_spread) * radius * brush_roundness;

        // Rotate by brush angle
        let bx = center + scaled_x * cos_a - scaled_y * sin_a;
        let by = center + scaled_x * sin_a + scaled_y * cos_a;

        // Per-bristle pressure variation
        let bristle_pressure = (0.5 + 0.5 * rng.next_f32()) * pressure;

        // Stamp a soft dot at (bx, by)
        let br = bristle_radius;
        let x_min_i = ((bx - br).floor() as i32).max(0);
        let x_max_i = ((bx + br).ceil() as i32).min(footprint_size as i32 - 1);
        let y_min_i = ((by - br).floor() as i32).max(0);
        let y_max_i = ((by + br).ceil() as i32).min(footprint_size as i32 - 1);

        if x_max_i < x_min_i || y_max_i < y_min_i {
            continue;
        }
        let x_min = x_min_i as u32;
        let x_max = x_max_i as u32;
        let y_min = y_min_i as u32;
        let y_max = y_max_i as u32;

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
        viscosity: settings.viscosity,
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

    // Initialize persistent bristle offsets and colors for this stroke
    state.bristle_offsets = init_bristle_offsets(settings.bristle_count, &mut state.rng);
    state.bristle_colors = vec![paint_color; settings.bristle_count as usize];

    let footprint = generate_bristle_footprint(
        x, y, pressure,
        brush_size, brush_angle, brush_roundness,
        settings,
        paint_color,
        state.paint_load_remaining,
        [0.0, 0.0], // no velocity on first stamp
        &state.bristle_offsets,
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

        // Per-bristle color drift: blend each bristle's color toward the paint color
        // weighted by mixing_strength (simulates dirty brush picking up canvas color)
        let drift = settings.mixing_strength * 0.02;
        for color in state.bristle_colors.iter_mut() {
            for c in 0..3 {
                color[c] += (paint_color[c] - color[c]) * drift;
            }
        }

        // Average bristle colors for the footprint's paint color
        let avg_color = average_bristle_colors(&state.bristle_colors);

        let footprint = generate_bristle_footprint(
            px, py, pp,
            brush_size, brush_angle, brush_roundness,
            settings,
            avg_color,
            state.paint_load_remaining,
            velocity,
            &state.bristle_offsets,
            &mut state.rng,
        );
        state.footprints.push(footprint);

        dist += step;
    }

    state.residual_distance = dist - seg_len;
    state.last_point = Some((x, y, pressure));
}

/// Average per-bristle colors into a single paint color.
fn average_bristle_colors(colors: &[[f32; 3]]) -> [f32; 3] {
    if colors.is_empty() {
        return [0.0; 3];
    }
    let n = colors.len() as f32;
    let mut sum = [0.0f32; 3];
    for c in colors {
        sum[0] += c[0];
        sum[1] += c[1];
        sum[2] += c[2];
    }
    [sum[0] / n, sum[1] / n, sum[2] / n]
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
            bristle_stiffness: 0.6,
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

        // Generate identical bristle offsets from identical RNGs
        let offsets1 = init_bristle_offsets(settings.bristle_count, &mut rng1);
        let mut rng1b = Rng::from_coords(10.0, 20.0);
        let offsets2 = init_bristle_offsets(settings.bristle_count, &mut rng1b);

        let fp1 = generate_bristle_footprint(
            50.0, 50.0, 0.8, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.8, [1.0, 0.0], &offsets1, &mut rng1,
        );
        let fp2 = generate_bristle_footprint(
            50.0, 50.0, 0.8, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.8, [1.0, 0.0], &offsets2, &mut rng1b,
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
        let offsets = init_bristle_offsets(32, &mut rng);
        let fp = generate_bristle_footprint(
            25.0, 25.0, 1.0, 30.0, 0.0, 1.0,
            &settings, [0.0, 0.0, 1.0], 1.0, [0.0, 0.0], &offsets, &mut rng,
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
        // Old format without medium_type, viscosity, bristle_stiffness should deserialize with defaults
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
            bristle_stiffness: 0.5,
        };
        // Serialize without the new fields by using JSON (simulates old format)
        let json = r#"{"paint_load":0.8,"paint_thickness":0.5,"wetness":0.7,"mixing_strength":0.5,"bristle_count":64,"bristle_spread":0.3,"paint_depletion_rate":0.1,"canvas_texture_strength":0.3}"#;
        let decoded: WetMediaBrushSettings = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.medium_type, MediumType::Oil);
        assert!((decoded.viscosity - 0.7).abs() < f32::EPSILON);
        assert!((decoded.bristle_stiffness - 0.5).abs() < f32::EPSILON);
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

    #[test]
    fn test_mixbox_red_yellow_makes_orange() {
        let red: [u8; 3] = [255, 0, 0];
        let yellow: [u8; 3] = [255, 255, 0];
        let result = mixbox::lerp(&red, &yellow, 0.5);
        // Should be a saturated orange, not muddy brown
        // Orange: high R, medium G, low B
        assert!(result[0] > 200, "R should be high: {}", result[0]);
        assert!(result[1] > 75 && result[1] < 180, "G should be medium (orange): {}", result[1]);
        assert!(result[2] < 40, "B should be low: {}", result[2]);
    }

    #[test]
    fn test_mixbox_identity() {
        let color: [u8; 3] = [128, 77, 204];
        let result = mixbox::lerp(&color, &color, 0.5);
        for i in 0..3 {
            assert!((result[i] as i16 - color[i] as i16).abs() < 5,
                "Identity mix should return same color: {:?} vs {:?}", result, color);
        }
    }

    #[test]
    fn test_mixbox_blue_yellow_makes_green() {
        let blue: [u8; 3] = [0, 0, 255];
        let yellow: [u8; 3] = [255, 255, 0];
        let result = mixbox::lerp(&blue, &yellow, 0.5);
        // Should be greenish, not grey
        assert!(result[1] > result[0] && result[1] > result[2],
            "Green should dominate: R={} G={} B={}", result[0], result[1], result[2]);
    }

    #[test]
    fn test_bristle_offsets_persist_across_stroke() {
        let settings = WetMediaBrushSettings::default();
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0, 20.0, 0.0, 1.0, 0.25, &settings, color,
        );
        let offsets_after_begin = state.bristle_offsets.clone();
        assert_eq!(offsets_after_begin.len(), settings.bristle_count as usize);

        // Move far enough to generate multiple footprints
        wet_media_stroke_move(
            &mut state, 80.0, 10.0, 0.8, 20.0, 0.0, 1.0, 0.25, &settings, color,
        );

        // Bristle offsets should be identical after stroke_move
        assert_eq!(state.bristle_offsets, offsets_after_begin,
            "Bristle offsets must persist across the stroke");
        assert!(state.footprints.len() > 2, "Should have multiple footprints");
    }

    #[test]
    fn test_high_pressure_spreads_bristles() {
        let settings = WetMediaBrushSettings {
            bristle_spread: 0.8,
            bristle_count: 32,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(1.0, 1.0);
        let offsets = init_bristle_offsets(32, &mut rng);

        // Generate footprints at different pressures using same offsets
        // Use a large brush to avoid edge clipping
        let mut rng_low = Rng::from_coords(99.0, 99.0);
        let fp_low = generate_bristle_footprint(
            50.0, 50.0, 0.2, 60.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, &mut rng_low,
        );
        let mut rng_high = Rng::from_coords(99.0, 99.0);
        let fp_high = generate_bristle_footprint(
            50.0, 50.0, 1.0, 60.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, &mut rng_high,
        );

        // Measure spatial spread: variance of active pixel positions from center
        fn spatial_variance(mask: &[f32], size: u32) -> f32 {
            let center = size as f32 * 0.5;
            let mut sum_dist2 = 0.0f32;
            let mut total_weight = 0.0f32;
            for y in 0..size {
                for x in 0..size {
                    let v = mask[(y * size + x) as usize];
                    if v > 0.0 {
                        let dx = x as f32 + 0.5 - center;
                        let dy = y as f32 + 0.5 - center;
                        sum_dist2 += (dx * dx + dy * dy) * v;
                        total_weight += v;
                    }
                }
            }
            if total_weight > 0.0 { sum_dist2 / total_weight } else { 0.0 }
        }

        let var_low = spatial_variance(&fp_low.mask, fp_low.width);
        let var_high = spatial_variance(&fp_high.mask, fp_high.width);
        assert!(var_high > var_low,
            "High pressure should spread bristles wider: var_high={}, var_low={}",
            var_high, var_low);
    }

    #[test]
    fn test_velocity_bends_bristles() {
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            bristle_stiffness: 0.2, // low stiffness = more bend
            ..Default::default()
        };
        let mut rng = Rng::from_coords(3.0, 3.0);
        let offsets = init_bristle_offsets(16, &mut rng);

        // No velocity
        let fp_still = generate_bristle_footprint(
            50.0, 50.0, 0.5, 30.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, &mut rng,
        );

        // Strong rightward velocity
        let mut rng2 = Rng::from_coords(3.0, 3.0);
        let _ = init_bristle_offsets(16, &mut rng2);
        let fp_moving = generate_bristle_footprint(
            50.0, 50.0, 0.5, 30.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [50.0, 0.0], &offsets, &mut rng2,
        );

        // The masks should differ due to velocity bending
        let diff: f32 = fp_still.mask.iter().zip(fp_moving.mask.iter())
            .map(|(a, b)| (a - b).abs())
            .sum();
        assert!(diff > 0.01, "Velocity should cause bristle bending, diff={}", diff);
    }

    #[test]
    fn test_per_bristle_color_pickup() {
        let settings = WetMediaBrushSettings {
            mixing_strength: 0.8,
            bristle_count: 16,
            paint_depletion_rate: 0.01,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let red = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0, 20.0, 0.0, 1.0, 0.25, &settings, red,
        );

        // All bristle colors should start as paint color
        for c in &state.bristle_colors {
            assert_eq!(*c, red, "Initial bristle color should match paint color");
        }

        // Move with a different paint color to trigger drift
        let blue = [0.0, 0.0, 1.0];
        wet_media_stroke_move(
            &mut state, 100.0, 10.0, 1.0, 20.0, 0.0, 1.0, 0.25, &settings, blue,
        );

        // Bristle colors should have drifted toward blue
        for c in &state.bristle_colors {
            assert!(c[2] > 0.0, "Bristle blue channel should increase: {:?}", c);
            assert!(c[0] < 1.0, "Bristle red channel should decrease: {:?}", c);
        }
    }
}
