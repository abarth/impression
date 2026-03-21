use serde::{Deserialize, Serialize};

use crate::blend_mode::{porter_duff_composite, BlendMode};
use crate::color::{blend_pixel, Color};
use crate::dynamics::{self, Rng, ShapeDynamics, TransferDynamics};
use crate::layer::Layer;

/// A custom brush tip image: grayscale alpha mask.
#[derive(Clone, Debug)]
pub struct BrushTip {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Texture overlay settings: tile a pattern across the brush footprint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextureSettings {
    /// Whether texture overlay is enabled.
    pub enabled: bool,
    /// Pattern tile scale as a percentage (100 = original size).
    pub scale: f32,
    /// Strength of the texture effect (0.0 = none, 1.0 = full).
    pub depth: f32,
    /// When true, pattern coordinates are relative to stamp center;
    /// when false, they are relative to the canvas origin (screen-aligned).
    pub texture_each_tip: bool,
}

impl Default for TextureSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            scale: 100.0,
            depth: 1.0,
            texture_each_tip: false,
        }
    }
}

/// How the secondary tip's alpha combines with the primary tip's alpha.
///
/// In Photoshop, the dual brush panel has a "Mode" dropdown that controls
/// this combination. These operate on scalar alpha values (0.0–1.0),
/// not on RGB colors.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[repr(u8)]
pub enum DualBrushMode {
    /// `primary * secondary` — masks the primary where secondary is transparent.
    Multiply = 0,
    /// `min(primary, secondary)` — takes the darker (more transparent) of the two.
    Darken = 1,
    /// `max(primary, secondary)` — takes the lighter (more opaque) of the two.
    Lighten = 2,
    /// `max(0, primary - secondary)` — subtracts secondary from primary.
    Subtract = 3,
    /// `primary + secondary * (1 - primary)` — adds secondary where primary is thin.
    LinearDodge = 4,
    /// `1 - (1 - primary) * (1 - secondary)` — Screen; brightens combined alpha.
    Screen = 5,
}

impl Default for DualBrushMode {
    fn default() -> Self {
        DualBrushMode::Multiply
    }
}

impl DualBrushMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => DualBrushMode::Multiply,
            1 => DualBrushMode::Darken,
            2 => DualBrushMode::Lighten,
            3 => DualBrushMode::Subtract,
            4 => DualBrushMode::LinearDodge,
            5 => DualBrushMode::Screen,
            _ => DualBrushMode::Multiply,
        }
    }

    /// Combine primary and secondary alpha values using this mode.
    pub fn apply(self, primary: f32, secondary: f32) -> f32 {
        match self {
            DualBrushMode::Multiply => primary * secondary,
            DualBrushMode::Darken => primary.min(secondary),
            DualBrushMode::Lighten => primary.max(secondary),
            DualBrushMode::Subtract => (primary - secondary).max(0.0),
            DualBrushMode::LinearDodge => (primary + secondary * (1.0 - primary)).min(1.0),
            DualBrushMode::Screen => 1.0 - (1.0 - primary) * (1.0 - secondary),
        }
    }
}

/// Dual brush settings: composite a secondary tip with the primary for texture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DualBrushSettings {
    /// Whether dual brush is enabled.
    pub enabled: bool,
    /// How the secondary tip alpha combines with the primary.
    pub mode: DualBrushMode,
    /// Use a computed circle (true) or the registered secondary tip (false).
    pub use_computed: bool,
    /// Hardness for computed circle secondary tip.
    pub hardness: f32,
    /// Diameter of the secondary tip in pixels.
    pub size: f32,
    /// Spacing for the secondary tip.
    pub spacing: f32,
    /// Number of secondary stamps per primary stamp position.
    pub count: u32,
    /// Scatter amount for secondary stamps (as a multiple of size).
    pub scatter: f32,
    /// Whether scatter applies to both axes or just perpendicular.
    pub both_axes: bool,
}

impl Default for DualBrushSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: DualBrushMode::Multiply,
            use_computed: true,
            hardness: 1.0,
            size: 20.0,
            spacing: 0.25,
            count: 1,
            scatter: 0.0,
            both_axes: false,
        }
    }
}

/// Scattering settings: random stamp offset perpendicular to the stroke path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScatterSettings {
    /// Maximum perpendicular offset as a fraction of brush size (0.0 = off, 10.0 = 1000%).
    pub scatter: f32,
    /// When true, also scatter along the stroke direction (2D scatter).
    pub both_axes: bool,
    /// Number of stamps per spacing interval (1–16).
    pub count: u32,
    /// Randomize stamp count per interval (0.0–1.0).
    pub count_jitter: f32,
}

impl Default for ScatterSettings {
    fn default() -> Self {
        Self {
            scatter: 0.0,
            both_axes: false,
            count: 1,
            count_jitter: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct BrushSettings {
    /// Base diameter in pixels.
    pub size: f32,
    /// Distance between stamp centers as a fraction of size (e.g., 0.25 = 25% of diameter).
    pub spacing: f32,
    /// Brush color.
    pub color: Color,
    /// Opacity of the entire stroke (0.0 - 1.0).
    pub opacity: f32,
    /// Per-stamp alpha (0.0 - 1.0).
    pub flow: f32,
    /// Blend mode applied when compositing the stroke onto the layer.
    /// Defaults to Normal (SrcOver). Set to DstOut for erasing.
    pub blend_mode: BlendMode,
    /// Hardness of the brush edge (0.0 = soft, 1.0 = hard).
    /// Controls the inner radius for the falloff gradient.
    pub hardness: f32,
    /// Roundness of the brush (0.0 to 1.0, 1.0 = circle).
    /// Values < 1.0 produce an elliptical brush squashed along one axis.
    pub roundness: f32,
    /// Rotation angle of the brush in degrees (0.0 to 360.0).
    pub angle: f32,
    /// Per-stamp shape variation (size, angle, roundness).
    pub shape_dynamics: ShapeDynamics,
    /// Per-stamp transfer variation (opacity, flow).
    pub transfer_dynamics: TransferDynamics,
    /// Mirror the brush tip horizontally.
    pub flip_x: bool,
    /// Mirror the brush tip vertically.
    pub flip_y: bool,
    /// Scattering settings.
    pub scatter: ScatterSettings,
    /// Dual brush settings.
    pub dual_brush: DualBrushSettings,
    /// Texture overlay settings.
    pub texture: TextureSettings,
    /// Active brush tip ID (references Canvas::tip_registry). None = computed circle.
    pub active_tip_id: Option<String>,
    /// Secondary (dual brush) tip ID.
    pub secondary_tip_id: Option<String>,
    /// Texture pattern tip ID.
    pub texture_tip_id: Option<String>,
}

impl Default for BrushSettings {
    fn default() -> Self {
        Self {
            size: 10.0,
            spacing: 0.25,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            blend_mode: BlendMode::Normal,
            hardness: 1.0,
            roundness: 1.0,
            angle: 0.0,
            shape_dynamics: ShapeDynamics::default(),
            transfer_dynamics: TransferDynamics::default(),
            flip_x: false,
            flip_y: false,
            scatter: ScatterSettings::default(),
            dual_brush: DualBrushSettings::default(),
            texture: TextureSettings::default(),
            active_tip_id: None,
            secondary_tip_id: None,
            texture_tip_id: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct StrokeState {
    pub active: bool,
    pub last_point: Option<(f32, f32, f32)>, // x, y, pressure
    pub residual_distance: f32,
    /// Layer pixels saved at stroke start, used to composite the stroke buffer.
    snapshot: Vec<u8>,
    /// Temporary buffer where stamps accumulate during the stroke.
    stroke_layer: Option<Layer>,
    /// Per-stroke PRNG for random dynamics, seeded from stroke start coordinates.
    pub rng: Option<Rng>,
    /// Direction angle (degrees) captured on the first stroke_move, used by InitialDirection control.
    pub initial_direction: Option<f32>,
}

impl StrokeState {
    pub fn new() -> Self {
        Self {
            active: false,
            last_point: None,
            residual_distance: 0.0,
            snapshot: Vec::new(),
            stroke_layer: None,
            rng: None,
            initial_direction: None,
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.last_point = None;
        self.residual_distance = 0.0;
        self.snapshot.clear();
        self.stroke_layer = None;
        self.rng = None;
        self.initial_direction = None;
    }
}

/// Sample the secondary tip alpha at a given canvas position, relative to stamp center.
/// Returns 1.0 if no secondary tip modulation.
fn sample_secondary_tip(
    px: f32,
    py: f32,
    cx: f32,
    cy: f32,
    secondary_radius: f32,
    secondary: &SecondaryTipState,
) -> f32 {
    let dx = px - cx;
    let dy = py - cy;
    let dist = (dx * dx + dy * dy).sqrt();
    if dist > secondary_radius + 0.5 {
        return 0.0;
    }

    match secondary {
        SecondaryTipState::Computed { hardness } => {
            let inner_r = secondary_radius * hardness;
            if dist <= inner_r {
                1.0
            } else {
                let falloff = (secondary_radius + 0.5) - inner_r;
                if falloff <= 0.0 {
                    1.0
                } else {
                    let t = ((secondary_radius + 0.5 - dist) / falloff).clamp(0.0, 1.0);
                    t * t * (3.0 - 2.0 * t)
                }
            }
        }
        SecondaryTipState::Image(tip) => {
            let diameter = secondary_radius * 2.0;
            let u = (dx + secondary_radius) / diameter * tip.width as f32;
            let v = (dy + secondary_radius) / diameter * tip.height as f32;
            if u < 0.0 || u >= tip.width as f32 || v < 0.0 || v >= tip.height as f32 {
                return 0.0;
            }
            let u0 = u.floor() as u32;
            let v0 = v.floor() as u32;
            let u1 = (u0 + 1).min(tip.width - 1);
            let v1 = (v0 + 1).min(tip.height - 1);
            let fu = u - u0 as f32;
            let fv = v - v0 as f32;
            let s00 = tip.pixels[(v0 * tip.width + u0) as usize] as f32 / 255.0;
            let s10 = tip.pixels[(v0 * tip.width + u1) as usize] as f32 / 255.0;
            let s01 = tip.pixels[(v1 * tip.width + u0) as usize] as f32 / 255.0;
            let s11 = tip.pixels[(v1 * tip.width + u1) as usize] as f32 / 255.0;
            s00 * (1.0 - fu) * (1.0 - fv)
                + s10 * fu * (1.0 - fv)
                + s01 * (1.0 - fu) * fv
                + s11 * fu * fv
        }
    }
}

/// State for the secondary (dual) brush tip during stamping.
pub(crate) enum SecondaryTipState<'a> {
    Computed { hardness: f32 },
    Image(&'a BrushTip),
}

/// Sample a tiled texture pattern at a given position, returning the modulated alpha.
/// `px`, `py` are the canvas pixel coordinates of the stamp pixel.
/// `cx`, `cy` are the stamp center coordinates.
/// When `texture_each_tip` is true, pattern coordinates are relative to the stamp center.
/// Otherwise they are relative to the canvas origin (screen-aligned tiling).
fn sample_texture(
    px: f32,
    py: f32,
    cx: f32,
    cy: f32,
    texture: &TextureSettings,
    pattern: &BrushTip,
) -> f32 {
    if pattern.width == 0 || pattern.height == 0 {
        return 1.0;
    }

    let scale = (texture.scale / 100.0).max(0.01);
    let tw = pattern.width as f32 * scale;
    let th = pattern.height as f32 * scale;

    // Choose coordinate origin
    let (ox, oy) = if texture.texture_each_tip {
        (px - cx, py - cy)
    } else {
        (px, py)
    };

    // Tile: wrap into [0, tw) x [0, th)
    let u = ((ox % tw) + tw) % tw / scale;
    let v = ((oy % th) + th) % th / scale;

    // Bilinear interpolation
    let u0 = u.floor() as u32 % pattern.width;
    let v0 = v.floor() as u32 % pattern.height;
    let u1 = (u0 + 1) % pattern.width;
    let v1 = (v0 + 1) % pattern.height;
    let fu = u.fract();
    let fv = v.fract();

    let s00 = pattern.pixels[(v0 * pattern.width + u0) as usize] as f32 / 255.0;
    let s10 = pattern.pixels[(v0 * pattern.width + u1) as usize] as f32 / 255.0;
    let s01 = pattern.pixels[(v1 * pattern.width + u0) as usize] as f32 / 255.0;
    let s11 = pattern.pixels[(v1 * pattern.width + u1) as usize] as f32 / 255.0;

    let pattern_value = s00 * (1.0 - fu) * (1.0 - fv)
        + s10 * fu * (1.0 - fv)
        + s01 * (1.0 - fu) * fv
        + s11 * fu * fv;

    // Lerp between 1.0 (no effect) and pattern_value based on depth
    1.0 - texture.depth * (1.0 - pattern_value)
}

/// Draw a filled elliptical stamp with hardness, roundness, and angle onto the layer.
/// If a selection mask is provided, the stamp is clipped to the selected region.
pub fn stamp_ellipse(
    layer: &mut Layer,
    cx: f32,
    cy: f32,
    radius: f32,
    color: Color,
    alpha: f32,
    hardness: f32,
    roundness: f32,
    angle_degrees: f32,
    selection: Option<&[u8]>,
    dual: Option<(&SecondaryTipState, f32, DualBrushMode)>,
    texture: Option<(&TextureSettings, &BrushTip)>,
) {
    if radius <= 0.0 || alpha <= 0.0 {
        return;
    }

    let roundness = roundness.clamp(0.01, 1.0);
    let r = radius;
    // The effective bounding extent: when roundness < 1, the ellipse extends
    // further along the elongated axis. Account for rotation.
    let extent = r / roundness;
    let x_min = ((cx - extent - 1.0).floor().max(0.0)) as u32;
    let y_min = ((cy - extent - 1.0).floor().max(0.0)) as u32;
    let x_max = ((cx + extent + 1.0).ceil()).min(layer.width as f32 - 1.0) as u32;
    let y_max = ((cy + extent + 1.0).ceil()).min(layer.height as f32 - 1.0) as u32;

    // Inner radius where the falloff begins.
    let inner_r = r * hardness;

    // Precompute inverse rotation to map canvas pixels back to brush space.
    // Positive angle = counter-clockwise on screen (Photoshop convention, Y-down).
    let angle_rad = angle_degrees.to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();
    let inv_roundness = 1.0 / roundness;

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let dx = px as f32 + 0.5 - cx;
            let dy = py as f32 + 0.5 - cy;

            // Inverse rotation (canvas → brush space)
            let rx = dx * cos_a - dy * sin_a;
            let ry = dx * sin_a + dy * cos_a;

            // Scale y by 1/roundness to squash circle into ellipse
            let ry_scaled = ry * inv_roundness;

            let dist = (rx * rx + ry_scaled * ry_scaled).sqrt();

            if dist > r + 0.5 {
                continue;
            }

            // Hardness-aware falloff
            let edge_alpha = if dist <= inner_r {
                1.0
            } else {
                let falloff_range = (r + 0.5) - inner_r;
                if falloff_range <= 0.0 {
                    1.0
                } else {
                    let t = ((r + 0.5 - dist) / falloff_range).clamp(0.0, 1.0);
                    t * t * (3.0 - 2.0 * t) // smoothstep
                }
            };

            let combined_alpha = match &dual {
                Some((secondary, sec_radius, mode)) => {
                    let sec = sample_secondary_tip(
                        px as f32 + 0.5,
                        py as f32 + 0.5,
                        cx,
                        cy,
                        *sec_radius,
                        secondary,
                    );
                    mode.apply(edge_alpha, sec)
                }
                None => edge_alpha,
            };
            let texture_alpha = match &texture {
                Some((tex, pattern)) => {
                    sample_texture(px as f32 + 0.5, py as f32 + 0.5, cx, cy, tex, pattern)
                }
                None => 1.0,
            };
            let selection_alpha = match selection {
                Some(mask) => mask[(py * layer.width + px) as usize] as f32 / 255.0,
                None => 1.0,
            };
            let final_alpha = alpha * combined_alpha * texture_alpha * selection_alpha;
            if let Some(pixel) = layer.pixel_mut(px, py) {
                blend_pixel(pixel, color, final_alpha);
            }
        }
    }
    layer.expand_dirty((x_min, y_min, x_max, y_max));
}

/// Stamp a custom brush tip image onto the layer, scaled to the given radius.
/// The tip is rotated by `angle_degrees` and squashed by `roundness`.
/// Uses bilinear interpolation for smooth scaling.
pub fn stamp_tip(
    layer: &mut Layer,
    cx: f32,
    cy: f32,
    radius: f32,
    tip: &BrushTip,
    color: Color,
    alpha: f32,
    roundness: f32,
    angle_degrees: f32,
    flip_x: bool,
    flip_y: bool,
    selection: Option<&[u8]>,
    dual: Option<(&SecondaryTipState, f32, DualBrushMode)>,
    texture: Option<(&TextureSettings, &BrushTip)>,
) {
    if radius <= 0.0 || alpha <= 0.0 || tip.width == 0 || tip.height == 0 {
        return;
    }

    let roundness = roundness.clamp(0.01, 1.0);
    let extent = radius / roundness;
    let x_min = ((cx - extent - 1.0).floor().max(0.0)) as u32;
    let y_min = ((cy - extent - 1.0).floor().max(0.0)) as u32;
    let x_max = ((cx + extent + 1.0).ceil()).min(layer.width as f32 - 1.0) as u32;
    let y_max = ((cy + extent + 1.0).ceil()).min(layer.height as f32 - 1.0) as u32;

    // Positive angle = counter-clockwise on screen (Photoshop convention, Y-down).
    let angle_rad = angle_degrees.to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();
    let inv_roundness = 1.0 / roundness;

    // Map from canvas-space offset to tip-space UV coordinates.
    // The tip image spans [-radius, radius] in x and [-radius*roundness, radius*roundness] in y
    // (before rotation). We need to map the rotated/scaled coordinates to [0, tip.width) x [0, tip.height).
    let diameter = radius * 2.0;
    let tw = tip.width as f32;
    let th = tip.height as f32;

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let dx = px as f32 + 0.5 - cx;
            let dy = py as f32 + 0.5 - cy;

            // Inverse rotation (canvas → brush space)
            let rx = dx * cos_a - dy * sin_a;
            let ry = (dx * sin_a + dy * cos_a) * inv_roundness;

            // Map to tip UV: rx in [-radius, radius] -> [0, tw)
            let u = if flip_x {
                (radius - rx) / diameter * tw
            } else {
                (rx + radius) / diameter * tw
            };
            let v = if flip_y {
                (radius - ry) / diameter * th
            } else {
                (ry + radius) / diameter * th
            };

            if u < 0.0 || u >= tw || v < 0.0 || v >= th {
                continue;
            }

            // Bilinear interpolation
            let u0 = u.floor() as u32;
            let v0 = v.floor() as u32;
            let u1 = (u0 + 1).min(tip.width - 1);
            let v1 = (v0 + 1).min(tip.height - 1);
            let fu = u - u0 as f32;
            let fv = v - v0 as f32;

            let s00 = tip.pixels[(v0 * tip.width + u0) as usize] as f32 / 255.0;
            let s10 = tip.pixels[(v0 * tip.width + u1) as usize] as f32 / 255.0;
            let s01 = tip.pixels[(v1 * tip.width + u0) as usize] as f32 / 255.0;
            let s11 = tip.pixels[(v1 * tip.width + u1) as usize] as f32 / 255.0;

            let tip_alpha = s00 * (1.0 - fu) * (1.0 - fv)
                + s10 * fu * (1.0 - fv)
                + s01 * (1.0 - fu) * fv
                + s11 * fu * fv;

            if tip_alpha <= 0.0 {
                continue;
            }

            let combined_alpha = match &dual {
                Some((secondary, sec_radius, mode)) => {
                    let sec = sample_secondary_tip(
                        px as f32 + 0.5,
                        py as f32 + 0.5,
                        cx,
                        cy,
                        *sec_radius,
                        secondary,
                    );
                    mode.apply(tip_alpha, sec)
                }
                None => tip_alpha,
            };
            let texture_alpha = match &texture {
                Some((tex, pattern)) => {
                    sample_texture(px as f32 + 0.5, py as f32 + 0.5, cx, cy, tex, pattern)
                }
                None => 1.0,
            };
            let selection_alpha = match selection {
                Some(mask) => mask[(py * layer.width + px) as usize] as f32 / 255.0,
                None => 1.0,
            };
            let final_alpha = alpha * combined_alpha * texture_alpha * selection_alpha;
            if let Some(pixel) = layer.pixel_mut(px, py) {
                blend_pixel(pixel, color, final_alpha);
            }
        }
    }
    layer.expand_dirty((x_min, y_min, x_max, y_max));
}

/// Compute the bounding box of a stamp for recompositing.
fn stamp_bounds(
    cx: f32,
    cy: f32,
    radius: f32,
    roundness: f32,
    width: u32,
    height: u32,
) -> (u32, u32, u32, u32) {
    let extent = radius / roundness.clamp(0.01, 1.0);
    let x_min = (cx - extent - 1.0).floor().max(0.0) as u32;
    let y_min = (cy - extent - 1.0).floor().max(0.0) as u32;
    let x_max = ((cx + extent + 1.0).ceil())
        .min(width as f32 - 1.0)
        .max(0.0) as u32;
    let y_max = ((cy + extent + 1.0).ceil())
        .min(height as f32 - 1.0)
        .max(0.0) as u32;
    (x_min, y_min, x_max, y_max)
}

/// Composite the stroke buffer over the snapshot into the layer for a given region.
/// Uses the specified blend mode to determine how the stroke combines with the snapshot.
/// For Normal (and other Photoshop modes), this is SrcOver. For Porter-Duff modes,
/// the corresponding operator is applied.
fn recomposite_region(
    layer: &mut Layer,
    snapshot: &[u8],
    stroke_layer: &Layer,
    opacity: f32,
    blend_mode: BlendMode,
    bounds: (u32, u32, u32, u32),
) {
    let (x_min, y_min, x_max, y_max) = bounds;
    let w = layer.width;

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let i = ((py * w + px) * 4) as usize;

            let sa_raw = stroke_layer.pixels[i + 3] as f32 / 255.0;
            let sa = sa_raw * opacity;

            if sa <= 0.0 {
                // No stroke contribution, restore snapshot
                layer.pixels[i..i + 4].copy_from_slice(&snapshot[i..i + 4]);
                continue;
            }

            // Read stroke and snapshot as premultiplied RGBA
            let sr = stroke_layer.pixels[i] as f32 / 255.0 * sa;
            let sg = stroke_layer.pixels[i + 1] as f32 / 255.0 * sa;
            let sb = stroke_layer.pixels[i + 2] as f32 / 255.0 * sa;

            let da = snapshot[i + 3] as f32 / 255.0;
            let dr = snapshot[i] as f32 / 255.0 * da;
            let dg = snapshot[i + 1] as f32 / 255.0 * da;
            let db = snapshot[i + 2] as f32 / 255.0 * da;

            let (or, og, ob, oa) =
                porter_duff_composite(sr, sg, sb, sa, dr, dg, db, da, blend_mode);

            if oa <= 0.0 {
                layer.pixels[i..i + 4].copy_from_slice(&[0, 0, 0, 0]);
            } else {
                // Convert from premultiplied back to straight alpha
                layer.pixels[i] = (or / oa * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
                layer.pixels[i + 1] = (og / oa * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
                layer.pixels[i + 2] = (ob / oa * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
                layer.pixels[i + 3] = (oa * 255.0 + 0.5) as u8;
            }
        }
    }
    layer.expand_dirty(bounds);
}

/// Compute the bounding box that covers a line segment with stamps.
fn segment_bounds(
    x0: f32,
    y0: f32,
    p0: f32,
    x1: f32,
    y1: f32,
    p1: f32,
    brush: &BrushSettings,
    width: u32,
    height: u32,
) -> (u32, u32, u32, u32) {
    let max_radius = brush.size * p0.max(p1) / 2.0;
    let mut extent = max_radius / brush.roundness.clamp(0.01, 1.0);
    // Account for scatter offset: stamps can land up to scatter * size away
    if brush.scatter.scatter > 0.0 {
        extent += brush.scatter.scatter * brush.size;
    }
    let x_min = (x0.min(x1) - extent - 1.0).floor().max(0.0) as u32;
    let y_min = (y0.min(y1) - extent - 1.0).floor().max(0.0) as u32;
    let x_max = ((x0.max(x1) + extent + 1.0).ceil())
        .min(width as f32 - 1.0)
        .max(0.0) as u32;
    let y_max = ((y0.max(y1) + extent + 1.0).ceil())
        .min(height as f32 - 1.0)
        .max(0.0) as u32;
    (x_min, y_min, x_max, y_max)
}

/// Interpolate points along a segment and stamp circles into the stroke buffer.
/// Returns the residual distance for the next segment.
///
/// `direction_angle` is the stroke direction in degrees for Direction control.
/// `initial_direction_angle` is the initial direction for InitialDirection control.
pub fn interpolate_and_stamp(
    target: &mut Layer,
    x0: f32,
    y0: f32,
    p0: f32,
    x1: f32,
    y1: f32,
    p1: f32,
    brush: &BrushSettings,
    residual: f32,
    tip: Option<&BrushTip>,
    secondary_tip: Option<&BrushTip>,
    texture_tip: Option<&BrushTip>,
    selection: Option<&[u8]>,
    rng: &mut Rng,
    initial_direction_angle: f32,
) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let segment_len = (dx * dx + dy * dy).sqrt();

    if segment_len < 0.001 {
        return residual;
    }

    // Precompute perpendicular direction for scattering
    let inv_len = 1.0 / segment_len;
    let dir_x = dx * inv_len;
    let dir_y = dy * inv_len;
    // Perpendicular: rotate direction 90° counter-clockwise
    let perp_x = -dir_y;
    let perp_y = dir_x;

    // Compute direction angle in degrees from the segment direction.
    // atan2(dy, dx) gives angle from positive X axis; negate dy for screen coords (Y-down).
    let direction_angle = (-dy).atan2(dx).to_degrees();

    // Resolve direction for each dynamic control type:
    // - Direction uses the current segment direction
    // - InitialDirection uses the captured initial direction
    let resolve_direction = |control: &dynamics::DynamicControl| -> f32 {
        match control {
            dynamics::DynamicControl::InitialDirection => initial_direction_angle,
            _ => direction_angle,
        }
    };

    let scatter = &brush.scatter;
    let mut dist = residual;

    while dist <= segment_len {
        let t = dist / segment_len;
        let x = x0 + dx * t;
        let y = y0 + dy * t;
        let pressure = p0 + (p1 - p0) * t;

        let size_dir = resolve_direction(&brush.shape_dynamics.size.control);
        let effective_size = dynamics::apply_dynamic(
            &brush.shape_dynamics.size,
            brush.size,
            pressure,
            rng,
            size_dir,
        );
        let radius = effective_size / 2.0;
        let roundness_dir = resolve_direction(&brush.shape_dynamics.roundness.control);
        let stamp_roundness = dynamics::apply_dynamic(
            &brush.shape_dynamics.roundness,
            brush.roundness,
            pressure,
            rng,
            roundness_dir,
        )
        .clamp(0.01, 1.0);
        let angle_dir = resolve_direction(&brush.shape_dynamics.angle.control);
        let stamp_angle = dynamics::apply_angle_dynamic(
            &brush.shape_dynamics.angle,
            brush.angle,
            pressure,
            rng,
            angle_dir,
        );

        // Apply transfer dynamics
        let flow_dir = resolve_direction(&brush.transfer_dynamics.flow.control);
        let stamp_flow = dynamics::apply_dynamic(
            &brush.transfer_dynamics.flow,
            brush.flow,
            pressure,
            rng,
            flow_dir,
        )
        .clamp(0.0, 1.0);

        // Determine stamp count (with jitter)
        let stamp_count = if scatter.scatter > 0.0 {
            let base = scatter.count.max(1) as f32;
            let jittered = base - base * scatter.count_jitter * rng.next_f32();
            jittered.round().max(1.0) as u32
        } else {
            1
        };

        for _ in 0..stamp_count {
            // Apply scatter offset
            let (sx, sy) = if scatter.scatter > 0.0 {
                let max_offset = scatter.scatter * effective_size;
                let perp_offset = (rng.next_f32() * 2.0 - 1.0) * max_offset;
                let along_offset = if scatter.both_axes {
                    (rng.next_f32() * 2.0 - 1.0) * max_offset
                } else {
                    0.0
                };
                (
                    x + perp_x * perp_offset + dir_x * along_offset,
                    y + perp_y * perp_offset + dir_y * along_offset,
                )
            } else {
                (x, y)
            };

            let dual = if brush.dual_brush.enabled {
                let sec_radius = brush.dual_brush.size / 2.0;
                let sec_state = match secondary_tip {
                    Some(t) => SecondaryTipState::Image(t),
                    None => SecondaryTipState::Computed {
                        hardness: brush.dual_brush.hardness,
                    },
                };
                Some((sec_state, sec_radius, brush.dual_brush.mode))
            } else {
                None
            };
            let dual_ref = dual.as_ref().map(|(s, r, m)| (s, *r, *m));
            let tex_ref = if brush.texture.enabled {
                texture_tip.map(|t| (&brush.texture, t))
            } else {
                None
            };
            if let Some(tip) = tip {
                stamp_tip(
                    target,
                    sx,
                    sy,
                    radius,
                    tip,
                    brush.color,
                    stamp_flow,
                    stamp_roundness,
                    stamp_angle,
                    brush.flip_x,
                    brush.flip_y,
                    selection,
                    dual_ref,
                    tex_ref,
                );
            } else {
                stamp_ellipse(
                    target,
                    sx,
                    sy,
                    radius,
                    brush.color,
                    stamp_flow,
                    brush.hardness,
                    stamp_roundness,
                    stamp_angle,
                    selection,
                    dual_ref,
                    tex_ref,
                );
            }
        }

        // Spacing is relative to the current circle's effective size
        let step = (brush.spacing * effective_size).max(1.0);
        dist += step;
    }

    dist - segment_len
}

/// Begin a stroke at the given position.
pub fn stroke_begin(
    layer: &mut Layer,
    state: &mut StrokeState,
    brush: &BrushSettings,
    x: f32,
    y: f32,
    pressure: f32,
    tip: Option<&BrushTip>,
    secondary_tip: Option<&BrushTip>,
    texture_tip: Option<&BrushTip>,
    selection: Option<&[u8]>,
) {
    state.active = true;
    state.last_point = Some((x, y, pressure));
    state.residual_distance = 0.0;

    // Seed per-stroke PRNG from start coordinates
    let mut rng = Rng::from_coords(x, y);

    // Save snapshot and create stroke buffer
    state.snapshot = layer.pixels.clone();
    let mut stroke = Layer::new(0, layer.width, layer.height);

    // No direction available for the first stamp
    let dir_angle = 0.0;
    let effective_size = dynamics::apply_dynamic(
        &brush.shape_dynamics.size,
        brush.size,
        pressure,
        &mut rng,
        dir_angle,
    );
    let radius = effective_size / 2.0;
    let stamp_roundness = dynamics::apply_dynamic(
        &brush.shape_dynamics.roundness,
        brush.roundness,
        pressure,
        &mut rng,
        dir_angle,
    )
    .clamp(0.01, 1.0);
    let stamp_angle = dynamics::apply_angle_dynamic(
        &brush.shape_dynamics.angle,
        brush.angle,
        pressure,
        &mut rng,
        dir_angle,
    );
    let stamp_flow = dynamics::apply_dynamic(
        &brush.transfer_dynamics.flow,
        brush.flow,
        pressure,
        &mut rng,
        dir_angle,
    )
    .clamp(0.0, 1.0);

    let dual = if brush.dual_brush.enabled {
        let sec_radius = brush.dual_brush.size / 2.0;
        let sec_state = match secondary_tip {
            Some(t) => SecondaryTipState::Image(t),
            None => SecondaryTipState::Computed {
                hardness: brush.dual_brush.hardness,
            },
        };
        Some((sec_state, sec_radius, brush.dual_brush.mode))
    } else {
        None
    };
    let dual_ref = dual.as_ref().map(|(s, r, m)| (s, *r, *m));
    let tex_ref = if brush.texture.enabled {
        texture_tip.map(|t| (&brush.texture, t))
    } else {
        None
    };
    if let Some(tip) = tip {
        stamp_tip(
            &mut stroke,
            x,
            y,
            radius,
            tip,
            brush.color,
            stamp_flow,
            stamp_roundness,
            stamp_angle,
            brush.flip_x,
            brush.flip_y,
            selection,
            dual_ref,
            tex_ref,
        );
    } else {
        stamp_ellipse(
            &mut stroke,
            x,
            y,
            radius,
            brush.color,
            stamp_flow,
            brush.hardness,
            stamp_roundness,
            stamp_angle,
            selection,
            dual_ref,
            tex_ref,
        );
    }

    // Apply transfer dynamics to stroke opacity
    let stroke_opacity = dynamics::apply_dynamic(
        &brush.transfer_dynamics.opacity,
        brush.opacity,
        pressure,
        &mut rng,
        dir_angle,
    )
    .clamp(0.0, 1.0);

    // Composite stroke buffer over snapshot into layer
    let bounds = stamp_bounds(x, y, radius, stamp_roundness, layer.width, layer.height);
    recomposite_region(
        layer,
        &state.snapshot,
        &stroke,
        stroke_opacity,
        brush.blend_mode,
        bounds,
    );

    state.stroke_layer = Some(stroke);
    state.rng = Some(rng);
}

/// Continue a stroke to the given position.
pub fn stroke_move(
    layer: &mut Layer,
    state: &mut StrokeState,
    brush: &BrushSettings,
    x: f32,
    y: f32,
    pressure: f32,
    tip: Option<&BrushTip>,
    secondary_tip: Option<&BrushTip>,
    texture_tip: Option<&BrushTip>,
    selection: Option<&[u8]>,
) {
    if !state.active {
        return;
    }

    let stroke = match state.stroke_layer.as_mut() {
        Some(s) => s,
        None => return,
    };

    let rng = match state.rng.as_mut() {
        Some(r) => r,
        None => return,
    };

    if let Some((lx, ly, lp)) = state.last_point {
        // Capture initial direction on the first move
        let dx = x - lx;
        let dy = y - ly;
        let seg_len = (dx * dx + dy * dy).sqrt();
        if seg_len > 0.001 && state.initial_direction.is_none() {
            let angle = (-dy).atan2(dx).to_degrees();
            state.initial_direction = Some(angle);
        }

        let initial_dir = state.initial_direction.unwrap_or(0.0);

        let residual = interpolate_and_stamp(
            stroke,
            lx,
            ly,
            lp,
            x,
            y,
            pressure,
            brush,
            state.residual_distance,
            tip,
            secondary_tip,
            texture_tip,
            selection,
            rng,
            initial_dir,
        );
        state.residual_distance = residual;

        // Recomposite the segment's bounding box
        let bounds = segment_bounds(lx, ly, lp, x, y, pressure, brush, layer.width, layer.height);
        recomposite_region(
            layer,
            &state.snapshot,
            stroke,
            brush.opacity,
            brush.blend_mode,
            bounds,
        );
    }

    state.last_point = Some((x, y, pressure));
}

/// End the current stroke.
pub fn stroke_end(state: &mut StrokeState) {
    state.reset();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dynamics::Rng;

    #[test]
    fn test_stamp_ellipse_center_pixel() {
        let mut layer = Layer::new(0, 10, 10);
        stamp_ellipse(
            &mut layer,
            5.0,
            5.0,
            2.0,
            Color::new(255, 0, 0),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        // Center pixel should be fully red
        let px = layer.pixel(5, 5).unwrap();
        assert_eq!(px[0], 255);
        assert_eq!(px[1], 0);
        assert_eq!(px[2], 0);
        assert_eq!(px[3], 255);
        assert!(layer.dirty);
    }

    #[test]
    fn test_stamp_ellipse_outside_is_transparent() {
        let mut layer = Layer::new(0, 10, 10);
        stamp_ellipse(
            &mut layer,
            5.0,
            5.0,
            1.0,
            Color::new(255, 0, 0),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        // Far corner should be transparent
        let px = layer.pixel(0, 0).unwrap();
        assert_eq!(px[3], 0);
    }

    #[test]
    fn test_interpolation_spacing() {
        let mut layer = Layer::new(0, 100, 10);
        let brush = BrushSettings {
            size: 4.0,
            spacing: 0.25, // step = 1.0 pixel
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            ..Default::default()
        };

        // Draw a horizontal line of 10 pixels
        let residual = interpolate_and_stamp(
            &mut layer,
            0.0,
            5.0,
            1.0,
            10.0,
            5.0,
            1.0,
            &brush,
            0.0,
            None,
            None,
            None,
            None,
            &mut Rng::from_coords(0.0, 5.0),
            0.0,
        );
        assert!(residual >= 0.0);
        // step=1.0, segment=10.0, stamps at 0,1,...,10 -> next at 11, residual=1.0
        assert!(residual <= 1.01, "residual={residual}");

        // Check that there are stamps along the line
        // With step=1.0 and segment_len=10.0, we should get stamps at t=0,1,2,...,10
        let px = layer.pixel(5, 5).unwrap();
        assert!(px[3] > 0, "Should have drawn at midpoint");
    }

    #[test]
    fn test_stroke_lifecycle() {
        let mut layer = Layer::new(0, 50, 50);
        let mut state = StrokeState::new();
        let brush = BrushSettings::default();

        stroke_begin(
            &mut layer, &mut state, &brush, 10.0, 10.0, 1.0, None, None, None, None,
        );
        assert!(state.active);
        assert!(layer.dirty);

        stroke_move(
            &mut layer, &mut state, &brush, 20.0, 10.0, 1.0, None, None, None, None,
        );
        assert!(state.active);

        stroke_end(&mut state);
        assert!(!state.active);
        assert!(state.last_point.is_none());
    }

    #[test]
    fn test_pressure_affects_radius() {
        let mut layer_full = Layer::new(0, 20, 20);
        let mut layer_half = Layer::new(0, 20, 20);

        // Full pressure stamp
        stamp_ellipse(
            &mut layer_full,
            10.0,
            10.0,
            5.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        // Half pressure stamp (radius 2.5)
        stamp_ellipse(
            &mut layer_half,
            10.0,
            10.0,
            2.5,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        // Count non-transparent pixels
        let count_full: usize = (0..20)
            .flat_map(|y| (0..20).map(move |x| (x, y)))
            .filter(|&(x, y)| layer_full.pixel(x, y).unwrap()[3] > 0)
            .count();

        let count_half: usize = (0..20)
            .flat_map(|y| (0..20).map(move |x| (x, y)))
            .filter(|&(x, y)| layer_half.pixel(x, y).unwrap()[3] > 0)
            .count();

        assert!(
            count_full > count_half,
            "Full pressure should cover more pixels"
        );
    }

    #[test]
    fn test_flow_affects_alpha() {
        let mut layer = Layer::new(0, 10, 10);
        stamp_ellipse(
            &mut layer,
            5.0,
            5.0,
            3.0,
            Color::black(),
            0.5,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        let px = layer.pixel(5, 5).unwrap();
        // With flow=0.5, center alpha should be about 128
        assert!((px[3] as f32 - 128.0).abs() < 2.0);
    }

    #[test]
    fn test_stamp_ellipse_zero_radius_noop() {
        let mut layer = Layer::new(0, 10, 10);
        stamp_ellipse(
            &mut layer,
            5.0,
            5.0,
            0.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );
        assert!(!layer.dirty);
    }

    #[test]
    fn test_residual_distance_carries_over() {
        let mut layer = Layer::new(0, 100, 10);
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.5, // at pressure=1.0: effective_size=10, step=5.0
            ..Default::default()
        };

        // First segment: 7 pixels long, step=5, stamps at 0 and 5, next at 10 -> residual=10-7=3
        let mut rng = Rng::from_coords(0.0, 5.0);
        let residual = interpolate_and_stamp(
            &mut layer, 0.0, 5.0, 1.0, 7.0, 5.0, 1.0, &brush, 0.0, None, None, None, None,
            &mut rng, 0.0,
        );
        assert!(
            (residual - 3.0).abs() < 0.01,
            "residual should be ~3.0, got {}",
            residual
        );

        // Second segment: 7 pixels, starting with residual=3, stamp at 3, next at 8 -> residual=8-7=1
        let residual2 = interpolate_and_stamp(
            &mut layer, 7.0, 5.0, 1.0, 14.0, 5.0, 1.0, &brush, residual, None, None, None, None,
            &mut rng, 0.0,
        );
        assert!(
            (residual2 - 1.0).abs() < 0.01,
            "residual should be ~1.0, got {}",
            residual2
        );
    }

    #[test]
    fn test_size_constant_without_dynamics() {
        // With default dynamics (Off), pressure should NOT affect stamp size.
        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.5,
            ..Default::default()
        };

        let mut layer_low = Layer::new(0, 200, 20);
        interpolate_and_stamp(
            &mut layer_low,
            0.0,
            10.0,
            0.25,
            100.0,
            10.0,
            0.25,
            &brush,
            0.0,
            None,
            None,
            None,
            None,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
        );
        let mut layer_high = Layer::new(0, 200, 20);
        interpolate_and_stamp(
            &mut layer_high,
            0.0,
            10.0,
            1.0,
            100.0,
            10.0,
            1.0,
            &brush,
            0.0,
            None,
            None,
            None,
            None,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
        );

        let cols_drawn = |layer: &Layer| -> usize {
            (0..200)
                .filter(|&x| (0..20u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0))
                .count()
        };

        assert_eq!(
            cols_drawn(&layer_low),
            cols_drawn(&layer_high),
            "Without dynamics, pressure should not affect size"
        );
    }

    #[test]
    fn test_size_varies_with_pressure_dynamics() {
        use crate::dynamics::{DynamicControl, DynamicParam, ShapeDynamics};

        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.5,
            shape_dynamics: ShapeDynamics {
                size: DynamicParam {
                    jitter: 1.0,
                    control: DynamicControl::PenPressure,
                    minimum: 0.0,
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let mut layer_low = Layer::new(0, 200, 20);
        interpolate_and_stamp(
            &mut layer_low,
            0.0,
            10.0,
            0.25,
            100.0,
            10.0,
            0.25,
            &brush,
            0.0,
            None,
            None,
            None,
            None,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
        );
        let mut layer_high = Layer::new(0, 200, 20);
        interpolate_and_stamp(
            &mut layer_high,
            0.0,
            10.0,
            1.0,
            100.0,
            10.0,
            1.0,
            &brush,
            0.0,
            None,
            None,
            None,
            None,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
        );

        let cols_drawn = |layer: &Layer| -> usize {
            (0..200)
                .filter(|&x| (0..20u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0))
                .count()
        };

        let low_cols = cols_drawn(&layer_low);
        let high_cols = cols_drawn(&layer_high);
        assert!(
            high_cols > low_cols,
            "With pressure dynamics, high pressure ({high_cols} cols) should cover more than low ({low_cols} cols)"
        );
    }

    #[test]
    fn test_stamps_along_full_stroke() {
        let mut layer = Layer::new(0, 200, 20);
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.5,
            ..Default::default()
        };

        interpolate_and_stamp(
            &mut layer,
            0.0,
            10.0,
            1.0,
            100.0,
            10.0,
            1.0,
            &brush,
            0.0,
            None,
            None,
            None,
            None,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
        );

        let first_quarter_has_stamps =
            (0..25u32).any(|x| (0..20u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0));
        assert!(
            first_quarter_has_stamps,
            "Should have stamps in first quarter"
        );

        let last_quarter_has_stamps =
            (75..100u32).any(|x| (0..20u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0));
        assert!(
            last_quarter_has_stamps,
            "Should have stamps in last quarter"
        );
    }

    #[test]
    fn test_stamp_ellipse_clipped_by_selection() {
        let mut layer = Layer::new(0, 20, 20);
        // Selection: only the right half (x >= 10) is selected
        let mut mask = vec![0u8; 20 * 20];
        for y in 0..20u32 {
            for x in 10..20u32 {
                mask[(y * 20 + x) as usize] = 255;
            }
        }

        stamp_ellipse(
            &mut layer,
            10.0,
            10.0,
            5.0,
            Color::new(255, 0, 0),
            1.0,
            1.0,
            1.0,
            0.0,
            Some(&mask),
            None,
            None,
        );

        // Pixel at (12, 10) is in the selection — should be painted
        let px_in = layer.pixel(12, 10).unwrap();
        assert!(px_in[3] > 0, "Selected pixel should be painted");

        // Pixel at (7, 10) is outside the selection — should NOT be painted
        let px_out = layer.pixel(7, 10).unwrap();
        assert_eq!(px_out[3], 0, "Unselected pixel should remain transparent");
    }

    #[test]
    fn test_stroke_opacity_caps_alpha() {
        // With opacity=0.5 and flow=1.0, even overlapping stamps in a single
        // stroke should not produce alpha above ~128.
        let mut layer = Layer::new(0, 50, 50);
        let mut state = StrokeState::new();
        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.1,
            color: Color::black(),
            opacity: 0.5,
            flow: 1.0,
            ..Default::default()
        };

        // Draw a short stroke to get many overlapping stamps
        stroke_begin(
            &mut layer, &mut state, &brush, 25.0, 25.0, 1.0, None, None, None, None,
        );
        stroke_move(
            &mut layer, &mut state, &brush, 30.0, 25.0, 1.0, None, None, None, None,
        );
        stroke_end(&mut state);

        // Center pixel alpha should be capped at ~128 (0.5 * 255)
        let px = layer.pixel(25, 25).unwrap();
        assert!(px[3] > 0, "Should have drawn something");
        assert!(
            px[3] <= 130,
            "Alpha {} should be capped at ~128 by stroke opacity 0.5",
            px[3]
        );
    }

    #[test]
    fn test_stroke_opacity_does_not_change_layer_opacity() {
        let mut layer = Layer::new(0, 50, 50);
        let mut state = StrokeState::new();
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.25,
            color: Color::black(),
            opacity: 0.3,
            flow: 1.0,
            ..Default::default()
        };

        let opacity_before = layer.opacity;
        stroke_begin(
            &mut layer, &mut state, &brush, 25.0, 25.0, 1.0, None, None, None, None,
        );
        stroke_end(&mut state);

        // Layer opacity should remain unchanged
        assert_eq!(layer.opacity, opacity_before);
    }

    #[test]
    fn test_erase_blend_mode_removes_pixels() {
        // Paint some content first with normal blend mode
        let mut layer = Layer::new(0, 50, 50);
        let mut state = StrokeState::new();
        let paint_brush = BrushSettings {
            size: 20.0,
            spacing: 0.1,
            color: Color::new(255, 0, 0),
            opacity: 1.0,
            flow: 1.0,
            blend_mode: BlendMode::Normal,
            hardness: 1.0,
            roundness: 1.0,
            angle: 0.0,
            ..Default::default()
        };

        stroke_begin(
            &mut layer,
            &mut state,
            &paint_brush,
            25.0,
            25.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_end(&mut state);

        // Verify center pixel is painted
        let px = layer.pixel(25, 25).unwrap();
        assert!(
            px[3] > 200,
            "Should be nearly opaque after painting: a={}",
            px[3]
        );

        // Now erase with DstOut blend mode
        let erase_brush = BrushSettings {
            size: 20.0,
            spacing: 0.1,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            blend_mode: BlendMode::DstOut,
            hardness: 1.0,
            roundness: 1.0,
            angle: 0.0,
            ..Default::default()
        };

        stroke_begin(
            &mut layer,
            &mut state,
            &erase_brush,
            25.0,
            25.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_end(&mut state);

        // Center pixel should be erased (alpha near 0)
        let px = layer.pixel(25, 25).unwrap();
        assert!(px[3] < 10, "Should be erased: a={}", px[3]);
    }

    #[test]
    fn test_erase_partial_opacity() {
        // Paint fully opaque content
        let mut layer = Layer::new(0, 50, 50);
        let mut state = StrokeState::new();
        let paint_brush = BrushSettings::default();

        stroke_begin(
            &mut layer,
            &mut state,
            &paint_brush,
            25.0,
            25.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_end(&mut state);

        let alpha_before = layer.pixel(25, 25).unwrap()[3];
        assert!(alpha_before > 200);

        // Erase at half opacity — should partially remove
        let erase_brush = BrushSettings {
            size: 20.0,
            spacing: 0.1,
            opacity: 0.5,
            flow: 1.0,
            blend_mode: BlendMode::DstOut,
            ..Default::default()
        };

        stroke_begin(
            &mut layer,
            &mut state,
            &erase_brush,
            25.0,
            25.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_end(&mut state);

        let alpha_after = layer.pixel(25, 25).unwrap()[3];
        assert!(
            alpha_after < alpha_before,
            "Should have reduced alpha: before={alpha_before} after={alpha_after}"
        );
        assert!(
            alpha_after > 10,
            "Should not be fully erased at half opacity: a={alpha_after}"
        );
    }

    #[test]
    fn test_dirty_bounds_incremental_after_clear() {
        // Verify that dirty bounds represent only the latest segment after clear_dirty
        let mut layer = Layer::new(0, 200, 200);
        let mut state = StrokeState::new();
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.25,
            ..Default::default()
        };

        // Begin stroke at (10, 100)
        stroke_begin(
            &mut layer, &mut state, &brush, 10.0, 100.0, 1.0, None, None, None, None,
        );
        let _bounds1 = layer.dirty_bounds.unwrap();

        // Clear dirty to simulate syncLayer
        layer.clear_dirty();
        assert!(layer.dirty_bounds.is_none());

        // Move to (50, 100) — far from start
        stroke_move(
            &mut layer, &mut state, &brush, 50.0, 100.0, 1.0, None, None, None, None,
        );
        let bounds2 = layer.dirty_bounds.unwrap();

        // Clear dirty again
        layer.clear_dirty();

        // Move to (190, 100) — far from previous
        stroke_move(
            &mut layer, &mut state, &brush, 190.0, 100.0, 1.0, None, None, None, None,
        );
        let bounds3 = layer.dirty_bounds.unwrap();

        // bounds3 should NOT include x=10 (the stroke start)
        // It should only cover the segment from x=50 to x=190
        assert!(
            bounds3.0 > 40,
            "Dirty x_min should not reach back to stroke start, got {}",
            bounds3.0
        );
        // And should not include the first segment either
        assert!(
            bounds2.0 < bounds3.0 || bounds2.2 < bounds3.2,
            "Each segment should have different dirty bounds after clear"
        );
    }

    #[test]
    fn test_hardness_one_is_hard_edge() {
        // With hardness=1.0, center pixel should be fully opaque
        let mut layer = Layer::new(0, 20, 20);
        stamp_ellipse(
            &mut layer,
            10.0,
            10.0,
            5.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        let center = layer.pixel(10, 10).unwrap()[3];
        assert_eq!(center, 255, "Center should be fully opaque at hardness=1.0");

        // Pixel just inside the radius should also be opaque
        let inner = layer.pixel(12, 10).unwrap()[3];
        assert!(
            inner > 200,
            "Inner pixel should be nearly opaque at hardness=1.0, got {inner}"
        );
    }

    #[test]
    fn test_hardness_zero_is_soft_edge() {
        // With hardness=0.0, there should be a gradient from center to edge
        let mut layer = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer,
            20.0,
            20.0,
            10.0,
            Color::black(),
            1.0,
            0.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        let center = layer.pixel(20, 20).unwrap()[3];
        assert!(
            center > 200,
            "Center should still be bright at hardness=0.0, got {center}"
        );

        // Pixel at ~half radius should have reduced alpha
        let mid = layer.pixel(25, 20).unwrap()[3];
        assert!(
            mid < center,
            "Mid-radius pixel ({mid}) should be less than center ({center})"
        );
        assert!(mid > 0, "Mid-radius pixel should not be zero");

        // Pixel near the edge should be very faint
        let edge = layer.pixel(29, 20).unwrap()[3];
        assert!(
            edge < mid,
            "Edge pixel ({edge}) should be less than mid ({mid})"
        );
    }

    #[test]
    fn test_hardness_half_intermediate_falloff() {
        // With hardness=0.5, falloff starts at r*0.5 = 5.0
        let mut layer_hard = Layer::new(0, 40, 40);
        let mut layer_soft = Layer::new(0, 40, 40);
        let mut layer_mid = Layer::new(0, 40, 40);

        stamp_ellipse(
            &mut layer_hard,
            20.0,
            20.0,
            10.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );
        stamp_ellipse(
            &mut layer_soft,
            20.0,
            20.0,
            10.0,
            Color::black(),
            1.0,
            0.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );
        stamp_ellipse(
            &mut layer_mid,
            20.0,
            20.0,
            10.0,
            Color::black(),
            1.0,
            0.5,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        // At mid-radius, mid-hardness should be between hard and soft
        let hard_mid = layer_hard.pixel(25, 20).unwrap()[3];
        let soft_mid = layer_soft.pixel(25, 20).unwrap()[3];
        let mid_mid = layer_mid.pixel(25, 20).unwrap()[3];

        assert!(
            mid_mid >= soft_mid && mid_mid <= hard_mid,
            "h=0.5 alpha ({mid_mid}) should be between h=0.0 ({soft_mid}) and h=1.0 ({hard_mid})"
        );
    }

    #[test]
    fn test_roundness_creates_ellipse() {
        // With roundness=0.5, the brush should be taller than wide
        // (squashed along the y-axis after inverse transform)
        let mut layer = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            0.5,
            0.0,
            None,
            None,
            None,
        );

        // Along x-axis (should reach ~8px from center): pixel at (27, 20) should be painted
        let along_x = layer.pixel(27, 20).unwrap()[3];
        assert!(
            along_x > 0,
            "Should paint along x-axis at radius, got {along_x}"
        );

        // Along y-axis (should only reach ~4px from center): pixel at (20, 27) should NOT be painted
        let along_y = layer.pixel(20, 27).unwrap()[3];
        assert_eq!(
            along_y, 0,
            "Should not paint far along y-axis with roundness=0.5, got {along_y}"
        );

        // But pixel at (20, 23) should be painted (within 4px)
        let along_y_close = layer.pixel(20, 23).unwrap()[3];
        assert!(
            along_y_close > 0,
            "Should paint close along y-axis, got {along_y_close}"
        );
    }

    #[test]
    fn test_angle_rotates_ellipse() {
        // With roundness=0.5 and angle=90, the ellipse rotates:
        // the narrow axis that was along y is now along x
        let mut layer = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            0.5,
            90.0,
            None,
            None,
            None,
        );

        // After 90° rotation, the long axis is now along y, short axis along x
        // Along y-axis (long): pixel at (20, 27) should now be painted
        let along_y = layer.pixel(20, 27).unwrap()[3];
        assert!(
            along_y > 0,
            "Should paint along y-axis when rotated 90°, got {along_y}"
        );

        // Along x-axis (short): pixel at (27, 20) should NOT be painted
        let along_x = layer.pixel(27, 20).unwrap()[3];
        assert_eq!(
            along_x, 0,
            "Should not paint far along x-axis when rotated 90°, got {along_x}"
        );
    }

    #[test]
    fn test_angle_direction_is_ccw_on_screen() {
        // Use an asymmetric tip: opaque on the right half, transparent on the left.
        // At angle=0, right-of-center should be painted, left should not.
        // At angle=90 (CCW on screen, Y-down), the right half rotates upward:
        //   above center → painted, below center → not painted.
        let mut pixels = vec![0u8; 64]; // 8x8
        for row in 0..8u32 {
            for col in 4..8u32 {
                pixels[(row * 8 + col) as usize] = 255;
            }
        }
        let tip = BrushTip {
            pixels,
            width: 8,
            height: 8,
        };

        // angle=0: right side painted, left side not
        let mut layer0 = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer0,
            20.0,
            20.0,
            8.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            false,
            false,
            None,
            None,
            None,
        );
        let right = layer0.pixel(24, 20).unwrap()[3];
        let left = layer0.pixel(16, 20).unwrap()[3];
        assert!(
            right > 0,
            "At angle=0, right of center should be painted, got {right}"
        );
        assert_eq!(
            left, 0,
            "At angle=0, left of center should be transparent, got {left}"
        );

        // angle=90 CCW: the opaque right half should now appear above center
        let mut layer90 = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer90,
            20.0,
            20.0,
            8.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            90.0,
            false,
            false,
            None,
            None,
            None,
        );
        let above = layer90.pixel(20, 16).unwrap()[3];
        let below = layer90.pixel(20, 24).unwrap()[3];
        assert!(
            above > 0,
            "At angle=90 CCW, above center should be painted, got {above}"
        );
        assert_eq!(
            below, 0,
            "At angle=90 CCW, below center should be transparent, got {below}"
        );
    }

    #[test]
    fn test_stamp_tip_basic() {
        // Create a 4x4 fully-opaque brush tip
        let tip = BrushTip {
            pixels: vec![255; 16],
            width: 4,
            height: 4,
        };
        let mut layer = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer,
            20.0,
            20.0,
            5.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            false,
            false,
            None,
            None,
            None,
        );

        // Center should be painted
        let center = layer.pixel(20, 20).unwrap()[3];
        assert!(
            center > 200,
            "Center should be painted with full tip, got {center}"
        );
    }

    #[test]
    fn test_stamp_tip_respects_mask() {
        // Create a tip that is opaque on left half, transparent on right half
        let mut pixels = vec![0u8; 16];
        // rows are 4 wide; left 2 cols opaque
        for row in 0..4u32 {
            pixels[(row * 4) as usize] = 255;
            pixels[(row * 4 + 1) as usize] = 255;
        }
        let tip = BrushTip {
            pixels,
            width: 4,
            height: 4,
        };
        let mut layer = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer,
            20.0,
            20.0,
            5.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            false,
            false,
            None,
            None,
            None,
        );

        // Left of center should be painted
        let left = layer.pixel(17, 20).unwrap()[3];
        assert!(left > 0, "Left side should be painted, got {left}");

        // Right of center should NOT be painted (transparent in tip)
        let right = layer.pixel(23, 20).unwrap()[3];
        assert_eq!(right, 0, "Right side should be transparent, got {right}");
    }

    #[test]
    fn test_stamp_tip_flip_x() {
        // Create a tip that is opaque on left half, transparent on right half
        let mut pixels = vec![0u8; 16];
        for row in 0..4u32 {
            pixels[(row * 4) as usize] = 255;
            pixels[(row * 4 + 1) as usize] = 255;
        }
        let tip = BrushTip {
            pixels: pixels.clone(),
            width: 4,
            height: 4,
        };

        // Without flip: left side painted, right side transparent
        let mut layer_no_flip = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer_no_flip,
            20.0,
            20.0,
            5.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            false,
            false,
            None,
            None,
            None,
        );

        // With flip_x: right side painted, left side transparent
        let mut layer_flip_x = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer_flip_x,
            20.0,
            20.0,
            5.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            true,
            false,
            None,
            None,
            None,
        );

        let left_no_flip = layer_no_flip.pixel(17, 20).unwrap()[3];
        let right_no_flip = layer_no_flip.pixel(23, 20).unwrap()[3];
        let left_flip = layer_flip_x.pixel(17, 20).unwrap()[3];
        let right_flip = layer_flip_x.pixel(23, 20).unwrap()[3];

        assert!(left_no_flip > 0, "Without flip, left should be painted");
        assert_eq!(
            right_no_flip, 0,
            "Without flip, right should be transparent"
        );
        assert_eq!(left_flip, 0, "With flip_x, left should be transparent");
        assert!(right_flip > 0, "With flip_x, right should be painted");
    }

    #[test]
    fn test_stamp_tip_flip_y() {
        // Create a tip that is opaque on top half, transparent on bottom half
        let mut pixels = vec![0u8; 16];
        for col in 0..4u32 {
            pixels[col as usize] = 255; // row 0
            pixels[(4 + col) as usize] = 255; // row 1
        }
        let tip = BrushTip {
            pixels,
            width: 4,
            height: 4,
        };

        // Without flip: top painted, bottom transparent
        let mut layer_no_flip = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer_no_flip,
            20.0,
            20.0,
            5.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            false,
            false,
            None,
            None,
            None,
        );

        // With flip_y: bottom painted, top transparent
        let mut layer_flip_y = Layer::new(0, 40, 40);
        stamp_tip(
            &mut layer_flip_y,
            20.0,
            20.0,
            5.0,
            &tip,
            Color::black(),
            1.0,
            1.0,
            0.0,
            false,
            true,
            None,
            None,
            None,
        );

        let top_no_flip = layer_no_flip.pixel(20, 17).unwrap()[3];
        let bottom_no_flip = layer_no_flip.pixel(20, 23).unwrap()[3];
        let top_flip = layer_flip_y.pixel(20, 17).unwrap()[3];
        let bottom_flip = layer_flip_y.pixel(20, 23).unwrap()[3];

        assert!(top_no_flip > 0, "Without flip, top should be painted");
        assert_eq!(
            bottom_no_flip, 0,
            "Without flip, bottom should be transparent"
        );
        assert_eq!(top_flip, 0, "With flip_y, top should be transparent");
        assert!(bottom_flip > 0, "With flip_y, bottom should be painted");
    }

    #[test]
    fn test_scatter_offsets_stamps_perpendicular_to_stroke() {
        // Without scatter, a horizontal stroke should only paint near y=100.
        // With scatter, stamps should appear at varying y positions.
        let mut layer_no_scatter = Layer::new(0, 200, 200);
        let mut state = StrokeState::new();
        let brush = BrushSettings {
            size: 6.0,
            spacing: 0.25,
            ..Default::default()
        };

        stroke_begin(
            &mut layer_no_scatter,
            &mut state,
            &brush,
            20.0,
            100.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_move(
            &mut layer_no_scatter,
            &mut state,
            &brush,
            180.0,
            100.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_end(&mut state);

        // Without scatter, pixels far from y=100 should be transparent
        let far_y_no_scatter = layer_no_scatter.pixel(100, 130).unwrap()[3];
        assert_eq!(
            far_y_no_scatter, 0,
            "Without scatter, y=130 should be empty"
        );

        // With scatter, some stamps should land away from the stroke center
        let mut layer_scatter = Layer::new(0, 200, 200);
        let mut state = StrokeState::new();
        let scatter_brush = BrushSettings {
            size: 6.0,
            spacing: 0.25,
            scatter: ScatterSettings {
                scatter: 5.0, // large scatter
                both_axes: false,
                count: 3,
                count_jitter: 0.0,
            },
            ..Default::default()
        };

        stroke_begin(
            &mut layer_scatter,
            &mut state,
            &scatter_brush,
            20.0,
            100.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_move(
            &mut layer_scatter,
            &mut state,
            &scatter_brush,
            180.0,
            100.0,
            1.0,
            None,
            None,
            None,
            None,
        );
        stroke_end(&mut state);

        // With high scatter and count=3, there should be painted pixels away from center
        let mut found_offset = false;
        for y in 0..200 {
            if (y as i32 - 100).unsigned_abs() > 10 {
                for x in (20..180).step_by(5) {
                    if layer_scatter.pixel(x, y).unwrap()[3] > 0 {
                        found_offset = true;
                        break;
                    }
                }
            }
            if found_offset {
                break;
            }
        }
        assert!(
            found_offset,
            "Scatter should produce stamps offset from the stroke path"
        );
    }

    #[test]
    fn test_dual_brush_modulates_alpha() {
        // Without dual brush, center pixel should be fully opaque
        let mut layer_no_dual = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_no_dual,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );
        let center_no_dual = layer_no_dual.pixel(20, 20).unwrap()[3];
        assert_eq!(
            center_no_dual, 255,
            "Without dual brush, center should be fully opaque"
        );

        // With dual brush using a small secondary tip, pixels far from center
        // should have reduced alpha due to secondary tip falloff
        let sec = SecondaryTipState::Computed { hardness: 1.0 };
        let mut layer_dual = Layer::new(0, 40, 40);
        // Secondary radius = 3px (much smaller than primary radius = 8px)
        stamp_ellipse(
            &mut layer_dual,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            Some((&sec, 3.0, DualBrushMode::Multiply)),
            None,
        );
        let center_dual = layer_dual.pixel(20, 20).unwrap()[3];
        assert!(
            center_dual > 200,
            "With dual brush, center should still be opaque"
        );

        // Pixel at (26, 20) is 6px from center — outside secondary radius (3px)
        let far_dual = layer_dual.pixel(26, 20).unwrap()[3];
        let far_no_dual = layer_no_dual.pixel(26, 20).unwrap()[3];
        assert!(
            far_no_dual > 0,
            "Without dual, pixel at (26,20) should be painted"
        );
        assert_eq!(
            far_dual, 0,
            "With dual, pixel beyond secondary radius should be transparent"
        );
    }

    #[test]
    fn test_texture_modulates_alpha() {
        // Create a checkerboard pattern: alternating 0 and 255
        let mut pattern_pixels = vec![0u8; 4 * 4];
        for y in 0..4u32 {
            for x in 0..4u32 {
                pattern_pixels[(y * 4 + x) as usize] = if (x + y) % 2 == 0 { 255 } else { 0 };
            }
        }
        let pattern = BrushTip {
            pixels: pattern_pixels,
            width: 4,
            height: 4,
        };

        let tex_settings = TextureSettings {
            enabled: true,
            scale: 100.0,
            depth: 1.0,
            texture_each_tip: false,
        };

        // Stamp without texture
        let mut layer_no_tex = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_no_tex,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        // Stamp with texture
        let mut layer_tex = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_tex,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            Some((&tex_settings, &pattern)),
        );

        // Without texture, center should be fully opaque
        let no_tex_center = layer_no_tex.pixel(20, 20).unwrap()[3];
        assert_eq!(no_tex_center, 255);

        // With texture, some pixels should have reduced alpha (where pattern is 0)
        // Count pixels with alpha < 255 within the stamp radius
        let mut reduced_count = 0u32;
        let mut total_painted = 0u32;
        for y in 12..28u32 {
            for x in 12..28u32 {
                let a_no_tex = layer_no_tex.pixel(x, y).unwrap()[3];
                let a_tex = layer_tex.pixel(x, y).unwrap()[3];
                if a_no_tex > 0 {
                    total_painted += 1;
                    if a_tex < a_no_tex {
                        reduced_count += 1;
                    }
                }
            }
        }
        assert!(total_painted > 0, "Should have painted pixels");
        assert!(
            reduced_count > 0,
            "Texture should reduce alpha on some pixels"
        );
    }

    #[test]
    fn test_texture_depth_zero_has_no_effect() {
        let pattern = BrushTip {
            pixels: vec![0; 4 * 4], // All-black pattern
            width: 4,
            height: 4,
        };

        let tex_settings = TextureSettings {
            enabled: true,
            scale: 100.0,
            depth: 0.0, // No effect
            texture_each_tip: false,
        };

        let mut layer_no_tex = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_no_tex,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        let mut layer_tex = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_tex,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            Some((&tex_settings, &pattern)),
        );

        // With depth=0, texture should have no effect
        for y in 12..28u32 {
            for x in 12..28u32 {
                assert_eq!(
                    layer_no_tex.pixel(x, y).unwrap()[3],
                    layer_tex.pixel(x, y).unwrap()[3],
                    "At ({x},{y}) depth=0 should have no effect"
                );
            }
        }
    }

    #[test]
    fn test_dual_brush_mode_apply() {
        // Multiply: primary * secondary
        assert!((DualBrushMode::Multiply.apply(0.8, 0.5) - 0.4).abs() < 0.001);

        // Darken: min
        assert!((DualBrushMode::Darken.apply(0.8, 0.5) - 0.5).abs() < 0.001);
        assert!((DualBrushMode::Darken.apply(0.3, 0.7) - 0.3).abs() < 0.001);

        // Lighten: max
        assert!((DualBrushMode::Lighten.apply(0.8, 0.5) - 0.8).abs() < 0.001);
        assert!((DualBrushMode::Lighten.apply(0.3, 0.7) - 0.7).abs() < 0.001);

        // Subtract: primary - secondary, clamped to 0
        assert!((DualBrushMode::Subtract.apply(0.8, 0.3) - 0.5).abs() < 0.001);
        assert!((DualBrushMode::Subtract.apply(0.3, 0.8) - 0.0).abs() < 0.001);

        // LinearDodge: primary + secondary * (1 - primary)
        assert!((DualBrushMode::LinearDodge.apply(0.5, 0.5) - 0.75).abs() < 0.001);
        assert!((DualBrushMode::LinearDodge.apply(1.0, 1.0) - 1.0).abs() < 0.001);

        // Screen: 1 - (1-p)(1-s)
        assert!((DualBrushMode::Screen.apply(0.5, 0.5) - 0.75).abs() < 0.001);
        assert!((DualBrushMode::Screen.apply(0.0, 0.0) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_dual_brush_mode_from_u8() {
        assert_eq!(DualBrushMode::from_u8(0), DualBrushMode::Multiply);
        assert_eq!(DualBrushMode::from_u8(1), DualBrushMode::Darken);
        assert_eq!(DualBrushMode::from_u8(2), DualBrushMode::Lighten);
        assert_eq!(DualBrushMode::from_u8(3), DualBrushMode::Subtract);
        assert_eq!(DualBrushMode::from_u8(4), DualBrushMode::LinearDodge);
        assert_eq!(DualBrushMode::from_u8(5), DualBrushMode::Screen);
        assert_eq!(DualBrushMode::from_u8(255), DualBrushMode::Multiply); // unknown falls back
    }

    #[test]
    fn test_dual_brush_lighten_mode_preserves_primary() {
        // With Lighten mode, the combined alpha should be >= the primary's edge_alpha,
        // so the result should be at least as opaque as without dual brush
        let sec = SecondaryTipState::Computed { hardness: 1.0 };

        let mut layer_no_dual = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_no_dual,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            None,
            None,
        );

        let mut layer_lighten = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer_lighten,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            Some((&sec, 3.0, DualBrushMode::Lighten)),
            None,
        );

        // At the center, secondary is fully opaque, so max(primary, secondary) = primary
        let center_no_dual = layer_no_dual.pixel(20, 20).unwrap()[3];
        let center_lighten = layer_lighten.pixel(20, 20).unwrap()[3];
        assert_eq!(
            center_no_dual, center_lighten,
            "Lighten at center should match no-dual"
        );

        // At the edge (outside secondary radius), Lighten should take max(edge_alpha, 0) = edge_alpha
        // So the result should match the no-dual case at the edges
        let edge_no_dual = layer_no_dual.pixel(26, 20).unwrap()[3];
        let edge_lighten = layer_lighten.pixel(26, 20).unwrap()[3];
        assert_eq!(
            edge_no_dual, edge_lighten,
            "Lighten at edge should match no-dual"
        );
    }

    #[test]
    fn test_dual_brush_subtract_mode() {
        let sec = SecondaryTipState::Computed { hardness: 1.0 };

        // With Subtract mode, center pixels (where secondary is opaque) should have
        // reduced alpha: max(0, primary - 1.0) = 0
        let mut layer = Layer::new(0, 40, 40);
        stamp_ellipse(
            &mut layer,
            20.0,
            20.0,
            8.0,
            Color::black(),
            1.0,
            1.0,
            1.0,
            0.0,
            None,
            Some((&sec, 8.0, DualBrushMode::Subtract)),
            None,
        );

        let center = layer.pixel(20, 20).unwrap()[3];
        assert_eq!(
            center, 0,
            "Subtract with fully opaque secondary should produce zero alpha"
        );
    }
}
