use serde::{Deserialize, Serialize};

use crate::blend_mode::{porter_duff_composite, BlendMode};
use crate::color::{blend_pixel, Color};
use crate::dynamics::{Rng, ShapeDynamics, TransferDynamics};
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

/// Sample the secondary tip alpha at a given canvas position, relative to stamp center.
/// Returns 1.0 if no secondary tip modulation.
pub(crate) fn sample_secondary_tip(
    px: f32,
    py: f32,
    cx: f32,
    cy: f32,
    radius: f32,
    angle: f32,
    roundness: f32,
    secondary: &SecondaryTipState,
) -> f32 {
    let dx = px - cx;
    let dy = py - cy;

    let transform = TipTransform::new(angle, roundness);
    let (rx, ry) = transform.transform(dx, dy);
    let dist = (rx * rx + ry * ry).sqrt();

    if dist > radius + 0.5 {
        return 0.0;
    }

    match secondary {
        SecondaryTipState::Computed { hardness } => smoothstep_falloff(dist, radius, *hardness),
        SecondaryTipState::Image(tip) => sample_tip_alpha(tip, rx, ry, radius, false, false),
    }
}

/// State for the secondary (dual) brush tip during stamping.
pub(crate) enum SecondaryTipState<'a> {
    Computed { hardness: f32 },
    Image(&'a BrushTip),
}

/// A resolved dual-brush stamp instance: position, radius, angle, and roundness in canvas coordinates.
#[derive(Debug, Clone)]
pub struct DualStampInstance {
    pub cx: f32,
    pub cy: f32,
    pub radius: f32,
    pub angle: f32,
    pub roundness: f32,
}

/// Compute all secondary (dual brush) stamp instances that could overlap
/// a primary stamp at the given position.
///
/// The dual brush has its own spacing along the stroke path. We approximate
/// the stroke path as a line through the primary stamp center in the given
/// direction, then find all dual stamp indices whose footprint intersects
/// the primary stamp. Each index gets deterministic scatter via `Rng::from_index`.
pub fn compute_dual_stamps(
    primary_cx: f32,
    primary_cy: f32,
    primary_radius: f32,
    stroke_distance: f32,
    dir_x: f32,
    dir_y: f32,
    dual: &DualBrushSettings,
    stroke_seed: u32,
) -> Vec<DualStampInstance> {
    let mut instances = Vec::new();
    if !dual.enabled {
        return instances;
    }

    let dual_radius = dual.size / 2.0;
    let dual_step = (dual.spacing * dual.size).max(1.0);

    // Maximum distance a scattered dual stamp can be offset from its base position
    let max_scatter = dual.scatter * dual.size;

    // Search range along the stroke line: any dual stamp whose center (after scatter)
    // could overlap the primary stamp's bounding circle.
    let search = primary_radius + dual_radius + max_scatter;

    // Perpendicular direction for scatter
    let perp_x = -dir_y;
    let perp_y = dir_x;

    let n_start = ((stroke_distance - search) / dual_step).floor().max(0.0) as u32;
    let n_end = ((stroke_distance + search) / dual_step).ceil().max(0.0) as u32;

    let count = dual.count.max(1);

    for n in n_start..=n_end {
        let base_offset = n as f32 * dual_step - stroke_distance;

        for c in 0..count {
            let mut rng = Rng::from_index(stroke_seed, n, c);

            // Scatter offset
            let (scatter_along, scatter_perp) = if dual.scatter > 0.0 {
                let perp_off = (rng.next_f32() * 2.0 - 1.0) * max_scatter;
                let along_off = if dual.both_axes {
                    (rng.next_f32() * 2.0 - 1.0) * max_scatter
                } else {
                    0.0
                };
                (along_off, perp_off)
            } else {
                (0.0, 0.0)
            };

            let total_along = base_offset + scatter_along;
            let cx = primary_cx + total_along * dir_x + scatter_perp * perp_x;
            let cy = primary_cy + total_along * dir_y + scatter_perp * perp_y;

            // Quick rejection: is this instance close enough to potentially overlap?
            let dx = cx - primary_cx;
            let dy = cy - primary_cy;
            let dist_sq = dx * dx + dy * dy;
            let max_dist = primary_radius + dual_radius + 1.0;
            if dist_sq <= max_dist * max_dist {
                instances.push(DualStampInstance {
                    cx,
                    cy,
                    radius: dual_radius,
                    angle: 0.0,     // Future: add angle jitter here
                    roundness: 1.0, // Future: add roundness jitter here
                });
            }
        }
    }

    instances
}

/// Sample the accumulated secondary alpha at a pixel from all overlapping dual stamp instances.
/// Uses max blending (paint-like accumulation) across instances.
pub(crate) fn sample_dual_stamps(
    px: f32,
    py: f32,
    instances: &[DualStampInstance],
    secondary: &SecondaryTipState,
) -> f32 {
    let mut max_alpha: f32 = 0.0;
    for inst in instances {
        let a = sample_secondary_tip(
            px,
            py,
            inst.cx,
            inst.cy,
            inst.radius,
            inst.angle,
            inst.roundness,
            secondary,
        );
        if a > max_alpha {
            max_alpha = a;
        }
        if max_alpha >= 1.0 {
            return 1.0;
        }
    }
    max_alpha
}

/// Sample a tiled texture pattern at a given position, returning the modulated alpha.
/// `px`, `py` are the canvas pixel coordinates of the stamp pixel.
/// `cx`, `cy` are the stamp center coordinates.
/// When `texture_each_tip` is true, pattern coordinates are relative to the stamp center.
/// Otherwise they are relative to the canvas origin (screen-aligned tiling).
pub(crate) fn sample_texture(
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

    let pattern_value = sample_bilinear_wrap(pattern, u, v);

    // Lerp between 1.0 (no effect) and pattern_value based on depth
    1.0 - texture.depth * (1.0 - pattern_value)
}

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
    dual: Option<(&[DualStampInstance], &SecondaryTipState, DualBrushMode)>,
    texture: Option<(&TextureSettings, &BrushTip)>,
) {
    if radius <= 0.0 || alpha <= 0.0 {
        return;
    }

    let transform = TipTransform::new(angle_degrees, roundness);

    stamp_loop(
        layer,
        cx,
        cy,
        radius,
        roundness,
        color,
        alpha,
        selection,
        dual,
        texture,
        |px, py| {
            let (rx, ry) = transform.transform(px - cx, py - cy);
            let dist = (rx * rx + ry * ry).sqrt();
            smoothstep_falloff(dist, radius, hardness)
        },
    );
}

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
    dual: Option<(&[DualStampInstance], &SecondaryTipState, DualBrushMode)>,
    texture: Option<(&TextureSettings, &BrushTip)>,
) {
    if radius <= 0.0 || alpha <= 0.0 || tip.width == 0 || tip.height == 0 {
        return;
    }

    let transform = TipTransform::new(angle_degrees, roundness);

    stamp_loop(
        layer,
        cx,
        cy,
        radius,
        roundness,
        color,
        alpha,
        selection,
        dual,
        texture,
        |px, py| {
            let (rx, ry) = transform.transform(px - cx, py - cy);
            sample_tip_alpha(tip, rx, ry, radius, flip_x, flip_y)
        },
    );
}

// --- DRY Helpers ---

struct TipTransform {
    cos_a: f32,
    sin_a: f32,
    inv_roundness: f32,
}

impl TipTransform {
    fn new(angle_degrees: f32, roundness: f32) -> Self {
        let angle_rad = angle_degrees.to_radians();
        Self {
            cos_a: angle_rad.cos(),
            sin_a: angle_rad.sin(),
            inv_roundness: 1.0 / roundness.clamp(0.01, 1.0),
        }
    }

    fn transform(&self, dx: f32, dy: f32) -> (f32, f32) {
        let rx = dx * self.cos_a - dy * self.sin_a;
        let ry = (dx * self.sin_a + dy * self.cos_a) * self.inv_roundness;
        (rx, ry)
    }
}

fn smoothstep_falloff(dist: f32, radius: f32, hardness: f32) -> f32 {
    let inner_r = radius * hardness;
    if dist <= inner_r {
        1.0
    } else {
        let falloff_range = (radius + 0.5) - inner_r;
        if falloff_range <= 0.0 {
            1.0
        } else {
            let t = ((radius + 0.5 - dist) / falloff_range).clamp(0.0, 1.0);
            t * t * (3.0 - 2.0 * t)
        }
    }
}

fn sample_bilinear(tip: &BrushTip, u: f32, v: f32) -> f32 {
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

fn sample_bilinear_wrap(tip: &BrushTip, u: f32, v: f32) -> f32 {
    let u0 = u.floor() as u32 % tip.width;
    let v0 = v.floor() as u32 % tip.height;
    let u1 = (u0 + 1) % tip.width;
    let v1 = (v0 + 1) % tip.height;
    let fu = u.fract();
    let fv = v.fract();

    let s00 = tip.pixels[(v0 * tip.width + u0) as usize] as f32 / 255.0;
    let s10 = tip.pixels[(v0 * tip.width + u1) as usize] as f32 / 255.0;
    let s01 = tip.pixels[(v1 * tip.width + u0) as usize] as f32 / 255.0;
    let s11 = tip.pixels[(v1 * tip.width + u1) as usize] as f32 / 255.0;

    s00 * (1.0 - fu) * (1.0 - fv)
        + s10 * fu * (1.0 - fv)
        + s01 * (1.0 - fu) * fv
        + s11 * fu * fv
}

fn sample_tip_alpha(
    tip: &BrushTip,
    rx: f32,
    ry: f32,
    radius: f32,
    flip_x: bool,
    flip_y: bool,
) -> f32 {
    let diameter = radius * 2.0;
    let tw = tip.width as f32;
    let th = tip.height as f32;
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
    sample_bilinear(tip, u, v)
}

fn stamp_loop<F>(
    layer: &mut Layer,
    cx: f32,
    cy: f32,
    radius: f32,
    roundness: f32,
    color: Color,
    alpha: f32,
    selection: Option<&[u8]>,
    dual: Option<(&[DualStampInstance], &SecondaryTipState, DualBrushMode)>,
    texture: Option<(&TextureSettings, &BrushTip)>,
    mut alpha_sampler: F,
) where
    F: FnMut(f32, f32) -> f32,
{
    let (x_min, y_min, x_max, y_max) =
        stamp_bounds(cx, cy, radius, roundness, layer.width, layer.height);

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let pxf = px as f32 + 0.5;
            let pyf = py as f32 + 0.5;

            let tip_alpha = alpha_sampler(pxf, pyf);
            if tip_alpha <= 0.0 {
                continue;
            }

            let combined_alpha = match &dual {
                Some((instances, secondary, mode)) => {
                    let sec = sample_dual_stamps(pxf, pyf, instances, secondary);
                    mode.apply(tip_alpha, sec)
                }
                None => tip_alpha,
            };

            let texture_alpha = match &texture {
                Some((tex, pattern)) => sample_texture(pxf, pyf, cx, cy, tex, pattern),
                None => 1.0,
            };

            let selection_alpha = match selection {
                Some(mask) => mask[(py * layer.width + px) as usize] as f32 / 255.0,
                None => 1.0,
            };

            let final_alpha = alpha * combined_alpha * texture_alpha * selection_alpha;
            if final_alpha > 0.0 {
                if let Some(pixel) = layer.pixel_mut(px, py) {
                    blend_pixel(pixel, color, final_alpha);
                }
            }
        }
    }
    layer.expand_dirty((x_min, y_min, x_max, y_max));
}

/// Compute the bounding box of a stamp for recompositing.
pub(crate) fn stamp_bounds(
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
pub(crate) fn recomposite_region(
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let instances = vec![DualStampInstance { cx: 20.0, cy: 20.0, radius: 3.0, angle: 0.0, roundness: 1.0 }];
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
            Some((&instances, &sec, DualBrushMode::Multiply)),
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
            Some((&[DualStampInstance { cx: 20.0, cy: 20.0, radius: 3.0, angle: 0.0, roundness: 1.0 }], &sec, DualBrushMode::Lighten)),
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
            Some((&[DualStampInstance { cx: 20.0, cy: 20.0, radius: 8.0, angle: 0.0, roundness: 1.0 }], &sec, DualBrushMode::Subtract)),
            None,
        );

        let center = layer.pixel(20, 20).unwrap()[3];
        assert_eq!(
            center, 0,
            "Subtract with fully opaque secondary should produce zero alpha"
        );
    }

    #[test]
    fn test_compute_dual_stamps_disabled() {
        let dual = DualBrushSettings {
            enabled: false,
            ..Default::default()
        };
        let instances = compute_dual_stamps(50.0, 50.0, 10.0, 50.0, 1.0, 0.0, &dual, 42);
        assert!(instances.is_empty(), "Disabled dual brush should produce no instances");
    }

    #[test]
    fn test_compute_dual_stamps_basic_positions() {
        let dual = DualBrushSettings {
            enabled: true,
            size: 10.0,
            spacing: 1.0,   // step = 10.0
            scatter: 0.0,   // no scatter
            count: 1,
            both_axes: false,
            hardness: 1.0,
            mode: DualBrushMode::Multiply,
            use_computed: true,
        };
        // Primary stamp at distance 50.0, direction (1,0), radius 10
        // dual_step = 10.0, dual_radius = 5.0
        // search = 10 + 5 + 0 = 15
        // n_start = floor((50-15)/10) = 3, n_end = ceil((50+15)/10) = 7
        // Stamps at n*10: 30, 40, 50, 60, 70
        // Offsets from primary: -20, -10, 0, 10, 20
        let instances = compute_dual_stamps(50.0, 50.0, 10.0, 50.0, 1.0, 0.0, &dual, 42);
        assert!(!instances.is_empty());
        // The instance at n=5 (distance=50) should be centered on the primary stamp
        let center_inst = instances.iter().find(|i| (i.cx - 50.0).abs() < 0.1);
        assert!(center_inst.is_some(), "Should have a dual stamp at the primary center");
    }

    #[test]
    fn test_compute_dual_stamps_with_count() {
        let dual = DualBrushSettings {
            enabled: true,
            size: 10.0,
            spacing: 1.0,
            scatter: 0.0,
            count: 3,
            both_axes: false,
            hardness: 1.0,
            mode: DualBrushMode::Multiply,
            use_computed: true,
        };
        let instances_c3 = compute_dual_stamps(50.0, 50.0, 10.0, 50.0, 1.0, 0.0, &dual, 42);
        let dual_c1 = DualBrushSettings { count: 1, ..dual.clone() };
        let instances_c1 = compute_dual_stamps(50.0, 50.0, 10.0, 50.0, 1.0, 0.0, &dual_c1, 42);
        // count=3 should produce more instances (3x per spacing step, minus rejection)
        assert!(instances_c3.len() >= instances_c1.len(),
            "Higher count should produce at least as many instances");
    }

    #[test]
    fn test_compute_dual_stamps_deterministic() {
        let dual = DualBrushSettings {
            enabled: true,
            size: 10.0,
            spacing: 0.5,
            scatter: 0.5,
            count: 2,
            both_axes: true,
            hardness: 1.0,
            mode: DualBrushMode::Multiply,
            use_computed: true,
        };
        let a = compute_dual_stamps(50.0, 50.0, 10.0, 50.0, 1.0, 0.0, &dual, 42);
        let b = compute_dual_stamps(50.0, 50.0, 10.0, 50.0, 1.0, 0.0, &dual, 42);
        assert_eq!(a.len(), b.len());
        for (ia, ib) in a.iter().zip(b.iter()) {
            assert_eq!(ia.cx, ib.cx);
            assert_eq!(ia.cy, ib.cy);
            assert_eq!(ia.radius, ib.radius);
        }
    }

    #[test]
    fn test_sample_dual_stamps_max_blending() {
        let sec = SecondaryTipState::Computed { hardness: 1.0 };
        // Two instances at different positions, pixel at (50,50)
        let instances = vec![
            DualStampInstance { cx: 50.0, cy: 50.0, radius: 5.0, angle: 0.0, roundness: 1.0 },  // pixel at center -> alpha ~1.0
            DualStampInstance { cx: 55.0, cy: 50.0, radius: 5.0, angle: 0.0, roundness: 1.0 },  // pixel 5px from center -> lower alpha
        ];
        let alpha = sample_dual_stamps(50.0, 50.0, &instances, &sec);
        assert!(alpha > 0.9, "Should be high alpha since pixel is at center of first instance");
    }

    #[test]
    fn test_sample_dual_stamps_empty() {
        let sec = SecondaryTipState::Computed { hardness: 1.0 };
        let alpha = sample_dual_stamps(50.0, 50.0, &[], &sec);
        assert_eq!(alpha, 0.0, "No instances should produce zero alpha");
    }

    #[test]
    fn test_sample_dual_stamps_far_pixel() {
        let sec = SecondaryTipState::Computed { hardness: 1.0 };
        let instances = vec![
            DualStampInstance { cx: 50.0, cy: 50.0, radius: 5.0, angle: 0.0, roundness: 1.0 },
        ];
        // Pixel far from the instance
        let alpha = sample_dual_stamps(100.0, 100.0, &instances, &sec);
        assert_eq!(alpha, 0.0, "Pixel far from instance should have zero alpha");
    }
}
