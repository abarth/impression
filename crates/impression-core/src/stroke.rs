use crate::brush::{
    generate_dual_instance, recomposite_region, stamp_bounds, stamp_ellipse, stamp_tip,
    BrushSettings, BrushTip, DualBrushSettings, DualStampInstance, SecondaryTipState,
};
use crate::dynamics::{self, Rng};
use crate::layer::{DirtyBounds, Layer};
use std::collections::VecDeque;

/// Walks along a line segment at spacing intervals, tracking residual distance.
///
/// Shared by both primary and dual brush interpolation to eliminate duplication
/// of the "advance along segment, yield positions, compute residual" pattern.
struct SpacingWalker {
    segment_len: f32,
    dist: f32,
}

impl SpacingWalker {
    /// Create a walker for a segment of given length, starting at the given residual distance.
    fn new(segment_len: f32, residual: f32) -> Self {
        SpacingWalker { segment_len, dist: residual }
    }

    /// Returns the interpolation parameter `t ∈ [0, 1]` for the current position,
    /// or `None` if the walker has passed the end of the segment.
    fn t(&self) -> Option<f32> {
        if self.dist <= self.segment_len {
            Some(self.dist / self.segment_len)
        } else {
            None
        }
    }

    /// Advance the walker by the given step size.
    fn advance(&mut self, step: f32) {
        self.dist += step;
    }

    /// The current cumulative distance along the segment.
    fn distance(&self) -> f32 {
        self.dist
    }

    /// The residual distance past the end of the segment (for carrying over to the next segment).
    fn residual(&self) -> f32 {
        self.dist - self.segment_len
    }
}

pub struct StrokeParams<'a> {
    pub brush: &'a BrushSettings,
    pub active_tip: Option<&'a BrushTip>,
    pub secondary_tip: Option<&'a BrushTip>,
    pub texture_tip: Option<&'a BrushTip>,
    pub selection: Option<&'a [u8]>,
}

/// Compute the jittered stamp count for a dual brush position.
///
/// Uses a deterministic RNG keyed on `(stroke_seed, stamp_index)` so the count is
/// stable regardless of rendering order. With `count_jitter == 0` the base count is
/// returned unchanged.
fn jittered_dual_count(scatter: &crate::brush::ScatterSettings, stroke_seed: u32, stamp_index: u32) -> u32 {
    let base = scatter.count.max(1);
    if scatter.count_jitter <= 0.0 || base <= 1 {
        return base;
    }
    let mut rng = Rng::from_index(stroke_seed, stamp_index, u32::MAX);
    let base_f = base as f32;
    let jittered = base_f - base_f * scatter.count_jitter * rng.next_f32();
    jittered.round().max(1.0) as u32
}

/// Maintains a sliding window of dual-brush stamp instances along the stroke path.
///
/// Instead of recomputing dual stamp positions for each primary stamp (which causes
/// position drift when multiple primary stamps overlap the same dual stamp), this
/// interpolator places dual stamps once at absolute canvas coordinates and reuses them.
#[derive(Clone, Debug)]
pub struct DualBrushInterpolator {
    instances: VecDeque<DualStampInstance>,
    residual: f32,
    next_index: u32,
    dual_radius: f32,
    dual_step: f32,
    /// Total stroke distance processed by this interpolator (for stroke_distance on new instances).
    total_distance: f32,
}

impl Default for DualBrushInterpolator {
    fn default() -> Self {
        DualBrushInterpolator {
            instances: VecDeque::new(),
            residual: 0.0,
            next_index: 0,
            dual_radius: 0.0,
            dual_step: 1.0,
            total_distance: 0.0,
        }
    }
}

impl DualBrushInterpolator {
    /// Create a new interpolator from brush settings. Uses the base brush size (not
    /// pressure-adjusted) so that dual stamps have consistent spacing and positions.
    fn new(brush: &BrushSettings) -> Self {
        let dual = &brush.dual_brush;
        let dual_radius = (brush.size / 2.0) * dual.size_ratio;
        let dual_diameter = dual_radius * 2.0;
        let dual_step = (dual.spacing * dual_diameter).max(1.0);
        DualBrushInterpolator {
            instances: VecDeque::new(),
            residual: 0.0,
            next_index: 0,
            dual_radius,
            dual_step,
            total_distance: 0.0,
        }
    }

    /// Place the initial dual stamp(s) at the stroke origin (no direction available).
    /// Sets the residual to `dual_step` so the next segment doesn't re-place at distance 0.
    fn place_initial(
        &mut self,
        x: f32,
        y: f32,
        dual: &DualBrushSettings,
        stroke_seed: u32,
    ) {
        let count = jittered_dual_count(&dual.scatter, stroke_seed, 0);
        for c in 0..count {
            let inst = generate_dual_instance(
                x, y, self.dual_radius,
                0.0, 0.0, dual, stroke_seed,
                0, c, 0.0,
            );
            self.instances.push_back(inst);
        }
        self.next_index = 1;
        self.residual = self.dual_step;
    }

    /// Advance along a segment, placing new dual stamp instances at spacing intervals.
    fn advance(
        &mut self,
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        dir_x: f32,
        dir_y: f32,
        dual: &DualBrushSettings,
        stroke_seed: u32,
    ) {
        let dx = x1 - x0;
        let dy = y1 - y0;
        let segment_len = (dx * dx + dy * dy).sqrt();
        if segment_len < 0.001 {
            return;
        }

        let mut walker = SpacingWalker::new(segment_len, self.residual);

        while let Some(t) = walker.t() {
            let cx = x0 + dx * t;
            let cy = y0 + dy * t;
            let sd = self.total_distance + walker.distance();
            let count = jittered_dual_count(&dual.scatter, stroke_seed, self.next_index);

            for c in 0..count {
                let inst = generate_dual_instance(
                    cx, cy,
                    self.dual_radius,
                    dir_x, dir_y,
                    dual, stroke_seed,
                    self.next_index, c,
                    sd,
                );
                self.instances.push_back(inst);
            }
            self.next_index += 1;
            walker.advance(self.dual_step);
        }

        self.residual = walker.residual();
        self.total_distance += segment_len;
    }

    /// Return all instances whose bounding circle overlaps a primary stamp at `(cx, cy)` with `radius`.
    fn overlapping(&self, cx: f32, cy: f32, radius: f32) -> Vec<DualStampInstance> {
        let max_dist = radius + self.dual_radius + 1.0;
        let max_dist_sq = max_dist * max_dist;
        self.instances
            .iter()
            .filter(|inst| {
                let dx = inst.cx - cx;
                let dy = inst.cy - cy;
                dx * dx + dy * dy <= max_dist_sq
            })
            .cloned()
            .collect()
    }

    /// Remove instances whose stroke distance is too far behind the current position.
    fn prune(&mut self, min_stroke_distance: f32) {
        while let Some(front) = self.instances.front() {
            if front.stroke_distance < min_stroke_distance {
                self.instances.pop_front();
            } else {
                break;
            }
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
    /// Cumulative distance along the stroke path, used for dual brush stamp indexing.
    pub total_distance: f32,
    /// Seed for deterministic dual-brush per-stamp RNG, derived from stroke start coords.
    pub stroke_seed: u32,
    /// Sliding window of dual brush stamp instances along the stroke path.
    dual_interp: DualBrushInterpolator,
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
            total_distance: 0.0,
            stroke_seed: 0,
            dual_interp: DualBrushInterpolator::default(),
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
        self.total_distance = 0.0;
        self.stroke_seed = 0;
        self.dual_interp = DualBrushInterpolator::default();
    }
}

/// Resolved per-stamp parameters after applying dynamics.
#[derive(Debug, Clone, Copy)]
struct StampParams {
    x: f32,
    y: f32,
    radius: f32,
    roundness: f32,
    angle: f32,
    flow: f32,
}

/// Compute per-stamp parameters by applying shape and transfer dynamics.
///
/// `resolve_direction` maps a dynamic control to the appropriate direction angle
/// (current segment direction or initial direction).
fn compute_stamp_params(
    brush: &BrushSettings,
    x: f32,
    y: f32,
    pressure: f32,
    rng: &mut Rng,
    direction_angle: f32,
    initial_direction_angle: f32,
) -> StampParams {
    let resolve_dir = |control: &dynamics::DynamicControl| -> f32 {
        match control {
            dynamics::DynamicControl::InitialDirection => initial_direction_angle,
            _ => direction_angle,
        }
    };

    let effective_size = dynamics::apply_dynamic(
        &brush.shape_dynamics.size,
        brush.size,
        pressure,
        rng,
        resolve_dir(&brush.shape_dynamics.size.control),
    );
    let roundness = dynamics::apply_dynamic(
        &brush.shape_dynamics.roundness,
        brush.roundness,
        pressure,
        rng,
        resolve_dir(&brush.shape_dynamics.roundness.control),
    )
    .clamp(0.01, 1.0);
    let angle = dynamics::apply_angle_dynamic(
        &brush.shape_dynamics.angle,
        brush.angle,
        pressure,
        rng,
        resolve_dir(&brush.shape_dynamics.angle.control),
    );
    let flow = dynamics::apply_dynamic(
        &brush.transfer_dynamics.flow,
        brush.flow,
        pressure,
        rng,
        resolve_dir(&brush.transfer_dynamics.flow.control),
    )
    .clamp(0.0, 1.0);

    StampParams {
        x,
        y,
        radius: effective_size / 2.0,
        roundness,
        angle,
        flow,
    }
}

/// Place a single stamp onto the target layer, dispatching to `stamp_tip` or `stamp_ellipse`.
fn place_stamp(
    target: &mut Layer,
    sp: &StampParams,
    brush: &BrushSettings,
    active_tip: Option<&BrushTip>,
    selection: Option<&[u8]>,
    dual_instances: &[DualStampInstance],
    secondary_tip: Option<&BrushTip>,
    texture: Option<(&crate::brush::TextureSettings, &BrushTip)>,
) {
    let dual = if brush.dual_brush.enabled {
        let sec_state = match secondary_tip {
            Some(t) => SecondaryTipState::Image(t),
            None => SecondaryTipState::Computed {
                hardness: brush.dual_brush.hardness,
            },
        };
        Some((dual_instances, sec_state, brush.dual_brush.mode))
    } else {
        None
    };
    let dual_ref = dual
        .as_ref()
        .map(|(inst, state, mode)| (*inst as &[DualStampInstance], state, *mode));

    if let Some(tip) = active_tip {
        stamp_tip(
            target,
            sp.x,
            sp.y,
            sp.radius,
            tip,
            brush.color,
            sp.flow,
            sp.roundness,
            sp.angle,
            brush.flip_x,
            brush.flip_y,
            selection,
            dual_ref,
            texture,
        );
    } else {
        stamp_ellipse(
            target,
            sp.x,
            sp.y,
            sp.radius,
            brush.color,
            sp.flow,
            brush.hardness,
            sp.roundness,
            sp.angle,
            selection,
            dual_ref,
            texture,
        );
    }
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
) -> Option<DirtyBounds> {
    let max_radius = brush.size * p0.max(p1) / 2.0;
    let mut extent = max_radius;
    // Account for scatter offset: stamps can land up to scatter * size away
    if brush.scatter.scatter > 0.0 {
        extent += brush.scatter.scatter * brush.size;
    }
    let x_min = (x0.min(x1) - extent - 1.0).floor().max(0.0) as f32;
    let y_min = (y0.min(y1) - extent - 1.0).floor().max(0.0) as f32;
    let x_max = (x0.max(x1) + extent + 1.0).ceil().min(width as f32 - 1.0);
    let y_max = (y0.max(y1) + extent + 1.0).ceil().min(height as f32 - 1.0);

    if x_min > x_max || y_min > y_max {
        return None;
    }

    Some((x_min as u32, y_min as u32, x_max as u32, y_max as u32))
}

/// Interpolate points along a segment and stamp circles into the stroke buffer.
/// Returns the residual distance for the next segment.
///
/// `initial_direction_angle` is the initial direction for InitialDirection control.
/// `total_distance` is the cumulative stroke distance at the start of this segment.
/// `stroke_seed` is the per-stroke seed for deterministic dual brush RNG.
/// `dual_interp` is the sliding window of dual brush instances along the stroke path.
pub fn interpolate_and_stamp(
    target: &mut Layer,
    x0: f32,
    y0: f32,
    p0: f32,
    x1: f32,
    y1: f32,
    p1: f32,
    params: &StrokeParams,
    residual: f32,
    rng: &mut Rng,
    initial_direction_angle: f32,
    total_distance: &mut f32,
    stroke_seed: u32,
    dual_interp: &mut DualBrushInterpolator,
) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let segment_len = (dx * dx + dy * dy).sqrt();

    if segment_len < 0.001 {
        return residual;
    }

    // Precompute direction vectors for scattering
    let inv_len = 1.0 / segment_len;
    let dir_x = dx * inv_len;
    let dir_y = dy * inv_len;
    let perp_x = -dir_y;
    let perp_y = dir_x;

    let direction_angle = (-dy).atan2(dx).to_degrees();

    let brush = params.brush;
    let scatter = &brush.scatter;

    // Advance dual brush interpolator along this segment before the primary stamp loop,
    // so all dual instances are placed at stable absolute positions.
    if brush.dual_brush.enabled {
        dual_interp.advance(x0, y0, x1, y1, dir_x, dir_y, &brush.dual_brush, stroke_seed);
    }

    let mut walker = SpacingWalker::new(segment_len, residual);

    while let Some(t) = walker.t() {
        let x = x0 + dx * t;
        let y = y0 + dy * t;
        let pressure = p0 + (p1 - p0) * t;

        let sp = compute_stamp_params(
            brush,
            x,
            y,
            pressure,
            rng,
            direction_angle,
            initial_direction_angle,
        );
        let effective_size = sp.radius * 2.0;

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
                    sp.x + perp_x * perp_offset + dir_x * along_offset,
                    sp.y + perp_y * perp_offset + dir_y * along_offset,
                )
            } else {
                (sp.x, sp.y)
            };

            // Query overlapping dual instances from the sliding window
            let dual_instances = dual_interp.overlapping(sx, sy, sp.radius);

            let tex_ref = if brush.texture.enabled {
                params.texture_tip.map(|t| (&brush.texture, t))
            } else {
                None
            };

            place_stamp(
                target,
                &StampParams { x: sx, y: sy, ..sp },
                brush,
                params.active_tip,
                params.selection,
                &dual_instances,
                params.secondary_tip,
                tex_ref,
            );
        }

        let step = (brush.spacing * effective_size).max(1.0);
        walker.advance(step);
    }

    // Prune dual instances that are too far behind to overlap any future primary stamp
    if brush.dual_brush.enabled {
        let max_primary_radius = brush.size / 2.0;
        let max_scatter_offset = brush.dual_brush.scatter.scatter * dual_interp.dual_radius * 2.0;
        let lookback = max_primary_radius + dual_interp.dual_radius + max_scatter_offset + 1.0;
        dual_interp.prune(*total_distance + segment_len - lookback);
    }

    // Update total stroke distance
    *total_distance += segment_len;

    walker.residual()
}

/// Begin a stroke at the given position.
pub fn stroke_begin(
    layer: &mut Layer,
    state: &mut StrokeState,
    params: &StrokeParams,
    x: f32,
    y: f32,
    pressure: f32,
) {
    state.active = true;
    state.last_point = Some((x, y, pressure));
    state.total_distance = 0.0;

    // Seed per-stroke PRNG from start coordinates
    let mut rng = Rng::from_coords(x, y);
    let seed = x.to_bits() ^ y.to_bits().rotate_left(16);
    state.stroke_seed = if seed == 0 { 1 } else { seed };

    // Save snapshot and create stroke buffer
    state.snapshot = layer.pixels.clone();
    let mut stroke = Layer::new(0, layer.width, layer.height);

    // No direction available for the first stamp
    let brush = params.brush;
    let dir_angle = 0.0;

    let sp = compute_stamp_params(brush, x, y, pressure, &mut rng, dir_angle, dir_angle);
    let effective_size = sp.radius * 2.0;

    // Initialize dual brush interpolator and place initial instances at stroke origin
    state.dual_interp = DualBrushInterpolator::new(brush);
    if brush.dual_brush.enabled {
        state.dual_interp.place_initial(x, y, &brush.dual_brush, state.stroke_seed);
    }
    let dual_instances = state.dual_interp.overlapping(x, y, sp.radius);

    let tex_ref = if brush.texture.enabled {
        params.texture_tip.map(|t| (&brush.texture, t))
    } else {
        None
    };

    place_stamp(
        &mut stroke,
        &sp,
        brush,
        params.active_tip,
        params.selection,
        &dual_instances,
        params.secondary_tip,
        tex_ref,
    );

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
    if let Some(bounds) = stamp_bounds(x, y, sp.radius, sp.roundness, layer.width, layer.height) {
        recomposite_region(
            layer,
            &state.snapshot,
            &stroke,
            stroke_opacity,
            brush.blend_mode,
            bounds,
        );
    }

    // Set residual so stroke_move does not re-stamp at position 0
    state.residual_distance = (brush.spacing * effective_size).max(1.0);
    state.stroke_layer = Some(stroke);
    state.rng = Some(rng);
}

/// Continue a stroke to the given position.
pub fn stroke_move(
    layer: &mut Layer,
    state: &mut StrokeState,
    params: &StrokeParams,
    x: f32,
    y: f32,
    pressure: f32,
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
        let brush = params.brush;
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
            params,
            state.residual_distance,
            rng,
            initial_dir,
            &mut state.total_distance,
            state.stroke_seed,
            &mut state.dual_interp,
        );
        state.residual_distance = residual;

        // Recomposite the segment's bounding box
        if let Some(bounds) =
            segment_bounds(lx, ly, lp, x, y, pressure, brush, layer.width, layer.height)
        {
            recomposite_region(
                layer,
                &state.snapshot,
                stroke,
                brush.opacity,
                brush.blend_mode,
                bounds,
            );
        }
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
    use crate::blend_mode::BlendMode;
    use crate::brush::{BrushSettings, ScatterSettings};
    use crate::color::Color;

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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut Rng::from_coords(0.0, 5.0),
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            10.0,
            10.0,
            1.0,
        );
        assert!(state.active);
        assert!(layer.dirty);

        stroke_move(
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            20.0,
            10.0,
            1.0,
        );
        assert!(state.active);

        stroke_end(&mut state);
        assert!(!state.active);
        assert!(state.last_point.is_none());
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
            &mut layer,
            0.0,
            5.0,
            1.0,
            7.0,
            5.0,
            1.0,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut rng,
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
        );
        assert!(
            (residual - 3.0).abs() < 0.01,
            "residual should be ~3.0, got {}",
            residual
        );

        // Second segment: 7 pixels, starting with residual=3, stamp at 3, next at 8 -> residual=8-7=1
        let residual2 = interpolate_and_stamp(
            &mut layer,
            7.0,
            5.0,
            1.0,
            14.0,
            5.0,
            1.0,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            residual,
            &mut rng,
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut Rng::from_coords(0.0, 10.0),
            0.0,
            &mut 0.0f32,
            0,
            &mut DualBrushInterpolator::new(&brush),
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
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            25.0,
            25.0,
            1.0,
        );
        stroke_move(
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            30.0,
            25.0,
            1.0,
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
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            25.0,
            25.0,
            1.0,
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
            &StrokeParams {
                brush: &paint_brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            25.0,
            25.0,
            1.0,
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
            &StrokeParams {
                brush: &erase_brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            25.0,
            25.0,
            1.0,
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
            &StrokeParams {
                brush: &paint_brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            25.0,
            25.0,
            1.0,
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
            &StrokeParams {
                brush: &erase_brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            25.0,
            25.0,
            1.0,
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
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            10.0,
            100.0,
            1.0,
        );
        let _bounds1 = layer.dirty_bounds.unwrap();

        // Clear dirty to simulate syncLayer
        layer.clear_dirty();
        assert!(layer.dirty_bounds.is_none());

        // Move to (50, 100) — far from start
        stroke_move(
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            50.0,
            100.0,
            1.0,
        );
        let bounds2 = layer.dirty_bounds.unwrap();

        // Clear dirty again
        layer.clear_dirty();

        // Move to (190, 100) — far from previous
        stroke_move(
            &mut layer,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            190.0,
            100.0,
            1.0,
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
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            20.0,
            100.0,
            1.0,
        );
        stroke_move(
            &mut layer_no_scatter,
            &mut state,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            180.0,
            100.0,
            1.0,
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
            &StrokeParams {
                brush: &scatter_brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            20.0,
            100.0,
            1.0,
        );
        stroke_move(
            &mut layer_scatter,
            &mut state,
            &StrokeParams {
                brush: &scatter_brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            180.0,
            100.0,
            1.0,
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
    fn test_first_stamp_not_doubled() {
        // After stroke_begin, residual should be >= spacing so that
        // interpolate_and_stamp doesn't re-stamp at the start position.
        let mut layer = Layer::new(0, 100, 100);
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.25,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            ..Default::default()
        };
        let params = StrokeParams {
            brush: &brush,
            active_tip: None,
            secondary_tip: None,
            texture_tip: None,
            selection: None,
        };
        let mut state = StrokeState::new();
        stroke_begin(&mut layer, &mut state, &params, 50.0, 50.0, 1.0);

        // residual should equal spacing * effective_size
        let step = brush.spacing * brush.size;
        assert!(
            (state.residual_distance - step).abs() < 0.01,
            "residual_distance after first stamp should be step={}, got {}",
            step,
            state.residual_distance
        );
    }

    #[test]
    fn test_compute_stamp_params_basic() {
        let brush = BrushSettings {
            size: 20.0,
            flow: 0.8,
            roundness: 0.5,
            angle: 45.0,
            ..Default::default()
        };
        let mut rng = Rng::from_coords(10.0, 20.0);
        let sp = compute_stamp_params(&brush, 10.0, 20.0, 1.0, &mut rng, 0.0, 0.0);
        assert_eq!(sp.x, 10.0);
        assert_eq!(sp.y, 20.0);
        assert!((sp.radius - 10.0).abs() < 0.01, "radius should be size/2");
        assert!((sp.roundness - 0.5).abs() < 0.01);
        assert!((sp.flow - 0.8).abs() < 0.01);
    }

    #[test]
    fn test_total_distance_tracked_across_segments() {
        // Verify that total_distance accumulates correctly
        let mut layer = Layer::new(0, 200, 10);
        let brush = BrushSettings {
            size: 4.0,
            spacing: 0.25,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            ..Default::default()
        };

        let mut total_dist = 0.0f32;
        let mut rng = Rng::from_coords(0.0, 5.0);

        // First segment: 50 pixels
        interpolate_and_stamp(
            &mut layer,
            0.0,
            5.0,
            1.0,
            50.0,
            5.0,
            1.0,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut rng,
            0.0,
            &mut total_dist,
            0,
            &mut DualBrushInterpolator::new(&brush),
        );
        assert!(
            (total_dist - 50.0).abs() < 1.0,
            "After 50px segment, total_distance={total_dist}"
        );

        // Second segment: 30 more pixels
        let td_before = total_dist;
        interpolate_and_stamp(
            &mut layer,
            50.0,
            5.0,
            1.0,
            80.0,
            5.0,
            1.0,
            &StrokeParams {
                brush: &brush,
                active_tip: None,
                secondary_tip: None,
                texture_tip: None,
                selection: None,
            },
            0.0,
            &mut rng,
            0.0,
            &mut total_dist,
            0,
            &mut DualBrushInterpolator::new(&brush),
        );
        assert!(
            total_dist > td_before,
            "total_distance should increase across segments"
        );
    }

    #[test]
    fn test_place_stamp_secondary_tip_none_uses_computed() {
        // When secondary_tip is None, place_stamp should use a computed circle.
        // When secondary_tip is Some, place_stamp should use the tip image.
        use crate::brush::{
            BrushTip, DualBrushMode, DualBrushSettings, DualStampInstance, ScatterSettings,
        };

        // Create a checkerboard secondary tip image
        let tip_size = 8u32;
        let mut tip_pixels = vec![0u8; (tip_size * tip_size) as usize];
        for y in 0..tip_size {
            for x in 0..tip_size {
                tip_pixels[(y * tip_size + x) as usize] =
                    if (x + y) % 2 == 0 { 255 } else { 0 };
            }
        }
        let secondary_tip = BrushTip {
            pixels: tip_pixels,
            width: tip_size,
            height: tip_size,
        };

        let primary_radius = 10.0_f32;
        let dual_instances = vec![DualStampInstance {
            cx: 20.0,
            cy: 20.0,
            radius: primary_radius,
            angle: 0.0,
            roundness: 1.0,
        flip: false,
        stroke_distance: 0.0,
        }];

        let brush = BrushSettings {
            size: primary_radius * 2.0,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            hardness: 1.0,
            dual_brush: DualBrushSettings {
                enabled: true,
                mode: DualBrushMode::Multiply,
                hardness: 1.0,
                size_ratio: 1.0,
                spacing: 1.0,
                flip: false,
                scatter: ScatterSettings::default(),
            },
            ..Default::default()
        };
        let sp = StampParams {
            x: 20.0,
            y: 20.0,
            radius: primary_radius,
            roundness: 1.0,
            angle: 0.0,
            flow: 1.0,
        };

        // Stamp with secondary_tip = None (computed circle)
        let mut layer_computed = Layer::new(0, 40, 40);
        place_stamp(
            &mut layer_computed, &sp, &brush, None, None,
            &dual_instances, None, None,
        );

        // Stamp with secondary_tip = Some (checkerboard image)
        let mut layer_sampled = Layer::new(0, 40, 40);
        place_stamp(
            &mut layer_sampled, &sp, &brush, None, None,
            &dual_instances, Some(&secondary_tip), None,
        );

        // The two layers should differ: computed produces a smooth circle,
        // while the sampled tip produces a checkerboard pattern.
        let mut differ = false;
        for y in 15..25u32 {
            for x in 15..25u32 {
                let a_computed = layer_computed.pixel(x, y).unwrap()[3];
                let a_sampled = layer_sampled.pixel(x, y).unwrap()[3];
                if a_computed != a_sampled {
                    differ = true;
                    break;
                }
            }
            if differ { break; }
        }
        assert!(
            differ,
            "secondary_tip=None (computed) should produce different output than \
             secondary_tip=Some (sampled image)"
        );
    }

    #[test]
    fn test_dual_interpolator_places_stamps_at_fixed_positions() {
        // Regression test: two overlapping primary stamps should see the same
        // dual stamp instance at exactly the same absolute pixel position.
        use crate::brush::{DualBrushMode, DualBrushSettings, ScatterSettings};

        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.1, // low spacing = many overlapping primary stamps
            dual_brush: DualBrushSettings {
                enabled: true,
                mode: DualBrushMode::Multiply,
                hardness: 1.0,
                size_ratio: 1.0,
                spacing: 1.0, // dual step = 20.0
                flip: false,
                scatter: ScatterSettings {
                    scatter: 0.0,
                    count: 1,
                    both_axes: false,
                    ..Default::default()
                },
            },
            ..Default::default()
        };

        let mut interp = DualBrushInterpolator::new(&brush);
        // Advance along a horizontal segment long enough for multiple dual stamps
        interp.advance(0.0, 50.0, 60.0, 50.0, 1.0, 0.0, &brush.dual_brush, 42);

        // Two primary stamps close together should get the same dual instance positions
        let overlap_a = interp.overlapping(10.0, 50.0, 10.0);
        let overlap_b = interp.overlapping(11.0, 50.0, 10.0);

        // Find any dual instance that appears in both sets
        let mut found_shared = false;
        for a in &overlap_a {
            for b in &overlap_b {
                if (a.cx - b.cx).abs() < 0.001 && (a.cy - b.cy).abs() < 0.001 {
                    found_shared = true;
                    // They must be at EXACTLY the same position (not approximately)
                    assert_eq!(a.cx, b.cx, "Shared dual stamp cx must be identical");
                    assert_eq!(a.cy, b.cy, "Shared dual stamp cy must be identical");
                }
            }
        }
        assert!(
            found_shared,
            "Close primary stamps should share at least one dual stamp instance"
        );
    }

    #[test]
    fn test_dual_interpolator_prune_removes_old_instances() {
        use crate::brush::{DualBrushMode, DualBrushSettings, ScatterSettings};

        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.25,
            dual_brush: DualBrushSettings {
                enabled: true,
                mode: DualBrushMode::Multiply,
                hardness: 1.0,
                size_ratio: 1.0,
                spacing: 0.25, // dual step = 5.0
                flip: false,
                scatter: ScatterSettings::default(),
            },
            ..Default::default()
        };

        let mut interp = DualBrushInterpolator::new(&brush);
        interp.advance(0.0, 0.0, 100.0, 0.0, 1.0, 0.0, &brush.dual_brush, 42);

        let count_before = interp.instances.len();
        assert!(count_before > 5, "Should have many dual stamps along 100px");

        // Prune everything before distance 50
        interp.prune(50.0);
        let count_after = interp.instances.len();
        assert!(
            count_after < count_before,
            "Pruning should remove old instances"
        );

        // All remaining instances should have stroke_distance >= 50
        for inst in &interp.instances {
            assert!(
                inst.stroke_distance >= 50.0,
                "After prune(50), all instances should have stroke_distance >= 50, got {}",
                inst.stroke_distance
            );
        }
    }

    #[test]
    fn test_dual_count_jitter_reduces_stamp_count() {
        use crate::brush::{DualBrushMode, DualBrushSettings, ScatterSettings};

        // With count=3 and count_jitter=1.0 (maximum), every position should
        // produce between 1 and 3 stamps. Collect across multiple stamp indices
        // and verify we see at least one position with fewer than 3 stamps.
        let dual = DualBrushSettings {
            enabled: true,
            mode: DualBrushMode::Multiply,
            hardness: 1.0,
            size_ratio: 1.0,
            spacing: 0.25,
            flip: false,
            scatter: ScatterSettings {
                scatter: 0.5,
                both_axes: false,
                count: 3,
                count_jitter: 1.0,
            },
        };

        let stroke_seed = 99u32;
        let mut saw_reduced = false;
        for n in 0..20u32 {
            let c = jittered_dual_count(&dual.scatter, stroke_seed, n);
            assert!(c >= 1 && c <= 3, "count should be 1..=3, got {c}");
            if c < 3 {
                saw_reduced = true;
            }
        }
        assert!(saw_reduced, "With count_jitter=1.0, at least one position should have fewer than max stamps");
    }

    #[test]
    fn test_dual_count_jitter_zero_keeps_full_count() {
        use crate::brush::{DualBrushMode, DualBrushSettings, ScatterSettings};

        let dual = DualBrushSettings {
            enabled: true,
            mode: DualBrushMode::Multiply,
            hardness: 1.0,
            size_ratio: 1.0,
            spacing: 0.25,
            flip: false,
            scatter: ScatterSettings {
                scatter: 0.5,
                both_axes: false,
                count: 4,
                count_jitter: 0.0,
            },
        };

        // With jitter=0 every stamp position should yield exactly 4 stamps
        for n in 0..10u32 {
            let c = jittered_dual_count(&dual.scatter, 42, n);
            assert_eq!(c, 4, "count_jitter=0 should always return base count 4");
        }
    }

    #[test]
    fn test_dual_interpolator_disabled_produces_no_instances() {
        let brush = BrushSettings {
            size: 20.0,
            dual_brush: DualBrushSettings {
                enabled: false,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut interp = DualBrushInterpolator::new(&brush);
        // Even with advance, disabled dual brush shouldn't place stamps (radius=0 → step clamped to 1)
        // But overlapping should return empty since no instances are added
        let overlap = interp.overlapping(50.0, 50.0, 10.0);
        assert!(overlap.is_empty(), "Disabled dual brush should produce no overlapping instances");
    }

    #[test]
    fn test_secondary_image_tip_not_clipped_to_circle() {
        // Regression: sample_secondary_tip used to apply a hard circular distance
        // check (`dist > radius + 0.5`) before sampling the image tip, which clipped
        // non-circular image tips (e.g. square) to a circle.  After the fix, the
        // image's own bounds determine the shape.
        use crate::brush::{sample_secondary_tip, BrushTip, SecondaryTipState};

        let tip_size = 64u32;
        // Fully opaque square tip — every pixel is 255.
        let tip_pixels = vec![255u8; (tip_size * tip_size) as usize];
        let tip = BrushTip {
            pixels: tip_pixels,
            width: tip_size,
            height: tip_size,
        };
        let secondary = SecondaryTipState::Image(&tip);

        let radius = 20.0_f32;
        // At 45° from center, a point inside the square but outside the inscribed
        // circle should still be sampled from the image.
        // dist = sqrt(14^2 + 14^2) ≈ 19.8 — inside circle → should always work
        let alpha_inside = sample_secondary_tip(
            14.0, 14.0, 0.0, 0.0, radius, 0.0, 1.0, false, &secondary,
        );
        assert!(alpha_inside > 0.0, "Point inside inscribed circle should have alpha");

        // dist = sqrt(15^2 + 15^2) ≈ 21.2 — outside the circle radius + 0.5 = 20.5,
        // but inside the square image bounds.  The old code clipped this to 0.
        let alpha_corner = sample_secondary_tip(
            15.0, 15.0, 0.0, 0.0, radius, 0.0, 1.0, false, &secondary,
        );
        assert!(
            alpha_corner > 0.0,
            "Corner point outside inscribed circle but inside image bounds \
             should NOT be clipped to zero (was clipped by circular check)"
        );
    }

    #[test]
    fn test_place_stamp_with_empty_dual_instances_multiply_produces_no_paint() {
        // Regression: when dual_brush.enabled is true but no dual instances overlap
        // the primary stamp, place_stamp used to fall through to no-modulation,
        // painting at full primary alpha.  For Multiply mode the correct behavior
        // is zero combined alpha (primary × 0 = 0), so no paint should appear.
        use crate::brush::{DualBrushMode, DualBrushSettings, ScatterSettings};

        let brush = BrushSettings {
            size: 20.0,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            hardness: 1.0,
            dual_brush: DualBrushSettings {
                enabled: true,
                mode: DualBrushMode::Multiply,
                hardness: 1.0,
                size_ratio: 1.0,
                spacing: 1.0,
                flip: false,
                scatter: ScatterSettings::default(),
            },
            ..Default::default()
        };
        let sp = StampParams {
            x: 20.0,
            y: 20.0,
            radius: 10.0,
            roundness: 1.0,
            angle: 0.0,
            flow: 1.0,
        };

        let mut layer = Layer::new(0, 40, 40);
        // Empty dual instances slice — no secondary stamps overlap.
        let empty: &[crate::brush::DualStampInstance] = &[];
        place_stamp(&mut layer, &sp, &brush, None, None, empty, None, None);

        // With Multiply mode and no secondary coverage, every pixel should be 0.
        let has_paint = (0..40u32).any(|y| {
            (0..40u32).any(|x| layer.pixel(x, y).unwrap()[3] > 0)
        });
        assert!(
            !has_paint,
            "Multiply mode with empty dual instances should produce no paint"
        );
    }
}
