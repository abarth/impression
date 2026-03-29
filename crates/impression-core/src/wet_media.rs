use serde::{Deserialize, Serialize};

use crate::color::{rgb_to_hsl, hsl_to_rgb};
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

/// Brush shape determines bristle distribution geometry and stiffness profiles.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum BrushShape {
    /// Circular bristle distribution, stiffer at center.
    Round,
    /// Rectangular bristle grid with uniform stiffness and distinct edge bristles.
    Flat,
    /// Elliptical with rounded ends, graduated stiffness from center to edge.
    Filbert,
    /// Wide arc distribution with sparse, soft bristles.
    Fan,
}

impl Default for BrushShape {
    fn default() -> Self {
        BrushShape::Round
    }
}

/// Per-bristle persistent state that evolves across a stroke.
/// Each bristle independently tracks its paint load, wetness, and physical properties.
#[derive(Clone, Debug)]
pub struct BristleState {
    /// Remaining paint on this individual bristle (0.0–1.0).
    pub paint_load: f32,
    /// Individual bristle stiffness derived from brush shape profile.
    pub stiffness: f32,
    /// Wetness level of this bristle's paint.
    pub wetness: f32,
    /// Relative thickness factor for this bristle (affects dot radius).
    pub thickness: f32,
    /// Radial distance from brush center (0.0=center, 1.0=edge), used for depletion rate.
    pub radial_distance: f32,
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
    /// Brush form (0.0–1.0). Controls how many bristles contact the canvas at
    /// low pressure. At 0.0 all bristles always touch; at 1.0 only central
    /// bristles touch at light pressure and outer bristles activate as pressure
    /// increases.
    #[serde(default = "default_brush_form")]
    pub brush_form: f32,
    /// Per-bristle color noise (0.0–1.0). At stroke start, each bristle gets
    /// a subtle HSL jitter from the paint color. Higher values produce more
    /// visible color variation across the brush.
    #[serde(default)]
    pub color_noise: f32,
    /// Speed-based smudging (0.0–1.0). Fast brush strokes increase mixing
    /// strength, causing more paint smearing. Default 0.3.
    #[serde(default = "default_speed_smudging")]
    pub speed_smudging: f32,
    /// Brush shape (round, flat, filbert, fan). Controls bristle distribution.
    #[serde(default)]
    pub brush_shape: BrushShape,
    /// Paint load threshold below which bristles begin splitting/gapping (0.0–1.0).
    #[serde(default = "default_splitting_threshold")]
    pub splitting_threshold: f32,
}

fn default_speed_smudging() -> f32 {
    0.3
}

fn default_splitting_threshold() -> f32 {
    0.3
}

fn default_viscosity() -> f32 {
    0.7
}

fn default_bristle_stiffness() -> f32 {
    0.5
}

fn default_brush_form() -> f32 {
    0.5
}

impl Default for WetMediaBrushSettings {
    fn default() -> Self {
        Self {
            paint_load: 0.8,
            paint_thickness: 0.5,
            wetness: 0.7,
            mixing_strength: 0.5,
            bristle_count: 256,
            bristle_spread: 0.3,
            paint_depletion_rate: 0.1,
            canvas_texture_strength: 0.3,
            medium_type: MediumType::Oil,
            viscosity: 0.7,
            bristle_stiffness: 0.5,
            brush_form: 0.5,
            color_noise: 0.0,
            speed_smudging: 0.3,
            brush_shape: BrushShape::Round,
            splitting_threshold: 0.3,
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
    /// Opacity multiplier from transfer dynamics (0.0–1.0, default 1.0).
    pub opacity_multiplier: f32,
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
    /// Previous bristle canvas positions for trail-based rendering.
    /// `None` before the first footprint, `Some` after — each entry is one `BristlePosition`.
    pub prev_bristle_positions: Option<Vec<BristlePosition>>,
    /// Per-bristle deformation offsets for elastic recovery.
    /// Spring-based: deformations ease toward target rather than snapping instantly.
    pub bristle_deformations: Vec<(f32, f32)>,
    /// Per-bristle persistent state (paint load, stiffness, wetness).
    pub bristle_states: Vec<BristleState>,
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
            prev_bristle_positions: None,
            bristle_deformations: Vec::new(),
            bristle_states: Vec::new(),
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

/// Initialize bristle positions and per-bristle states based on brush shape.
/// Returns (offsets, states) where offsets are unit-space positions and states
/// contain shape-derived stiffness profiles.
pub fn init_bristle_layout(
    count: u32,
    shape: BrushShape,
    base_stiffness: f32,
    paint_load: f32,
    wetness: f32,
    rng: &mut Rng,
) -> (Vec<(f32, f32)>, Vec<BristleState>) {
    let mut offsets = Vec::with_capacity(count as usize);
    let mut states = Vec::with_capacity(count as usize);

    match shape {
        BrushShape::Round => {
            // Disk distribution: denser at center via sqrt(r) sampling
            for _ in 0..count {
                let r = rng.next_f32().sqrt();
                let theta = rng.next_f32() * std::f32::consts::TAU;
                let x = r * theta.cos();
                let y = r * theta.sin();
                // Stiffer at center, softer at edges
                let stiffness = base_stiffness * (1.0 - 0.4 * r);
                // Outer bristles are slightly thinner
                let thickness = 1.0 - 0.3 * r;
                offsets.push((x, y));
                states.push(BristleState {
                    paint_load,
                    stiffness,
                    wetness,
                    thickness,
                    radial_distance: r,
                });
            }
        }
        BrushShape::Flat => {
            // Rectangular grid: rows × cols arranged in a flat band
            let cols = (count as f32).sqrt().ceil() as u32;
            let rows = ((count as f32) / cols as f32).ceil() as u32;
            let mut generated = 0u32;
            for row in 0..rows {
                for col in 0..cols {
                    if generated >= count { break; }
                    // Map to [-1, 1] range
                    let x = if cols > 1 { (col as f32 / (cols - 1).max(1) as f32) * 2.0 - 1.0 } else { 0.0 };
                    let y = if rows > 1 { (row as f32 / (rows - 1).max(1) as f32) * 2.0 - 1.0 } else { 0.0 };
                    // Flatten the y axis (narrow band)
                    let y = y * 0.25;
                    // Add small random jitter
                    let jx = x + (rng.next_f32() - 0.5) * 0.05;
                    let jy = y + (rng.next_f32() - 0.5) * 0.03;
                    let r = (jx * jx + jy * jy).sqrt().min(1.0);
                    // Edge bristles are stiffer
                    let is_edge = col == 0 || col == cols - 1;
                    let stiffness = if is_edge {
                        base_stiffness * 1.2
                    } else {
                        base_stiffness
                    };
                    offsets.push((jx.clamp(-1.0, 1.0), jy.clamp(-1.0, 1.0)));
                    states.push(BristleState {
                        paint_load,
                        stiffness: stiffness.min(1.0),
                        wetness,
                        thickness: 1.0,
                        radial_distance: r,
                    });
                    generated += 1;
                }
            }
        }
        BrushShape::Filbert => {
            // Elliptical distribution with rounded ends
            for _ in 0..count {
                let r = rng.next_f32().sqrt();
                let theta = rng.next_f32() * std::f32::consts::TAU;
                let x = r * theta.cos();
                // Compress Y for elliptical shape
                let y = r * theta.sin() * 0.5;
                // Graduated stiffness: center stiff, edges soft
                let stiffness = base_stiffness * (1.0 - 0.5 * r);
                let thickness = 1.0 - 0.2 * r;
                offsets.push((x, y));
                states.push(BristleState {
                    paint_load,
                    stiffness,
                    wetness,
                    thickness,
                    radial_distance: r,
                });
            }
        }
        BrushShape::Fan => {
            // Wide arc with sparse, soft bristles
            for i in 0..count {
                let t = if count > 1 { i as f32 / (count - 1) as f32 } else { 0.5 };
                // Fan arc from -120° to +120°
                let angle = (t - 0.5) * std::f32::consts::TAU * 0.67;
                let r = 0.6 + rng.next_f32() * 0.4; // outer ring
                let x = r * angle.cos();
                let y = r * angle.sin();
                // Fan bristles are uniformly soft
                let stiffness = base_stiffness * 0.5;
                offsets.push((x, y));
                states.push(BristleState {
                    paint_load,
                    stiffness,
                    wetness,
                    thickness: 0.8,
                    radial_distance: r.min(1.0),
                });
            }
        }
    }
    (offsets, states)
}

/// A single bristle's computed canvas position and pressure.
#[derive(Clone, Debug)]
pub struct BristlePosition {
    pub canvas_x: f32,
    pub canvas_y: f32,
    pub pressure: f32,
}

/// Compute absolute canvas positions for all bristles given brush parameters.
///
/// Returns one `BristlePosition` per bristle offset, with canvas-space coordinates
/// (not mask-space). The RNG is advanced once per bristle for per-bristle pressure variation.
fn compute_bristle_canvas_positions(
    origin_x: f32,
    origin_y: f32,
    pressure: f32,
    brush_size: f32,
    brush_angle: f32,
    brush_roundness: f32,
    settings: &WetMediaBrushSettings,
    velocity: [f32; 2],
    bristle_offsets: &[(f32, f32)],
    deformations: &mut [(f32, f32)],
    bristle_states: &[BristleState],
    splitting_threshold: f32,
    rng: &mut Rng,
) -> Vec<BristlePosition> {
    let radius = brush_size * 0.5;
    let angle_rad = brush_angle.to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    // Pressure splay: bristles spread outward under pressure
    let splay = 1.0 + pressure * settings.bristle_spread * 0.5;

    // Velocity bend: bristles bend in the direction of motion
    let vel_len = (velocity[0] * velocity[0] + velocity[1] * velocity[1]).sqrt();
    let base_stiffness = settings.bristle_stiffness.max(0.1);
    let vel_dir = if vel_len > 0.01 {
        [velocity[0] / vel_len, velocity[1] / vel_len]
    } else {
        [0.0, 0.0]
    };

    // Spring rate inversely correlated with stiffness:
    // Stiff brushes (stiffness=1.0) → spring_rate=0.6 (snaps back fast)
    // Soft brushes (stiffness=0.1) → spring_rate=0.15 (lags behind)
    let spring_rate = 0.1 + 0.5 * base_stiffness;

    bristle_offsets
        .iter()
        .enumerate()
        .map(|(i, &(base_x, base_y))| {
            // Use per-bristle stiffness instead of uniform
            let stiffness = if let Some(bs) = bristle_states.get(i) {
                bs.stiffness.max(0.1)
            } else {
                base_stiffness
            };

            let bend_amount = if vel_len > 0.01 {
                (vel_len * 0.06 / stiffness).min(0.5)
            } else {
                0.0
            };

            // Target deformation from splay + velocity bend
            let target_x = base_x * splay + vel_dir[0] * bend_amount;
            let target_y = base_y * splay + vel_dir[1] * bend_amount;

            // Elastic recovery: spring toward target instead of snapping
            let (effective_x, effective_y) = if let Some(deform) = deformations.get_mut(i) {
                let target_dx = target_x - base_x;
                let target_dy = target_y - base_y;
                deform.0 += (target_dx - deform.0) * spring_rate;
                deform.1 += (target_dy - deform.1) * spring_rate;
                (base_x + deform.0, base_y + deform.1)
            } else {
                (target_x, target_y)
            };

            // Scale to brush radius with roundness
            let scaled_x = effective_x * (0.5 + 0.5 * settings.bristle_spread) * radius;
            let scaled_y =
                effective_y * (0.5 + 0.5 * settings.bristle_spread) * radius * brush_roundness;

            // Rotate by brush angle, position relative to brush center in canvas space
            let cx = origin_x + scaled_x * cos_a - scaled_y * sin_a;
            let cy = origin_y + scaled_x * sin_a + scaled_y * cos_a;

            // Per-bristle pressure variation
            let mut bp = (0.5 + 0.5 * rng.next_f32()) * pressure;

            // Brush form: at low pressure, only central bristles contact canvas.
            // Use elliptical distance so flat brushes (roundness < 1) deactivate
            // bristles along the narrow axis first, matching real brush behavior.
            let ry = if brush_roundness > 0.01 { 1.0 / brush_roundness } else { 100.0 };
            let dist_from_center = (base_x * base_x + (base_y * ry) * (base_y * ry)).sqrt();
            let activation_threshold = 1.0 - settings.brush_form * (1.0 - pressure);
            // Smooth falloff instead of hard cutoff
            let edge_width = 0.15;
            if dist_from_center > activation_threshold - edge_width {
                let fade = 1.0 - ((dist_from_center - (activation_threshold - edge_width)) / (edge_width * 2.0)).clamp(0.0, 1.0);
                // Smoothstep curve for natural transition
                let fade = fade * fade * (3.0 - 2.0 * fade);
                bp *= fade;
            }

            // Bristle splitting: at low paint load, bristles gap out
            if let Some(bs) = bristle_states.get(i) {
                if bs.paint_load < splitting_threshold {
                    let split_factor = bs.paint_load / splitting_threshold.max(0.01);
                    bp *= split_factor;
                    // At very low paint load, outer bristles deactivate with natural pattern
                    if bs.paint_load < splitting_threshold * 0.3 && bs.radial_distance > 0.5 {
                        // Hash-based pseudo-random for natural splitting pattern
                        let hash = ((i as u32).wrapping_mul(2654435761)) >> 16;
                        if hash & 1 == 0 {
                            bp = 0.0;
                        }
                    }
                }
                // Wetter bristles deposit more readily
                bp *= 0.5 + 0.5 * bs.wetness;
                // Modulate by bristle thickness
                bp *= bs.thickness;
            }

            BristlePosition {
                canvas_x: cx,
                canvas_y: cy,
                pressure: bp,
            }
        })
        .collect()
}

/// Compute the bristle dot radius for a given brush size and bristle count.
fn bristle_dot_radius(brush_size: f32, bristle_count: usize) -> f32 {
    let radius = brush_size * 0.5;
    (radius * 2.5 / (bristle_count as f32).sqrt()).max(0.5)
}

/// Stamp a soft dot into the mask at the given mask-space position.
fn stamp_bristle_dot(
    mask: &mut [f32],
    mask_width: u32,
    mask_height: u32,
    bx: f32,
    by: f32,
    bristle_radius: f32,
    bristle_pressure: f32,
) {
    let br = bristle_radius;
    let x_min_i = ((bx - br).floor() as i32).max(0);
    let x_max_i = ((bx + br).ceil() as i32).min(mask_width as i32 - 1);
    let y_min_i = ((by - br).floor() as i32).max(0);
    let y_max_i = ((by + br).ceil() as i32).min(mask_height as i32 - 1);

    if x_max_i < x_min_i || y_max_i < y_min_i {
        return;
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
                let idx = (py * mask_width + px) as usize;
                // Accumulate (max blend so bristles don't over-brighten)
                mask[idx] = mask[idx].max(alpha);
            }
        }
    }
}

/// Compute the shortest distance from point (px, py) to the line segment (ax, ay)→(bx, by).
///
/// Returns `(distance, t)` where `t` in [0, 1] is the projection parameter along the segment.
/// When `t == 0` the closest point is at `a`, when `t == 1` it's at `b`.
fn distance_to_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> (f32, f32) {
    let dx = bx - ax;
    let dy = by - ay;
    let len_sq = dx * dx + dy * dy;
    let t = if len_sq < 1e-12 {
        0.0
    } else {
        ((px - ax) * dx + (py - ay) * dy) / len_sq
    }
    .clamp(0.0, 1.0);
    let proj_x = ax + t * dx;
    let proj_y = ay + t * dy;
    let d = ((px - proj_x).powi(2) + (py - proj_y).powi(2)).sqrt();
    (d, t)
}

/// Rasterize a capsule (line segment with hemispherical end caps) into a mask buffer.
///
/// Endpoints `p0` and `p1` are in **mask space** (i.e., relative to the mask's top-left corner).
/// `radius` is the capsule half-width. Pressure is linearly interpolated from `pressure_start`
/// (at `p0`) to `pressure_end` (at `p1`). Uses smoothstep falloff and max-blend accumulation.
fn rasterize_capsule(
    mask: &mut [f32],
    mask_width: u32,
    mask_height: u32,
    p0: (f32, f32),
    p1: (f32, f32),
    radius: f32,
    pressure_start: f32,
    pressure_end: f32,
) {
    // Bounding box of the capsule within the mask
    let min_x = p0.0.min(p1.0) - radius;
    let max_x = p0.0.max(p1.0) + radius;
    let min_y = p0.1.min(p1.1) - radius;
    let max_y = p0.1.max(p1.1) + radius;

    let x_start = (min_x.floor() as i32).max(0) as u32;
    let x_end = ((max_x.ceil() as i32).min(mask_width as i32 - 1)).max(0) as u32;
    let y_start = (min_y.floor() as i32).max(0) as u32;
    let y_end = ((max_y.ceil() as i32).min(mask_height as i32 - 1)).max(0) as u32;

    for py in y_start..=y_end {
        for px in x_start..=x_end {
            let cx = px as f32 + 0.5;
            let cy = py as f32 + 0.5;
            let (dist, t) = distance_to_segment(cx, cy, p0.0, p0.1, p1.0, p1.1);
            if dist <= radius {
                let pressure = pressure_start + t * (pressure_end - pressure_start);
                let s = (1.0 - dist / radius).clamp(0.0, 1.0);
                let alpha = s * s * (3.0 - 2.0 * s) * pressure;
                let idx = (py * mask_width + px) as usize;
                mask[idx] = mask[idx].max(alpha);
            }
        }
    }
}

/// Maximum mask dimension to prevent pathological allocations with fast strokes.
const MAX_MASK_DIM: u32 = 512;

/// Generate a bristle footprint mask for the given brush position and settings.
///
/// When `prev_positions` is `None` (first dab), uses dot-stamp rasterization with a
/// fixed-size mask centered at (origin_x, origin_y).
///
/// When `prev_positions` is `Some`, uses trail-based capsule rasterization: each bristle
/// traces a line from its previous canvas position to its current one, producing smooth
/// continuous coverage. The mask is sized to the bounding box of all bristle movements.
///
/// Returns the footprint and the current bristle positions (to be stored for the next call).
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
    prev_positions: Option<&[BristlePosition]>,
    deformations: &mut [(f32, f32)],
    bristle_states: &[BristleState],
    splitting_threshold: f32,
    rng: &mut Rng,
) -> (BristleFootprint, Vec<BristlePosition>) {
    let br = bristle_dot_radius(brush_size, bristle_offsets.len());

    // Compute current canvas positions for all bristles
    let positions = compute_bristle_canvas_positions(
        origin_x, origin_y, pressure, brush_size, brush_angle, brush_roundness,
        settings, velocity, bristle_offsets, deformations, bristle_states, splitting_threshold, rng,
    );

    let (mask, mask_w, mask_h, mask_origin_x, mask_origin_y) = match prev_positions {
        None => {
            // First dab: fixed-size square mask centered at origin, dot-stamp rasterization
            let footprint_size = (brush_size.ceil() as u32).max(1);
            let mask_len = (footprint_size * footprint_size) as usize;
            let mut mask = vec![0.0f32; mask_len];
            let center = footprint_size as f32 * 0.5;

            for pos in &positions {
                let mx = pos.canvas_x - origin_x + center;
                let my = pos.canvas_y - origin_y + center;
                stamp_bristle_dot(
                    &mut mask, footprint_size, footprint_size, mx, my, br, pos.pressure,
                );
            }
            (mask, footprint_size, footprint_size, origin_x, origin_y)
        }
        Some(prev) => {
            // Trail mode: compute bounding box over all bristle movements + radius padding
            let mut min_x = f32::MAX;
            let mut min_y = f32::MAX;
            let mut max_x = f32::MIN;
            let mut max_y = f32::MIN;

            for (curr, prev_pos) in positions.iter().zip(prev.iter()) {
                min_x = min_x.min(curr.canvas_x).min(prev_pos.canvas_x);
                min_y = min_y.min(curr.canvas_y).min(prev_pos.canvas_y);
                max_x = max_x.max(curr.canvas_x).max(prev_pos.canvas_x);
                max_y = max_y.max(curr.canvas_y).max(prev_pos.canvas_y);
            }

            // Pad by bristle radius + 1 pixel safety margin
            let pad = br + 1.0;
            min_x -= pad;
            min_y -= pad;
            max_x += pad;
            max_y += pad;

            let mask_w = ((max_x - min_x).ceil() as u32).max(1).min(MAX_MASK_DIM);
            let mask_h = ((max_y - min_y).ceil() as u32).max(1).min(MAX_MASK_DIM);
            let mask_len = (mask_w * mask_h) as usize;
            let mut mask = vec![0.0f32; mask_len];

            // The mask top-left corner in canvas space
            let tl_x = min_x;
            let tl_y = min_y;

            for (curr, prev_pos) in positions.iter().zip(prev.iter()) {
                // Convert canvas coords to mask space
                let p0 = (prev_pos.canvas_x - tl_x, prev_pos.canvas_y - tl_y);
                let p1 = (curr.canvas_x - tl_x, curr.canvas_y - tl_y);
                rasterize_capsule(
                    &mut mask, mask_w, mask_h,
                    p0, p1, br,
                    prev_pos.pressure, curr.pressure,
                );
            }

            // Origin = center of the bounding box (shader interprets origin as mask center)
            let center_x = min_x + mask_w as f32 * 0.5;
            let center_y = min_y + mask_h as f32 * 0.5;
            (mask, mask_w, mask_h, center_x, center_y)
        }
    };

    let footprint = BristleFootprint {
        mask,
        width: mask_w,
        height: mask_h,
        origin_x: mask_origin_x,
        origin_y: mask_origin_y,
        paint_color,
        paint_load,
        velocity,
        mixing_strength: settings.mixing_strength,
        paint_thickness: settings.paint_thickness * pressure,
        wetness: settings.wetness,
        canvas_texture_strength: settings.canvas_texture_strength,
        viscosity: settings.viscosity,
        opacity_multiplier: 1.0,
    };

    (footprint, positions)
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

    // Initialize persistent bristle offsets, colors, and deformations for this stroke
    let (offsets, bristle_st) = init_bristle_layout(
        settings.bristle_count,
        settings.brush_shape,
        settings.bristle_stiffness,
        settings.paint_load,
        settings.wetness,
        &mut state.rng,
    );
    state.bristle_offsets = offsets;
    state.bristle_states = bristle_st;
    state.bristle_colors = vec![paint_color; settings.bristle_count as usize];
    state.bristle_deformations = vec![(0.0, 0.0); settings.bristle_count as usize];

    // Apply per-bristle color noise via HSL jitter (after init_bristle_layout
    // so existing RNG sequences are preserved for strokes with zero noise)
    if settings.color_noise > 0.0 {
        let (h, s, l) = rgb_to_hsl(paint_color[0], paint_color[1], paint_color[2]);
        for color in state.bristle_colors.iter_mut() {
            let h2 = h + (state.rng.next_f32() - 0.5) * settings.color_noise * 30.0;
            let s2 = (s + (state.rng.next_f32() - 0.5) * settings.color_noise * 0.15).clamp(0.0, 1.0);
            let l2 = (l + (state.rng.next_f32() - 0.5) * settings.color_noise * 0.1).clamp(0.0, 1.0);
            *color = hsl_to_rgb(h2, s2, l2);
        }
    }

    let (footprint, curr_positions) = generate_bristle_footprint(
        x, y, pressure,
        brush_size, brush_angle, brush_roundness,
        settings,
        paint_color,
        state.paint_load_remaining,
        [0.0, 0.0], // no velocity on first stamp
        &state.bristle_offsets,
        None, // first dab — no previous positions
        &mut state.bristle_deformations,
        &state.bristle_states,
        settings.splitting_threshold,
        &mut state.rng,
    );
    state.footprints.push(footprint);
    state.prev_bristle_positions = Some(curr_positions);

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

        // Per-bristle paint depletion: outer bristles deplete faster
        for bs in state.bristle_states.iter_mut() {
            let depletion_mult = 1.0 + 0.4 * bs.radial_distance; // outer = 1.4x faster
            bs.paint_load = (bs.paint_load - settings.paint_depletion_rate * step / brush_size * depletion_mult).max(0.0);
            // Wetness decreases as paint depletes
            let load_ratio = (bs.paint_load / settings.paint_load.max(0.01)).clamp(0.0, 1.0);
            bs.wetness = settings.wetness * load_ratio.max(0.1);
        }

        // Global paint load = average of per-bristle loads (for footprint params)
        state.paint_load_remaining = if state.bristle_states.is_empty() {
            (state.paint_load_remaining - settings.paint_depletion_rate * step / brush_size)
                .max(0.0)
        } else {
            state.bristle_states.iter().map(|bs| bs.paint_load).sum::<f32>() / state.bristle_states.len() as f32
        };

        // Paint-to-blend transition: as paint depletes, brush becomes a blender
        let load_ratio = (state.paint_load_remaining / settings.paint_load.max(0.01)).clamp(0.0, 1.0);
        let depletion_ratio = 1.0 - load_ratio;
        // As paint depletes: mixing increases (brush transitions to smudging)
        let mut effective_mixing = (settings.mixing_strength
            + (1.0 - settings.mixing_strength) * depletion_ratio * 0.8)
            .min(1.0);
        // Speed-based smudging: fast strokes increase mixing
        let vel_mag = (velocity[0] * velocity[0] + velocity[1] * velocity[1]).sqrt();
        let speed_factor = (vel_mag / brush_size).min(2.0);
        effective_mixing = (effective_mixing + settings.speed_smudging * speed_factor * 0.3).min(1.0);
        // As paint depletes: wetness fades (stroke dries out)
        let effective_wetness = settings.wetness * load_ratio.max(0.1);

        // Per-bristle color drift: blend each bristle's color toward the paint color
        // weighted by mixing_strength (simulates dirty brush picking up canvas color)
        let drift = settings.mixing_strength * 0.02;
        for color in state.bristle_colors.iter_mut() {
            for c in 0..3 {
                color[c] += (paint_color[c] - color[c]) * drift;
            }
        }

        // Simulated canvas color pickup: as paint depletes, bristles pick up
        // diverse colors from the canvas surface, causing per-bristle variation
        let pickup_strength = depletion_ratio * 0.05;
        if pickup_strength > 0.001 {
            for color in state.bristle_colors.iter_mut() {
                for c in 0..3 {
                    color[c] += (state.rng.next_f32() - 0.5) * pickup_strength;
                    color[c] = color[c].clamp(0.0, 1.0);
                }
            }
        }

        // Average bristle colors for the footprint's paint color
        let avg_color = average_bristle_colors(&state.bristle_colors);

        let (mut footprint, curr_positions) = generate_bristle_footprint(
            px, py, pp,
            brush_size, brush_angle, brush_roundness,
            settings,
            avg_color,
            state.paint_load_remaining,
            velocity,
            &state.bristle_offsets,
            state.prev_bristle_positions.as_deref(),
            &mut state.bristle_deformations,
            &state.bristle_states,
            settings.splitting_threshold,
            &mut state.rng,
        );
        // Apply paint-to-blend effective values
        footprint.mixing_strength = effective_mixing;
        footprint.wetness = effective_wetness;
        state.footprints.push(footprint);
        state.prev_bristle_positions = Some(curr_positions);

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
    state.prev_bristle_positions = None;
    state.bristle_deformations.clear();
    state.bristle_states.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_distance_to_segment_at_start() {
        let (d, t) = distance_to_segment(0.0, 0.0, 0.0, 0.0, 10.0, 0.0);
        assert!(d.abs() < 1e-5, "Point on segment start: dist={}", d);
        assert!(t.abs() < 1e-5, "t should be 0 at start: t={}", t);
    }

    #[test]
    fn test_distance_to_segment_at_end() {
        let (d, t) = distance_to_segment(10.0, 0.0, 0.0, 0.0, 10.0, 0.0);
        assert!(d.abs() < 1e-5);
        assert!((t - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_distance_to_segment_perpendicular() {
        let (d, t) = distance_to_segment(5.0, 3.0, 0.0, 0.0, 10.0, 0.0);
        assert!((d - 3.0).abs() < 1e-5, "Perpendicular distance: d={}", d);
        assert!((t - 0.5).abs() < 1e-5, "Midpoint projection: t={}", t);
    }

    #[test]
    fn test_distance_to_segment_beyond_end() {
        // Point past the end of the segment — should clamp to endpoint
        let (d, _t) = distance_to_segment(15.0, 0.0, 0.0, 0.0, 10.0, 0.0);
        assert!((d - 5.0).abs() < 1e-5, "Beyond end: dist={}", d);
    }

    #[test]
    fn test_distance_to_segment_degenerate() {
        // Zero-length segment
        let (d, t) = distance_to_segment(3.0, 4.0, 0.0, 0.0, 0.0, 0.0);
        assert!((d - 5.0).abs() < 1e-5, "Distance to point: d={}", d);
        assert!(t.abs() < 1e-5, "t for degenerate: t={}", t);
    }

    #[test]
    fn test_rasterize_capsule_horizontal() {
        let w = 20u32;
        let h = 10u32;
        let mut mask = vec![0.0f32; (w * h) as usize];
        rasterize_capsule(
            &mut mask, w, h,
            (2.0, 5.0), (18.0, 5.0),
            2.0, 1.0, 1.0,
        );
        // Center row (y=4 or y=5) should have non-zero values along the segment
        let center_row = 5;
        let active: Vec<u32> = (0..w)
            .filter(|&x| mask[(center_row * w + x) as usize] > 0.0)
            .collect();
        assert!(!active.is_empty(), "Capsule should have non-zero pixels along center");
        assert!(active.len() >= 14, "Should span most of the segment: got {}", active.len());
    }

    #[test]
    fn test_rasterize_capsule_pressure_interpolation() {
        let w = 30u32;
        let h = 5u32;
        let mut mask = vec![0.0f32; (w * h) as usize];
        // Horizontal capsule: pressure 1.0 at left, 0.0 at right
        rasterize_capsule(
            &mut mask, w, h,
            (2.0, 2.5), (28.0, 2.5),
            1.5, 1.0, 0.0,
        );
        let row = 2;
        let left_val = mask[(row * w + 3) as usize];
        let right_val = mask[(row * w + 27) as usize];
        assert!(left_val > right_val,
            "Left should be brighter than right: left={}, right={}", left_val, right_val);
    }

    #[test]
    fn test_rasterize_capsule_zero_length() {
        // Degenerate capsule (point) should produce a dot
        let w = 10u32;
        let h = 10u32;
        let mut mask = vec![0.0f32; (w * h) as usize];
        rasterize_capsule(
            &mut mask, w, h,
            (5.0, 5.0), (5.0, 5.0),
            2.0, 0.8, 0.8,
        );
        let nonzero = mask.iter().filter(|&&v| v > 0.0).count();
        assert!(nonzero > 0, "Degenerate capsule should produce a dot");
    }

    #[test]
    fn test_default_wet_media_settings() {
        let settings = WetMediaBrushSettings::default();
        assert!((settings.paint_load - 0.8).abs() < f32::EPSILON);
        assert!((settings.wetness - 0.7).abs() < f32::EPSILON);
        assert_eq!(settings.bristle_count, 256);
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
            brush_form: 0.5,
            color_noise: 0.0,
            speed_smudging: 0.3,
            brush_shape: BrushShape::Round,
            splitting_threshold: 0.3,
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
        let _rng2 = Rng::from_coords(10.0, 20.0);

        // Generate identical bristle offsets from identical RNGs
        let offsets1 = init_bristle_offsets(settings.bristle_count, &mut rng1);
        let mut rng1b = Rng::from_coords(10.0, 20.0);
        let offsets2 = init_bristle_offsets(settings.bristle_count, &mut rng1b);

        let (fp1, _) = generate_bristle_footprint(
            50.0, 50.0, 0.8, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.8, [1.0, 0.0], &offsets1, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng1,
        );
        let (fp2, _) = generate_bristle_footprint(
            50.0, 50.0, 0.8, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.8, [1.0, 0.0], &offsets2, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng1b,
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
        let (fp, _) = generate_bristle_footprint(
            25.0, 25.0, 1.0, 30.0, 0.0, 1.0,
            &settings, [0.0, 0.0, 1.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
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
        // Old format without medium_type, viscosity, bristle_stiffness, brush_form should deserialize with defaults
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
            brush_form: 0.5,
            color_noise: 0.0,
            speed_smudging: 0.3,
            brush_shape: BrushShape::Round,
            splitting_threshold: 0.3,
        };
        // Serialize without the new fields by using JSON (simulates old format)
        let json = r#"{"paint_load":0.8,"paint_thickness":0.5,"wetness":0.7,"mixing_strength":0.5,"bristle_count":64,"bristle_spread":0.3,"paint_depletion_rate":0.1,"canvas_texture_strength":0.3}"#;
        let decoded: WetMediaBrushSettings = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.medium_type, MediumType::Oil);
        assert!((decoded.viscosity - 0.7).abs() < f32::EPSILON);
        assert!((decoded.bristle_stiffness - 0.5).abs() < f32::EPSILON);
        assert!((decoded.brush_form - 0.5).abs() < f32::EPSILON);
        assert!((decoded.color_noise - 0.0).abs() < f32::EPSILON);
        assert!((decoded.speed_smudging - 0.3).abs() < f32::EPSILON);
        assert_eq!(decoded.brush_shape, BrushShape::Round);
        assert!((decoded.splitting_threshold - 0.3).abs() < f32::EPSILON);
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
        let (fp_low, _) = generate_bristle_footprint(
            50.0, 50.0, 0.2, 60.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng_low,
        );
        let mut rng_high = Rng::from_coords(99.0, 99.0);
        let (fp_high, _) = generate_bristle_footprint(
            50.0, 50.0, 1.0, 60.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng_high,
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
        let (fp_still, _) = generate_bristle_footprint(
            50.0, 50.0, 0.5, 30.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        // Strong rightward velocity
        let mut rng2 = Rng::from_coords(3.0, 3.0);
        let _ = init_bristle_offsets(16, &mut rng2);
        let (fp_moving, _) = generate_bristle_footprint(
            50.0, 50.0, 0.5, 30.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [50.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng2,
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

    // -- Trail rendering tests --

    #[test]
    fn test_trail_footprint_uses_capsule_rasterization() {
        // Second footprint should use trails (capsules), not dots
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(1.0, 1.0);
        let offsets = init_bristle_offsets(16, &mut rng);

        // First dab — no previous positions
        let (fp1, prev) = generate_bristle_footprint(
            50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [5.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        // Second footprint — with previous positions (trail mode)
        let (fp2, _) = generate_bristle_footprint(
            55.0, 50.0, 1.0, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [5.0, 0.0], &offsets, Some(&prev), &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        // Trail mask can have different dimensions from first dab
        let nonzero1 = fp1.mask.iter().filter(|&&v| v > 0.0).count();
        let nonzero2 = fp2.mask.iter().filter(|&&v| v > 0.0).count();
        assert!(nonzero1 > 0, "First dab should have nonzero pixels");
        assert!(nonzero2 > 0, "Trail footprint should have nonzero pixels");
    }

    #[test]
    fn test_trail_covers_movement_area() {
        // A trail footprint should cover the area between prev and curr positions
        let settings = WetMediaBrushSettings {
            bristle_count: 4,
            bristle_spread: 0.0, // tight bristles for predictable positions
            ..Default::default()
        };
        let mut rng = Rng::from_coords(2.0, 2.0);
        let offsets = init_bristle_offsets(4, &mut rng);

        let (_, prev) = generate_bristle_footprint(
            50.0, 50.0, 1.0, 10.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        // Move significantly to the right
        let (fp, _) = generate_bristle_footprint(
            60.0, 50.0, 1.0, 10.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [10.0, 0.0], &offsets, Some(&prev), &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        // The mask should be wider than the brush size since it covers movement
        assert!(fp.width > 10 || fp.height > 0, "Trail mask should cover movement area");
        let nonzero = fp.mask.iter().filter(|&&v| v > 0.0).count();
        assert!(nonzero > 0, "Trail should have painted pixels");
    }

    #[test]
    fn test_trail_determinism() {
        // Two identical sequences should produce identical trail footprints
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            ..Default::default()
        };

        let gen_sequence = || {
            let mut rng = Rng::from_coords(7.0, 7.0);
            let offsets = init_bristle_offsets(16, &mut rng);
            let (_, prev) = generate_bristle_footprint(
                50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
                &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
            );
            let (fp, _) = generate_bristle_footprint(
                55.0, 52.0, 0.8, 20.0, 0.0, 1.0,
                &settings, [1.0, 0.0, 0.0], 0.9, [5.0, 2.0], &offsets, Some(&prev), &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
            );
            fp
        };

        let fp_a = gen_sequence();
        let fp_b = gen_sequence();
        assert_eq!(fp_a.width, fp_b.width);
        assert_eq!(fp_a.height, fp_b.height);
        assert_eq!(fp_a.mask.len(), fp_b.mask.len());
        for (a, b) in fp_a.mask.iter().zip(fp_b.mask.iter()) {
            assert!((a - b).abs() < f32::EPSILON, "Trail footprints must be deterministic");
        }
    }

    #[test]
    fn test_trail_bbox_contains_all_marks() {
        // No non-zero mask values should appear at the boundary edges
        // (which would indicate clipping)
        let settings = WetMediaBrushSettings {
            bristle_count: 32,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(4.0, 4.0);
        let offsets = init_bristle_offsets(32, &mut rng);

        let (_, prev) = generate_bristle_footprint(
            50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 1.0, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        let (fp, _) = generate_bristle_footprint(
            55.0, 52.0, 0.9, 20.0, 0.0, 1.0,
            &settings, [1.0, 0.0, 0.0], 0.9, [5.0, 2.0], &offsets, Some(&prev), &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        let w = fp.width as usize;
        let h = fp.height as usize;
        // Check top and bottom edges
        let top_edge: f32 = (0..w).map(|x| fp.mask[x]).sum();
        let bot_edge: f32 = (0..w).map(|x| fp.mask[(h - 1) * w + x]).sum();
        // Check left and right edges
        let left_edge: f32 = (0..h).map(|y| fp.mask[y * w]).sum();
        let right_edge: f32 = (0..h).map(|y| fp.mask[y * w + w - 1]).sum();

        // At least one edge should be mostly empty (padded beyond bristle marks)
        let total_edge = top_edge + bot_edge + left_edge + right_edge;
        let total_mask: f32 = fp.mask.iter().sum();
        assert!(
            total_edge < total_mask * 0.2,
            "Edge values should be small relative to total: edge={}, total={}",
            total_edge, total_mask
        );
    }

    #[test]
    fn test_stroke_uses_trails_after_first_dab() {
        // A full stroke should populate prev_bristle_positions
        let settings = WetMediaBrushSettings {
            bristle_count: 8,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0, 20.0, 0.0, 1.0, 0.12, &settings, color,
        );
        assert!(state.prev_bristle_positions.is_some(), "Should have prev positions after begin");

        wet_media_stroke_move(
            &mut state, 50.0, 10.0, 0.8, 20.0, 0.0, 1.0, 0.12, &settings, color,
        );
        assert!(state.prev_bristle_positions.is_some(), "Should still have prev positions after move");
        assert!(state.footprints.len() > 1, "Should have generated multiple footprints");

        wet_media_stroke_end(&mut state);
        assert!(state.prev_bristle_positions.is_none(), "Should clear prev positions on end");
    }

    #[test]
    fn test_trail_pressure_taper() {
        // With decreasing pressure along the trail, later marks should be fainter
        let settings = WetMediaBrushSettings {
            bristle_count: 4,
            bristle_spread: 0.0,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        // Start with full pressure
        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0, 20.0, 0.0, 1.0, 0.15, &settings, color,
        );
        let first_mask_sum: f32 = state.footprints[0].mask.iter().sum();

        // Move with very low pressure
        state.footprints.clear();
        wet_media_stroke_move(
            &mut state, 60.0, 10.0, 0.1, 20.0, 0.0, 1.0, 0.15, &settings, color,
        );

        if let Some(last) = state.footprints.last() {
            let last_mask_sum: f32 = last.mask.iter().sum();
            assert!(
                last_mask_sum < first_mask_sum,
                "Low-pressure trail should be fainter: first={}, last={}",
                first_mask_sum, last_mask_sum
            );
        }
    }

    #[test]
    fn test_paint_to_blend_transition_mixing_increases() {
        let settings = WetMediaBrushSettings {
            paint_load: 0.5,
            paint_depletion_rate: 0.5, // fast depletion
            mixing_strength: 0.3,
            wetness: 0.7,
            bristle_count: 8,
            bristle_spread: 0.1,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        let initial_mixing = state.footprints.last().unwrap().mixing_strength;

        // Move many times to deplete paint
        for i in 1..=30 {
            state.footprints.clear();
            wet_media_stroke_move(
                &mut state, 10.0 + i as f32 * 3.0, 10.0, 1.0,
                20.0, 0.0, 1.0, 0.12,
                &settings, color,
            );
        }

        let final_mixing = state.footprints.last().unwrap().mixing_strength;
        assert!(
            final_mixing > initial_mixing,
            "Mixing should increase as paint depletes: initial={}, final={}",
            initial_mixing, final_mixing
        );
    }

    #[test]
    fn test_paint_to_blend_transition_wetness_decreases() {
        let settings = WetMediaBrushSettings {
            paint_load: 0.5,
            paint_depletion_rate: 0.5,
            mixing_strength: 0.3,
            wetness: 0.7,
            bristle_count: 8,
            bristle_spread: 0.1,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        // stroke_begin uses raw settings, so wetness should equal settings.wetness
        let initial_wetness = state.footprints.last().unwrap().wetness;

        for i in 1..=30 {
            state.footprints.clear();
            wet_media_stroke_move(
                &mut state, 10.0 + i as f32 * 3.0, 10.0, 1.0,
                20.0, 0.0, 1.0, 0.12,
                &settings, color,
            );
        }

        let final_wetness = state.footprints.last().unwrap().wetness;
        assert!(
            final_wetness < initial_wetness,
            "Wetness should decrease as paint depletes: initial={}, final={}",
            initial_wetness, final_wetness
        );
        // Wetness should not go below the floor (10% of settings.wetness)
        assert!(
            final_wetness >= settings.wetness * 0.1 - 0.001,
            "Wetness should not go below floor: final={}, floor={}",
            final_wetness, settings.wetness * 0.1
        );
    }

    #[test]
    fn test_pressure_modulated_paint_thickness() {
        let settings = WetMediaBrushSettings {
            paint_thickness: 0.8,
            bristle_count: 8,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);
        let color = [1.0, 0.0, 0.0];

        // Full pressure → full thickness
        let (fp_full, _) = generate_bristle_footprint(
            50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
            &settings, color, 0.8, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        // Half pressure → half thickness
        let (fp_half, _) = generate_bristle_footprint(
            50.0, 50.0, 0.5, 20.0, 0.0, 1.0,
            &settings, color, 0.8, [0.0, 0.0], &offsets, None, &mut vec![(0.0, 0.0); 128], &[], 0.3, &mut rng,
        );

        assert!(
            (fp_full.paint_thickness - 0.8).abs() < 0.01,
            "Full pressure: thickness={}, expected 0.8", fp_full.paint_thickness
        );
        assert!(
            (fp_half.paint_thickness - 0.4).abs() < 0.01,
            "Half pressure: thickness={}, expected 0.4", fp_half.paint_thickness
        );
    }

    #[test]
    fn test_canvas_color_pickup_diverges_bristle_colors() {
        let settings = WetMediaBrushSettings {
            paint_load: 0.3,
            paint_depletion_rate: 0.8, // very fast depletion
            mixing_strength: 0.3,
            bristle_count: 16,
            bristle_spread: 0.1,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [0.5, 0.5, 0.5];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );

        // All bristle colors should start identical
        let first = state.bristle_colors[0];
        for c in &state.bristle_colors {
            assert_eq!(*c, first, "Bristle colors should start identical");
        }

        // Move many times to deplete paint and accumulate color pickup
        for i in 1..=40 {
            wet_media_stroke_move(
                &mut state, 10.0 + i as f32 * 3.0, 10.0, 1.0,
                20.0, 0.0, 1.0, 0.12,
                &settings, color,
            );
        }

        // After depletion, bristle colors should have diverged
        let mut max_diff = 0.0f32;
        for i in 0..state.bristle_colors.len() {
            for j in (i + 1)..state.bristle_colors.len() {
                for c in 0..3 {
                    let diff = (state.bristle_colors[i][c] - state.bristle_colors[j][c]).abs();
                    max_diff = max_diff.max(diff);
                }
            }
        }
        assert!(
            max_diff > 0.001,
            "Bristle colors should diverge after depletion, max_diff={}",
            max_diff
        );
    }

    #[test]
    fn test_brush_form_low_pressure_deactivates_outer_bristles() {
        let settings = WetMediaBrushSettings {
            bristle_count: 32,
            brush_form: 0.8,
            bristle_spread: 0.1,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);

        // Low pressure: many outer bristles should be deactivated
        let positions = compute_bristle_canvas_positions(
            50.0, 50.0, 0.1, 20.0, 0.0, 1.0,
            &settings, [0.0, 0.0], &offsets, &mut vec![(0.0, 0.0); 32], &[], 0.3, &mut rng,
        );
        let inactive_count = positions.iter().filter(|p| p.pressure == 0.0).count();
        assert!(
            inactive_count > positions.len() / 2,
            "At low pressure with high brush_form, >50% bristles should be inactive: {}/{}",
            inactive_count, positions.len()
        );
    }

    #[test]
    fn test_brush_form_full_pressure_all_active() {
        let settings = WetMediaBrushSettings {
            bristle_count: 32,
            brush_form: 0.8,
            bristle_spread: 0.1,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);

        // Full pressure: all bristles should be active
        let positions = compute_bristle_canvas_positions(
            50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
            &settings, [0.0, 0.0], &offsets, &mut vec![(0.0, 0.0); 32], &[], 0.3, &mut rng,
        );
        let inactive_count = positions.iter().filter(|p| p.pressure == 0.0).count();
        assert_eq!(
            inactive_count, 0,
            "At full pressure, all bristles should be active"
        );
    }

    #[test]
    fn test_brush_form_zero_always_all_active() {
        let settings = WetMediaBrushSettings {
            bristle_count: 32,
            brush_form: 0.0, // no brush form effect
            bristle_spread: 0.1,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);

        // Even at very low pressure, brush_form=0 means all bristles active
        let positions = compute_bristle_canvas_positions(
            50.0, 50.0, 0.1, 20.0, 0.0, 1.0,
            &settings, [0.0, 0.0], &offsets, &mut vec![(0.0, 0.0); 32], &[], 0.3, &mut rng,
        );
        let inactive_count = positions.iter().filter(|p| p.pressure == 0.0).count();
        assert_eq!(
            inactive_count, 0,
            "With brush_form=0, all bristles should always be active"
        );
    }

    #[test]
    fn test_brush_form_elliptical_deactivates_narrow_axis_first() {
        // With low roundness (flat brush), bristles along the narrow (y) axis
        // should deactivate before those along the wide (x) axis.
        let settings = WetMediaBrushSettings {
            bristle_count: 64,
            brush_form: 0.6,
            bristle_spread: 0.3,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(7.0, 7.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);

        // Low roundness = flat brush, moderate pressure
        let positions = compute_bristle_canvas_positions(
            50.0, 50.0, 0.3, 20.0, 0.0, 0.3,
            &settings, [0.0, 0.0], &offsets, &mut vec![(0.0, 0.0); 64], &[], 0.3, &mut rng,
        );
        // Same test with round brush (roundness=1.0)
        let mut rng2 = Rng::from_coords(7.0, 7.0);
        let offsets2 = init_bristle_offsets(settings.bristle_count, &mut rng2);
        let positions_round = compute_bristle_canvas_positions(
            50.0, 50.0, 0.3, 20.0, 0.0, 1.0,
            &settings, [0.0, 0.0], &offsets2, &mut vec![(0.0, 0.0); 64], &[], 0.3, &mut rng2,
        );

        let inactive_flat = positions.iter().filter(|p| p.pressure == 0.0).count();
        let inactive_round = positions_round.iter().filter(|p| p.pressure == 0.0).count();

        // Flat brush should deactivate more bristles than round at same pressure,
        // because the elliptical distance stretches the narrow axis.
        assert!(
            inactive_flat > inactive_round,
            "Flat brush should deactivate more bristles than round: flat={}, round={}",
            inactive_flat, inactive_round
        );
    }

    #[test]
    fn test_color_noise_produces_variation() {
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            color_noise: 0.5,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [0.5, 0.3, 0.7];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );

        // Bristle colors should diverge from each other
        let mut max_diff = 0.0f32;
        for i in 0..state.bristle_colors.len() {
            for j in (i + 1)..state.bristle_colors.len() {
                for c in 0..3 {
                    let diff = (state.bristle_colors[i][c] - state.bristle_colors[j][c]).abs();
                    max_diff = max_diff.max(diff);
                }
            }
        }
        assert!(max_diff > 0.01, "Color noise should produce variation: max_diff={}", max_diff);
    }

    #[test]
    fn test_color_noise_zero_no_variation() {
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            color_noise: 0.0,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [0.5, 0.3, 0.7];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );

        // All bristle colors should equal the paint color
        for c in &state.bristle_colors {
            assert_eq!(*c, color, "With noise=0, all bristles should match paint color");
        }
    }

    #[test]
    fn test_color_noise_deterministic() {
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            color_noise: 0.5,
            ..Default::default()
        };
        let color = [0.5, 0.3, 0.7];

        let mut state1 = WetMediaStrokeState::default();
        wet_media_stroke_begin(
            &mut state1, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );

        let mut state2 = WetMediaStrokeState::default();
        wet_media_stroke_begin(
            &mut state2, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );

        assert_eq!(state1.bristle_colors, state2.bristle_colors, "Same seed should produce same colors");
    }

    #[test]
    fn test_speed_smudging_fast_stroke_higher_mixing() {
        let settings = WetMediaBrushSettings {
            bristle_count: 8,
            bristle_spread: 0.1,
            speed_smudging: 0.7,
            mixing_strength: 0.3,
            ..Default::default()
        };
        let color = [1.0, 0.0, 0.0];

        // Slow stroke
        let mut state_slow = WetMediaStrokeState::default();
        wet_media_stroke_begin(
            &mut state_slow, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        state_slow.footprints.clear();
        wet_media_stroke_move(
            &mut state_slow, 13.0, 10.0, 1.0, // small movement = slow velocity
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        let slow_mixing = state_slow.footprints.last().unwrap().mixing_strength;

        // Fast stroke
        let mut state_fast = WetMediaStrokeState::default();
        wet_media_stroke_begin(
            &mut state_fast, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        state_fast.footprints.clear();
        wet_media_stroke_move(
            &mut state_fast, 80.0, 10.0, 1.0, // large movement = fast velocity
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        let fast_mixing = state_fast.footprints.last().unwrap().mixing_strength;

        assert!(
            fast_mixing > slow_mixing,
            "Fast stroke should have higher mixing: fast={}, slow={}",
            fast_mixing, slow_mixing
        );
    }

    #[test]
    fn test_speed_smudging_zero_no_effect() {
        let settings = WetMediaBrushSettings {
            bristle_count: 8,
            bristle_spread: 0.1,
            speed_smudging: 0.0,
            mixing_strength: 0.3,
            paint_load: 1.0,
            paint_depletion_rate: 0.0, // no depletion so mixing stays at base
            ..Default::default()
        };
        let color = [1.0, 0.0, 0.0];

        let mut state = WetMediaStrokeState::default();
        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        state.footprints.clear();
        wet_media_stroke_move(
            &mut state, 50.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );
        let mixing = state.footprints.last().unwrap().mixing_strength;
        assert!(
            (mixing - 0.3).abs() < 0.01,
            "With speed_smudging=0, mixing should stay at base: {}",
            mixing
        );
    }

    #[test]
    fn test_elastic_recovery_gradual_not_instant() {
        let settings = WetMediaBrushSettings {
            bristle_count: 8,
            bristle_spread: 0.5,
            bristle_stiffness: 0.5,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);
        let mut deformations = vec![(0.0, 0.0); settings.bristle_count as usize];

        // Apply high-velocity movement → deformations build up
        for _ in 0..10 {
            compute_bristle_canvas_positions(
                50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
                &settings, [20.0, 0.0], &offsets, &mut deformations, &[], 0.3, &mut rng,
            );
        }

        // Record deformations after high velocity
        let deform_after_high_vel: Vec<(f32, f32)> = deformations.clone();
        let max_deform = deform_after_high_vel.iter()
            .map(|(dx, dy)| (dx * dx + dy * dy).sqrt())
            .fold(0.0f32, f32::max);
        assert!(max_deform > 0.001, "Deformations should build up under velocity: {}", max_deform);

        // Now apply zero velocity — deformations should gradually recover (not snap)
        compute_bristle_canvas_positions(
            50.0, 50.0, 0.5, 20.0, 0.0, 1.0,
            &settings, [0.0, 0.0], &offsets, &mut deformations, &[], 0.3, &mut rng,
        );

        // After ONE step at zero velocity, deformations should decrease but NOT be zero
        let max_deform_after = deformations.iter()
            .map(|(dx, dy)| (dx * dx + dy * dy).sqrt())
            .fold(0.0f32, f32::max);
        assert!(
            max_deform_after > 0.0 && max_deform_after < max_deform,
            "Deformations should gradually recover, not snap: before={}, after={}",
            max_deform, max_deform_after
        );
    }

    #[test]
    fn test_elastic_recovery_converges_to_zero() {
        let settings = WetMediaBrushSettings {
            bristle_count: 8,
            bristle_spread: 0.5,
            bristle_stiffness: 0.5,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let offsets = init_bristle_offsets(settings.bristle_count, &mut rng);
        let mut deformations = vec![(0.0, 0.0); settings.bristle_count as usize];

        // Build up deformations
        for _ in 0..10 {
            compute_bristle_canvas_positions(
                50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
                &settings, [20.0, 0.0], &offsets, &mut deformations, &[], 0.3, &mut rng,
            );
        }

        // Many steps at zero velocity AND zero pressure → splay=1.0, so
        // target deformation is zero and deformations should converge to zero.
        for _ in 0..50 {
            compute_bristle_canvas_positions(
                50.0, 50.0, 0.0, 20.0, 0.0, 1.0,
                &settings, [0.0, 0.0], &offsets, &mut deformations, &[], 0.3, &mut rng,
            );
        }

        let max_deform = deformations.iter()
            .map(|(dx, dy)| (dx * dx + dy * dy).sqrt())
            .fold(0.0f32, f32::max);
        assert!(
            max_deform < 0.001,
            "Deformations should converge to near-zero at zero pressure: {}",
            max_deform
        );
    }

    #[test]
    fn test_elastic_recovery_initialized_and_cleared() {
        let mut state = WetMediaStrokeState::default();
        let settings = WetMediaBrushSettings {
            bristle_count: 16,
            ..Default::default()
        };
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(
            &mut state, 10.0, 10.0, 1.0,
            20.0, 0.0, 1.0, 0.12,
            &settings, color,
        );

        // Deformations vector is created with the correct bristle count
        assert_eq!(state.bristle_deformations.len(), 16);
        // After one spring step from zero, deformations should be small
        // (spring_rate=0.3 of the splay offset, which is modest)
        for d in &state.bristle_deformations {
            assert!(
                (d.0.abs() + d.1.abs()) < 1.0,
                "Initial deformations should be small after first step: ({}, {})",
                d.0, d.1
            );
        }

        wet_media_stroke_end(&mut state);
        assert!(state.bristle_deformations.is_empty(), "Deformations should be cleared on end");
        assert!(state.bristle_states.is_empty(), "Bristle states should be cleared on end");
    }

    #[test]
    fn test_brush_shape_round_distribution() {
        let mut rng = Rng::from_coords(1.0, 1.0);
        let (offsets, states) = init_bristle_layout(64, BrushShape::Round, 0.5, 0.8, 0.7, &mut rng);
        assert_eq!(offsets.len(), 64);
        assert_eq!(states.len(), 64);
        // Center bristles should be stiffer
        let center: Vec<&BristleState> = states.iter().filter(|s| s.radial_distance < 0.3).collect();
        let edge: Vec<&BristleState> = states.iter().filter(|s| s.radial_distance > 0.7).collect();
        if !center.is_empty() && !edge.is_empty() {
            let avg_center_stiff: f32 = center.iter().map(|s| s.stiffness).sum::<f32>() / center.len() as f32;
            let avg_edge_stiff: f32 = edge.iter().map(|s| s.stiffness).sum::<f32>() / edge.len() as f32;
            assert!(avg_center_stiff > avg_edge_stiff, "Center should be stiffer: center={}, edge={}", avg_center_stiff, avg_edge_stiff);
        }
    }

    #[test]
    fn test_brush_shape_flat_distribution() {
        let mut rng = Rng::from_coords(2.0, 2.0);
        let (offsets, states) = init_bristle_layout(64, BrushShape::Flat, 0.5, 0.8, 0.7, &mut rng);
        assert_eq!(offsets.len(), 64);
        assert_eq!(states.len(), 64);
        // Flat brush: Y range should be narrow, X range wide
        let x_range_span = offsets.iter().map(|o| o.0).fold(f32::MIN, f32::max) - offsets.iter().map(|o| o.0).fold(f32::MAX, f32::min);
        let y_range_span = offsets.iter().map(|o| o.1).fold(f32::MIN, f32::max) - offsets.iter().map(|o| o.1).fold(f32::MAX, f32::min);
        assert!(x_range_span > y_range_span * 2.0, "Flat brush X range should be wider than Y: x={}, y={}", x_range_span, y_range_span);
    }

    #[test]
    fn test_bristle_splitting_at_low_paint() {
        let settings = WetMediaBrushSettings {
            bristle_count: 32,
            splitting_threshold: 0.3,
            paint_load: 0.05, // very low initial load, below splitting_threshold * 0.3
            paint_depletion_rate: 0.0,
            brush_form: 0.0, // disable brush_form deactivation
            ..Default::default()
        };
        let mut rng = Rng::from_coords(5.0, 5.0);
        let (offsets, states) = init_bristle_layout(32, settings.brush_shape, settings.bristle_stiffness, settings.paint_load, settings.wetness, &mut rng);

        // With paint load 0.1 < splitting_threshold 0.3, some bristles should have reduced pressure
        let positions = compute_bristle_canvas_positions(
            50.0, 50.0, 1.0, 20.0, 0.0, 1.0,
            &settings, [0.0, 0.0], &offsets, &mut vec![(0.0, 0.0); 32], &states, settings.splitting_threshold, &mut rng,
        );

        // Some bristles should have zero or reduced pressure due to splitting
        let zero_pressure = positions.iter().filter(|p| p.pressure == 0.0).count();
        assert!(zero_pressure > 0, "Low paint load should cause some bristle gaps: zero_count={}", zero_pressure);
    }

    #[test]
    fn test_per_bristle_depletion_outer_faster() {
        let settings = WetMediaBrushSettings {
            paint_load: 1.0,
            paint_depletion_rate: 0.1,
            bristle_count: 32,
            ..Default::default()
        };
        let mut state = WetMediaStrokeState::default();
        let color = [1.0, 0.0, 0.0];

        wet_media_stroke_begin(&mut state, 0.0, 0.0, 1.0, 20.0, 0.0, 1.0, 0.25, &settings, color);

        // Move enough to partially deplete but not fully
        for i in 1..=10 {
            wet_media_stroke_move(&mut state, i as f32 * 6.0, 0.0, 1.0, 20.0, 0.0, 1.0, 0.25, &settings, color);
        }

        // Outer bristles should have less paint than center bristles
        let center_states: Vec<&BristleState> = state.bristle_states.iter().filter(|s| s.radial_distance < 0.3).collect();
        let edge_states: Vec<&BristleState> = state.bristle_states.iter().filter(|s| s.radial_distance > 0.7).collect();
        if !center_states.is_empty() && !edge_states.is_empty() {
            let avg_center_load: f32 = center_states.iter().map(|s| s.paint_load).sum::<f32>() / center_states.len() as f32;
            let avg_edge_load: f32 = edge_states.iter().map(|s| s.paint_load).sum::<f32>() / edge_states.len() as f32;
            assert!(avg_center_load > avg_edge_load, "Center bristles should retain more paint: center={}, edge={}", avg_center_load, avg_edge_load);
        }
    }

    #[test]
    fn test_brush_shape_serialization() {
        for shape in [BrushShape::Round, BrushShape::Flat, BrushShape::Filbert, BrushShape::Fan] {
            let bytes = rmp_serde::to_vec(&shape).unwrap();
            let decoded: BrushShape = rmp_serde::from_slice(&bytes).unwrap();
            assert_eq!(shape, decoded);
        }
    }
}
