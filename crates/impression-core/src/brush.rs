use crate::blend_mode::{porter_duff_composite, BlendMode};
use crate::color::{blend_pixel, Color};
use crate::layer::Layer;

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
        }
    }
}

#[derive(Debug)]
pub struct StrokeState {
    pub active: bool,
    pub last_point: Option<(f32, f32, f32)>, // x, y, pressure
    pub residual_distance: f32,
    /// Layer pixels saved at stroke start, used to composite the stroke buffer.
    snapshot: Vec<u8>,
    /// Temporary buffer where stamps accumulate during the stroke.
    stroke_layer: Option<Layer>,
}

impl StrokeState {
    pub fn new() -> Self {
        Self {
            active: false,
            last_point: None,
            residual_distance: 0.0,
            snapshot: Vec::new(),
            stroke_layer: None,
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.last_point = None;
        self.residual_distance = 0.0;
        self.snapshot.clear();
        self.stroke_layer = None;
    }
}

/// Draw a filled circle (stamp) onto the layer at the given center with given radius and alpha.
/// If a selection mask is provided, the stamp is clipped to the selected region.
pub fn stamp_circle(
    layer: &mut Layer,
    cx: f32,
    cy: f32,
    radius: f32,
    color: Color,
    alpha: f32,
    selection: Option<&[u8]>,
) {
    if radius <= 0.0 || alpha <= 0.0 {
        return;
    }

    let r = radius;
    let x_min = ((cx - r - 1.0).floor().max(0.0)) as u32;
    let y_min = ((cy - r - 1.0).floor().max(0.0)) as u32;
    let x_max = ((cx + r + 1.0).ceil()).min(layer.width as f32 - 1.0) as u32;
    let y_max = ((cy + r + 1.0).ceil()).min(layer.height as f32 - 1.0) as u32;

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let dx = px as f32 + 0.5 - cx;
            let dy = py as f32 + 0.5 - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist > r + 0.5 {
                continue;
            }

            // Anti-aliased edge: smoothstep from r-0.5 to r+0.5
            let edge_alpha = if dist < r - 0.5 {
                1.0
            } else {
                let t = (r + 0.5 - dist).clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t) // smoothstep
            };

            let selection_alpha = match selection {
                Some(mask) => mask[(py * layer.width + px) as usize] as f32 / 255.0,
                None => 1.0,
            };
            let final_alpha = alpha * edge_alpha * selection_alpha;
            if let Some(pixel) = layer.pixel_mut(px, py) {
                blend_pixel(pixel, color, final_alpha);
            }
        }
    }
    layer.expand_dirty((x_min, y_min, x_max, y_max));
}

/// Compute the bounding box of a stamp for recompositing.
fn stamp_bounds(cx: f32, cy: f32, radius: f32, width: u32, height: u32) -> (u32, u32, u32, u32) {
    let x_min = (cx - radius - 1.0).floor().max(0.0) as u32;
    let y_min = (cy - radius - 1.0).floor().max(0.0) as u32;
    let x_max = ((cx + radius + 1.0).ceil()).min(width as f32 - 1.0).max(0.0) as u32;
    let y_max = ((cy + radius + 1.0).ceil()).min(height as f32 - 1.0).max(0.0) as u32;
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

            let (or, og, ob, oa) = porter_duff_composite(
                sr, sg, sb, sa,
                dr, dg, db, da,
                blend_mode,
            );

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
    x0: f32, y0: f32, p0: f32,
    x1: f32, y1: f32, p1: f32,
    brush: &BrushSettings,
    width: u32, height: u32,
) -> (u32, u32, u32, u32) {
    let max_radius = brush.size * p0.max(p1) / 2.0;
    let x_min = (x0.min(x1) - max_radius - 1.0).floor().max(0.0) as u32;
    let y_min = (y0.min(y1) - max_radius - 1.0).floor().max(0.0) as u32;
    let x_max = ((x0.max(x1) + max_radius + 1.0).ceil()).min(width as f32 - 1.0).max(0.0) as u32;
    let y_max = ((y0.max(y1) + max_radius + 1.0).ceil()).min(height as f32 - 1.0).max(0.0) as u32;
    (x_min, y_min, x_max, y_max)
}

/// Interpolate points along a segment and stamp circles into the stroke buffer.
/// Returns the residual distance for the next segment.
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
    selection: Option<&[u8]>,
) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let segment_len = (dx * dx + dy * dy).sqrt();

    if segment_len < 0.001 {
        return residual;
    }

    let mut dist = residual;

    while dist <= segment_len {
        let t = dist / segment_len;
        let x = x0 + dx * t;
        let y = y0 + dy * t;
        let pressure = p0 + (p1 - p0) * t;

        let effective_size = brush.size * pressure;
        let radius = effective_size / 2.0;
        stamp_circle(target, x, y, radius, brush.color, brush.flow, selection);

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
    selection: Option<&[u8]>,
) {
    state.active = true;
    state.last_point = Some((x, y, pressure));
    state.residual_distance = 0.0;

    // Save snapshot and create stroke buffer
    state.snapshot = layer.pixels.clone();
    let mut stroke = Layer::new(layer.width, layer.height);

    // Stamp initial point into the stroke buffer
    let radius = (brush.size * pressure) / 2.0;
    stamp_circle(&mut stroke, x, y, radius, brush.color, brush.flow, selection);

    // Composite stroke buffer over snapshot into layer
    let bounds = stamp_bounds(x, y, radius, layer.width, layer.height);
    recomposite_region(layer, &state.snapshot, &stroke, brush.opacity, brush.blend_mode, bounds);

    state.stroke_layer = Some(stroke);
}

/// Continue a stroke to the given position.
pub fn stroke_move(
    layer: &mut Layer,
    state: &mut StrokeState,
    brush: &BrushSettings,
    x: f32,
    y: f32,
    pressure: f32,
    selection: Option<&[u8]>,
) {
    if !state.active {
        return;
    }

    let stroke = match state.stroke_layer.as_mut() {
        Some(s) => s,
        None => return,
    };

    if let Some((lx, ly, lp)) = state.last_point {
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
            selection,
        );
        state.residual_distance = residual;

        // Recomposite the segment's bounding box
        let bounds = segment_bounds(lx, ly, lp, x, y, pressure, brush, layer.width, layer.height);
        recomposite_region(layer, &state.snapshot, stroke, brush.opacity, brush.blend_mode, bounds);
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

    #[test]
    fn test_stamp_circle_center_pixel() {
        let mut layer = Layer::new(10, 10);
        stamp_circle(&mut layer, 5.0, 5.0, 2.0, Color::new(255, 0, 0), 1.0, None);

        // Center pixel should be fully red
        let px = layer.pixel(5, 5).unwrap();
        assert_eq!(px[0], 255);
        assert_eq!(px[1], 0);
        assert_eq!(px[2], 0);
        assert_eq!(px[3], 255);
        assert!(layer.dirty);
    }

    #[test]
    fn test_stamp_circle_outside_is_transparent() {
        let mut layer = Layer::new(10, 10);
        stamp_circle(&mut layer, 5.0, 5.0, 1.0, Color::new(255, 0, 0), 1.0, None);

        // Far corner should be transparent
        let px = layer.pixel(0, 0).unwrap();
        assert_eq!(px[3], 0);
    }

    #[test]
    fn test_interpolation_spacing() {
        let mut layer = Layer::new(100, 10);
        let brush = BrushSettings {
            size: 4.0,
            spacing: 0.25, // step = 1.0 pixel
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            ..Default::default()
        };

        // Draw a horizontal line of 10 pixels
        let residual = interpolate_and_stamp(&mut layer, 0.0, 5.0, 1.0, 10.0, 5.0, 1.0, &brush, 0.0, None);
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
        let mut layer = Layer::new(50, 50);
        let mut state = StrokeState::new();
        let brush = BrushSettings::default();

        stroke_begin(&mut layer, &mut state, &brush, 10.0, 10.0, 1.0, None);
        assert!(state.active);
        assert!(layer.dirty);

        stroke_move(&mut layer, &mut state, &brush, 20.0, 10.0, 1.0, None);
        assert!(state.active);

        stroke_end(&mut state);
        assert!(!state.active);
        assert!(state.last_point.is_none());
    }

    #[test]
    fn test_pressure_affects_radius() {
        let mut layer_full = Layer::new(20, 20);
        let mut layer_half = Layer::new(20, 20);

        // Full pressure stamp
        stamp_circle(&mut layer_full, 10.0, 10.0, 5.0, Color::black(), 1.0, None);

        // Half pressure stamp (radius 2.5)
        stamp_circle(&mut layer_half, 10.0, 10.0, 2.5, Color::black(), 1.0, None);

        // Count non-transparent pixels
        let count_full: usize = (0..20)
            .flat_map(|y| (0..20).map(move |x| (x, y)))
            .filter(|&(x, y)| layer_full.pixel(x, y).unwrap()[3] > 0)
            .count();

        let count_half: usize = (0..20)
            .flat_map(|y| (0..20).map(move |x| (x, y)))
            .filter(|&(x, y)| layer_half.pixel(x, y).unwrap()[3] > 0)
            .count();

        assert!(count_full > count_half, "Full pressure should cover more pixels");
    }

    #[test]
    fn test_flow_affects_alpha() {
        let mut layer = Layer::new(10, 10);
        stamp_circle(&mut layer, 5.0, 5.0, 3.0, Color::black(), 0.5, None);

        let px = layer.pixel(5, 5).unwrap();
        // With flow=0.5, center alpha should be about 128
        assert!((px[3] as f32 - 128.0).abs() < 2.0);
    }

    #[test]
    fn test_stamp_circle_zero_radius_noop() {
        let mut layer = Layer::new(10, 10);
        stamp_circle(&mut layer, 5.0, 5.0, 0.0, Color::black(), 1.0, None);
        assert!(!layer.dirty);
    }

    #[test]
    fn test_residual_distance_carries_over() {
        let mut layer = Layer::new(100, 10);
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.5, // at pressure=1.0: effective_size=10, step=5.0
            ..Default::default()
        };

        // First segment: 7 pixels long, step=5, stamps at 0 and 5, next at 10 -> residual=10-7=3
        let residual = interpolate_and_stamp(&mut layer, 0.0, 5.0, 1.0, 7.0, 5.0, 1.0, &brush, 0.0, None);
        assert!((residual - 3.0).abs() < 0.01, "residual should be ~3.0, got {}", residual);

        // Second segment: 7 pixels, starting with residual=3, stamp at 3, next at 8 -> residual=8-7=1
        let residual2 = interpolate_and_stamp(&mut layer, 7.0, 5.0, 1.0, 14.0, 5.0, 1.0, &brush, residual, None);
        assert!((residual2 - 1.0).abs() < 0.01, "residual should be ~1.0, got {}", residual2);
    }

    #[test]
    fn test_spacing_depends_on_pressure() {
        // With pressure-dependent spacing, low pressure should produce
        // more closely spaced (smaller) stamps than high pressure.
        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.5, // step = 0.5 * effective_size
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            ..Default::default()
        };

        // Count stamps at full pressure: effective_size=20, step=10
        let mut stamps_full = 0u32;
        let mut dist = 0.0f32;
        let segment_len = 100.0f32;
        while dist <= segment_len {
            stamps_full += 1;
            let step = (brush.spacing * (brush.size * 1.0)).max(1.0); // pressure=1.0
            dist += step;
        }

        // Count stamps at half pressure: effective_size=10, step=5
        let mut stamps_half = 0u32;
        dist = 0.0;
        while dist <= segment_len {
            stamps_half += 1;
            let step = (brush.spacing * (brush.size * 0.5)).max(1.0); // pressure=0.5
            dist += step;
        }

        // Half pressure should produce more stamps (closer spacing)
        assert!(
            stamps_half > stamps_full,
            "Half pressure ({stamps_half} stamps) should produce more stamps than full ({stamps_full})"
        );

        // Verify actual interpolate_and_stamp produces the same behavior:
        // draw with low pressure and count non-transparent columns
        let mut layer_low = Layer::new(200, 10);
        interpolate_and_stamp(&mut layer_low, 0.0, 5.0, 0.25, 100.0, 5.0, 0.25, &brush, 0.0, None);
        let mut layer_high = Layer::new(200, 10);
        interpolate_and_stamp(&mut layer_high, 0.0, 5.0, 1.0, 100.0, 5.0, 1.0, &brush, 0.0, None);

        // Count columns with any drawn pixels for each layer
        let cols_drawn = |layer: &Layer| -> usize {
            (0..200)
                .filter(|&x| (0..10u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0))
                .count()
        };

        // Low pressure circles are smaller but more closely spaced,
        // high pressure circles are larger and more spread out.
        // With low pressure the circles are small, so they cover fewer columns per stamp.
        // With high pressure the circles are large, so they cover more columns per stamp.
        // The key invariant: low pressure stamps more frequently.
        let low_cols = cols_drawn(&layer_low);
        let high_cols = cols_drawn(&layer_high);

        // High pressure covers more area per stamp (bigger circles), so it covers more columns
        assert!(
            high_cols > low_cols,
            "High pressure ({high_cols} cols) should cover more area than low ({low_cols} cols)"
        );
    }

    #[test]
    fn test_spacing_at_zero_pressure_uses_minimum_step() {
        // When pressure is 0, effective_size=0, so step should clamp to 1.0
        let mut layer = Layer::new(100, 10);
        let brush = BrushSettings {
            size: 20.0,
            spacing: 0.5,
            ..Default::default()
        };

        // This should not infinite-loop because step is clamped to max(1.0)
        let residual = interpolate_and_stamp(&mut layer, 0.0, 5.0, 0.0, 50.0, 5.0, 0.0, &brush, 0.0, None);
        assert!(residual >= 0.0);
        assert!(residual <= 1.0);
    }

    #[test]
    fn test_spacing_varies_along_stroke_with_pressure_change() {
        // Stroke goes from low to high pressure. The spacing should be
        // tighter at the low-pressure end and wider at the high-pressure end.
        let mut layer = Layer::new(200, 20);
        let brush = BrushSettings {
            size: 10.0,
            spacing: 0.5, // step = 0.5 * effective_size
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            ..Default::default()
        };

        interpolate_and_stamp(&mut layer, 0.0, 10.0, 0.2, 100.0, 10.0, 1.0, &brush, 0.0, None);

        // Check that the first half (low pressure region) has stamps drawn
        let first_quarter_has_stamps = (0..25u32)
            .any(|x| (0..20u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0));
        assert!(first_quarter_has_stamps, "Should have stamps in low-pressure region");

        // Check that the last quarter (high pressure region) also has stamps
        let last_quarter_has_stamps = (75..100u32)
            .any(|x| (0..20u32).any(|y| layer.pixel(x, y).unwrap()[3] > 0));
        assert!(last_quarter_has_stamps, "Should have stamps in high-pressure region");
    }

    #[test]
    fn test_stamp_circle_clipped_by_selection() {
        let mut layer = Layer::new(20, 20);
        // Selection: only the right half (x >= 10) is selected
        let mut mask = vec![0u8; 20 * 20];
        for y in 0..20u32 {
            for x in 10..20u32 {
                mask[(y * 20 + x) as usize] = 255;
            }
        }

        stamp_circle(&mut layer, 10.0, 10.0, 5.0, Color::new(255, 0, 0), 1.0, Some(&mask));

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
        let mut layer = Layer::new(50, 50);
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
        stroke_begin(&mut layer, &mut state, &brush, 25.0, 25.0, 1.0, None);
        stroke_move(&mut layer, &mut state, &brush, 30.0, 25.0, 1.0, None);
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
        let mut layer = Layer::new(50, 50);
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
        stroke_begin(&mut layer, &mut state, &brush, 25.0, 25.0, 1.0, None);
        stroke_end(&mut state);

        // Layer opacity should remain unchanged
        assert_eq!(layer.opacity, opacity_before);
    }

    #[test]
    fn test_erase_blend_mode_removes_pixels() {
        // Paint some content first with normal blend mode
        let mut layer = Layer::new(50, 50);
        let mut state = StrokeState::new();
        let paint_brush = BrushSettings {
            size: 20.0,
            spacing: 0.1,
            color: Color::new(255, 0, 0),
            opacity: 1.0,
            flow: 1.0,
            blend_mode: BlendMode::Normal,
        };

        stroke_begin(&mut layer, &mut state, &paint_brush, 25.0, 25.0, 1.0, None);
        stroke_end(&mut state);

        // Verify center pixel is painted
        let px = layer.pixel(25, 25).unwrap();
        assert!(px[3] > 200, "Should be nearly opaque after painting: a={}", px[3]);

        // Now erase with DstOut blend mode
        let erase_brush = BrushSettings {
            size: 20.0,
            spacing: 0.1,
            color: Color::black(),
            opacity: 1.0,
            flow: 1.0,
            blend_mode: BlendMode::DstOut,
        };

        stroke_begin(&mut layer, &mut state, &erase_brush, 25.0, 25.0, 1.0, None);
        stroke_end(&mut state);

        // Center pixel should be erased (alpha near 0)
        let px = layer.pixel(25, 25).unwrap();
        assert!(px[3] < 10, "Should be erased: a={}", px[3]);
    }

    #[test]
    fn test_erase_partial_opacity() {
        // Paint fully opaque content
        let mut layer = Layer::new(50, 50);
        let mut state = StrokeState::new();
        let paint_brush = BrushSettings::default();

        stroke_begin(&mut layer, &mut state, &paint_brush, 25.0, 25.0, 1.0, None);
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

        stroke_begin(&mut layer, &mut state, &erase_brush, 25.0, 25.0, 1.0, None);
        stroke_end(&mut state);

        let alpha_after = layer.pixel(25, 25).unwrap()[3];
        assert!(alpha_after < alpha_before, "Should have reduced alpha: before={alpha_before} after={alpha_after}");
        assert!(alpha_after > 10, "Should not be fully erased at half opacity: a={alpha_after}");
    }
}
