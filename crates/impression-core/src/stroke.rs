use crate::brush::{
    recomposite_region, stamp_bounds, stamp_ellipse, stamp_tip, BrushSettings, BrushTip,
    SecondaryTipState,
};
use crate::dynamics::{self, Rng};
use crate::layer::Layer;

pub struct StrokeParams<'a> {
    pub brush: &'a BrushSettings,
    pub active_tip: Option<&'a BrushTip>,
    pub secondary_tip: Option<&'a BrushTip>,
    pub texture_tip: Option<&'a BrushTip>,
    pub selection: Option<&'a [u8]>,
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
    params: &StrokeParams,
    residual: f32,
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

    let brush = params.brush;
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
                let sec_state = match params.secondary_tip {
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
                params.texture_tip.map(|t| (&brush.texture, t))
            } else {
                None
            };
            if let Some(tip) = params.active_tip {
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
                    params.selection,
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
                    params.selection,
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
    params: &StrokeParams,
    x: f32,
    y: f32,
    pressure: f32,
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
    let brush = params.brush;
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
        let sec_state = match params.secondary_tip {
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
        params.texture_tip.map(|t| (&brush.texture, t))
    } else {
        None
    };
    if let Some(tip) = params.active_tip {
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
            params.selection,
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
            params.selection,
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
}
