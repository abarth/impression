use crate::blend_mode::BlendMode;
use crate::brush::{self, BrushSettings, StrokeState};
use crate::color::Color;
use crate::layer::Layer;
use crate::operation::Operation;
use crate::oplog::OpLog;
use crate::selection::{CombineMode, SelectionMask};

pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<Layer>,
    pub brush: BrushSettings,
    pub stroke_state: StrokeState,
    pub background_color: Color,
    pub selection: Option<SelectionMask>,
    pub lasso_points: Vec<(f32, f32)>,
    pub oplog: OpLog,
}

impl Canvas {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            layers: Vec::new(),
            brush: BrushSettings::default(),
            stroke_state: StrokeState::new(),
            background_color: Color::white(),
            selection: None,
            lasso_points: Vec::new(),
            oplog: OpLog::new(),
        }
    }

    pub fn add_layer(&mut self) -> u32 {
        let layer = Layer::new(self.width, self.height);
        let index = self.layers.len() as u32;
        self.layers.push(layer);
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::AddLayer);
        index
    }

    pub fn layer(&self, index: u32) -> Option<&Layer> {
        self.layers.get(index as usize)
    }

    pub fn layer_mut(&mut self, index: u32) -> Option<&mut Layer> {
        self.layers.get_mut(index as usize)
    }

    pub fn remove_layer(&mut self, index: u32) -> bool {
        let i = index as usize;
        if i < self.layers.len() {
            self.layers.remove(i);
            self.oplog.begin_undo_group();
            self.oplog.push(Operation::RemoveLayer(index));
            true
        } else {
            false
        }
    }

    pub fn set_layer_opacity(&mut self, layer: u32, opacity: f32) {
        if let Some(l) = self.layers.get_mut(layer as usize) {
            l.opacity = opacity;
            self.oplog.begin_undo_group();
            self.oplog.push(Operation::SetLayerOpacity { layer, opacity });
        }
    }

    pub fn set_layer_blend_mode(&mut self, layer: u32, mode: BlendMode) {
        if let Some(l) = self.layers.get_mut(layer as usize) {
            l.blend_mode = mode;
            self.oplog.begin_undo_group();
            self.oplog.push(Operation::SetLayerBlendMode { layer, mode });
        }
    }

    pub fn set_layer_visible(&mut self, layer: u32, visible: bool) {
        if let Some(l) = self.layers.get_mut(layer as usize) {
            l.visible = visible;
            self.oplog.begin_undo_group();
            self.oplog.push(Operation::SetLayerVisible { layer, visible });
        }
    }

    pub fn set_background_color(&mut self, color: Color) {
        self.background_color = color;
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetBackgroundColor {
            r: color.r,
            g: color.g,
            b: color.b,
        });
    }

    pub fn set_canvas_visible(&mut self, visible: bool) {
        // Canvas visibility is tracked outside this struct (in Engine),
        // but we record it in the oplog for persistence.
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetCanvasVisible(visible));
    }

    pub fn set_brush_size(&mut self, size: f32) {
        self.brush.size = size;
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetBrushSize(size));
    }

    pub fn set_brush_spacing(&mut self, spacing: f32) {
        self.brush.spacing = spacing;
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetBrushSpacing(spacing));
    }

    pub fn set_brush_color(&mut self, r: u8, g: u8, b: u8) {
        self.brush.color = Color::new(r, g, b);
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetBrushColor { r, g, b });
    }

    pub fn set_brush_opacity(&mut self, opacity: f32) {
        self.brush.opacity = opacity;
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetBrushOpacity(opacity));
    }

    pub fn set_brush_flow(&mut self, flow: f32) {
        self.brush.flow = flow;
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SetBrushFlow(flow));
    }

    /// Sample the composited color at (x, y) across all visible layers,
    /// over the background color. Applies each layer's blend mode.
    /// Returns [R, G, B].
    pub fn sample_color(&self, x: u32, y: u32) -> [u8; 3] {
        // Start with the background color at full opacity (values in 0..1)
        let mut dr = self.background_color.r as f32 / 255.0;
        let mut dg = self.background_color.g as f32 / 255.0;
        let mut db = self.background_color.b as f32 / 255.0;
        let mut da: f32 = 1.0;

        for layer in &self.layers {
            if !layer.visible {
                continue;
            }
            if let Some(px) = layer.pixel(x, y) {
                let src_a = (px[3] as f32 / 255.0) * layer.opacity;
                if src_a <= 0.0 {
                    continue;
                }
                let sr = px[0] as f32 / 255.0;
                let sg = px[1] as f32 / 255.0;
                let sb = px[2] as f32 / 255.0;

                // Apply blend mode, then composite with alpha
                let (br, bg, bb) =
                    crate::color::apply_blend(sr, sg, sb, dr, dg, db, layer.blend_mode.to_u32());

                dr = src_a * br + (1.0 - src_a) * dr;
                dg = src_a * bg + (1.0 - src_a) * dg;
                db = src_a * bb + (1.0 - src_a) * db;
                da = src_a + da * (1.0 - src_a);
            }
        }

        [
            (dr * 255.0 + 0.5).min(255.0) as u8,
            (dg * 255.0 + 0.5).min(255.0) as u8,
            (db * 255.0 + 0.5).min(255.0) as u8,
        ]
    }

    pub fn stroke_begin(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::StrokeBegin { layer, x, y, pressure });
        let sel = self.selection.as_ref().map(|s| s.data.as_slice());
        if let Some(l) = self.layers.get_mut(layer as usize) {
            brush::stroke_begin(l, &mut self.stroke_state, &self.brush, x, y, pressure, sel);
        }
    }

    pub fn stroke_move(&mut self, layer: u32, x: f32, y: f32, pressure: f32) {
        self.oplog.push(Operation::StrokeMove { x, y, pressure });
        let sel = self.selection.as_ref().map(|s| s.data.as_slice());
        if let Some(l) = self.layers.get_mut(layer as usize) {
            brush::stroke_move(l, &mut self.stroke_state, &self.brush, x, y, pressure, sel);
        }
    }

    pub fn stroke_end(&mut self) {
        self.oplog.push(Operation::StrokeEnd);
        brush::stroke_end(&mut self.stroke_state);
    }

    // Selection operations with recording

    pub fn selection_rect(&mut self, x: u32, y: u32, w: u32, h: u32, mode: CombineMode) {
        if mode == CombineMode::Replace || self.selection.is_none() {
            let mut mask = SelectionMask::new(self.width, self.height);
            mask.fill_rect(x, y, w, h, CombineMode::Replace);
            self.selection = Some(mask);
        } else if let Some(ref mut mask) = self.selection {
            mask.fill_rect(x, y, w, h, mode);
        }
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SelectionRect { x, y, w, h, mode });
    }

    pub fn selection_lasso_begin(&mut self) {
        self.lasso_points.clear();
    }

    pub fn selection_lasso_point(&mut self, x: f32, y: f32) {
        self.lasso_points.push((x, y));
    }

    pub fn selection_lasso_end(&mut self, mode: CombineMode) {
        let points: Vec<(f32, f32)> = self.lasso_points.drain(..).collect();
        if mode == CombineMode::Replace || self.selection.is_none() {
            let mut mask = SelectionMask::new(self.width, self.height);
            mask.fill_polygon(&points, CombineMode::Replace);
            self.selection = Some(mask);
        } else if let Some(ref mut mask) = self.selection {
            mask.fill_polygon(&points, mode);
        }
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SelectionLasso { points, mode });
    }

    pub fn select_all(&mut self) {
        let mut mask = SelectionMask::new_full(self.width, self.height);
        mask.dirty = true;
        self.selection = Some(mask);
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::SelectAll);
    }

    pub fn deselect(&mut self) {
        self.selection = None;
        self.oplog.begin_undo_group();
        self.oplog.push(Operation::Deselect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canvas_creation() {
        let canvas = Canvas::new(800, 600);
        assert_eq!(canvas.width, 800);
        assert_eq!(canvas.height, 600);
        assert!(canvas.layers.is_empty());
        assert_eq!(canvas.background_color, Color::white());
    }

    #[test]
    fn test_add_layers() {
        let mut canvas = Canvas::new(100, 100);
        assert_eq!(canvas.add_layer(), 0);
        assert_eq!(canvas.add_layer(), 1);
        assert_eq!(canvas.layers.len(), 2);
    }

    #[test]
    fn test_stroke_on_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_move(0, 60.0, 50.0, 1.0);
        canvas.stroke_end();

        let layer = canvas.layer(0).unwrap();
        assert!(layer.dirty);
        // Check that some pixels were drawn
        let px = layer.pixel(50, 50).unwrap();
        assert!(px[3] > 0, "Should have drawn at stroke start");
    }

    #[test]
    fn test_remove_layer() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.add_layer();
        canvas.add_layer();
        assert_eq!(canvas.layers.len(), 3);

        assert!(canvas.remove_layer(1));
        assert_eq!(canvas.layers.len(), 2);

        // Out of bounds
        assert!(!canvas.remove_layer(99));
        assert_eq!(canvas.layers.len(), 2);
    }

    #[test]
    fn test_sample_color_background_only() {
        let canvas = Canvas::new(10, 10);
        // No layers — should return the background color (white)
        let c = canvas.sample_color(5, 5);
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_with_opaque_layer() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255]; // opaque red
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 0, 0]);

        // Transparent pixel should show background
        let c2 = canvas.sample_color(0, 0);
        assert_eq!(c2, [255, 255, 255]);
    }

    #[test]
    fn test_sample_color_invisible_layer_ignored() {
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255];
            layer.visible = false;
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 255, 255]); // background shows through
    }

    #[test]
    fn test_sample_color_with_multiply_blend() {
        use crate::blend_mode::BlendMode;
        let mut canvas = Canvas::new(10, 10);
        // Background is white (255, 255, 255)
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [128, 128, 128, 255]; // opaque mid-gray
            layer.blend_mode = BlendMode::Multiply;
        }
        let c = canvas.sample_color(3, 3);
        // Multiply: src * dst = 0.502 * 1.0 = 0.502 → ~128
        assert!((c[0] as i32 - 128).abs() <= 1);
        assert!((c[1] as i32 - 128).abs() <= 1);
        assert!((c[2] as i32 - 128).abs() <= 1);
    }

    #[test]
    fn test_sample_color_with_screen_blend() {
        use crate::blend_mode::BlendMode;
        let mut canvas = Canvas::new(10, 10);
        canvas.background_color = Color::new(128, 128, 128); // mid-gray bg
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [128, 128, 128, 255]; // opaque mid-gray
            layer.blend_mode = BlendMode::Screen;
        }
        let c = canvas.sample_color(3, 3);
        // Screen: s + d - s*d ≈ 0.502 + 0.502 - 0.252 ≈ 0.752 → ~192
        assert!((c[0] as i32 - 192).abs() <= 2);
    }

    #[test]
    fn test_sample_color_normal_blend_matches_alpha_over() {
        // Normal blend (mode 0) should give same result as before
        let mut canvas = Canvas::new(10, 10);
        canvas.add_layer();
        {
            let layer = canvas.layer_mut(0).unwrap();
            let px = layer.pixel_mut(3, 3).unwrap();
            *px = [255, 0, 0, 255]; // opaque red
            layer.blend_mode = crate::blend_mode::BlendMode::Normal;
        }
        let c = canvas.sample_color(3, 3);
        assert_eq!(c, [255, 0, 0]);
    }

    #[test]
    fn test_stroke_on_invalid_layer() {
        let mut canvas = Canvas::new(100, 100);
        // Should not panic
        canvas.stroke_begin(99, 50.0, 50.0, 1.0);
        canvas.stroke_move(99, 60.0, 50.0, 1.0);
        canvas.stroke_end();
    }

    #[test]
    fn test_oplog_records_stroke() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        let pre = canvas.oplog.active_len();
        canvas.stroke_begin(0, 50.0, 50.0, 1.0);
        canvas.stroke_move(0, 60.0, 50.0, 0.9);
        canvas.stroke_end();

        let ops = canvas.oplog.active_operations();
        // AddLayer (1) + StrokeBegin + StrokeMove + StrokeEnd (3) = 4
        assert_eq!(ops.len(), pre + 3);
        assert!(matches!(ops[pre], Operation::StrokeBegin { layer: 0, .. }));
        assert!(matches!(ops[pre + 1], Operation::StrokeMove { .. }));
        assert!(matches!(ops[pre + 2], Operation::StrokeEnd));
    }

    #[test]
    fn test_oplog_records_property_changes() {
        let mut canvas = Canvas::new(100, 100);
        canvas.set_brush_size(30.0);
        canvas.set_brush_color(255, 0, 0);

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0], Operation::SetBrushSize(30.0));
        assert_eq!(
            ops[1],
            Operation::SetBrushColor {
                r: 255,
                g: 0,
                b: 0
            }
        );
    }

    #[test]
    fn test_oplog_stroke_is_one_undo_group() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();

        canvas.stroke_begin(0, 10.0, 10.0, 1.0);
        canvas.stroke_move(0, 20.0, 10.0, 1.0);
        canvas.stroke_move(0, 30.0, 10.0, 1.0);
        canvas.stroke_end();

        // Undo should remove the entire stroke (not just StrokeEnd)
        let before = canvas.oplog.active_len();
        let range = canvas.oplog.undo().unwrap();
        let after = canvas.oplog.active_len();
        assert_eq!(before - after, 4); // StrokeBegin + 2*StrokeMove + StrokeEnd
        assert_eq!(range.len(), 4);
    }

    #[test]
    fn test_oplog_records_layer_operations() {
        let mut canvas = Canvas::new(100, 100);
        canvas.add_layer();
        canvas.set_layer_opacity(0, 0.5);
        canvas.set_layer_blend_mode(0, crate::blend_mode::BlendMode::Multiply);
        canvas.set_layer_visible(0, false);

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 4);
        assert!(matches!(ops[0], Operation::AddLayer));
        assert!(matches!(ops[1], Operation::SetLayerOpacity { layer: 0, opacity } if (opacity - 0.5).abs() < 0.001));
        assert!(matches!(
            ops[2],
            Operation::SetLayerBlendMode {
                layer: 0,
                mode: crate::blend_mode::BlendMode::Multiply
            }
        ));
        assert!(matches!(
            ops[3],
            Operation::SetLayerVisible {
                layer: 0,
                visible: false
            }
        ));
    }

    #[test]
    fn test_oplog_records_selection() {
        let mut canvas = Canvas::new(100, 100);
        canvas.select_all();
        canvas.deselect();

        let ops = canvas.oplog.active_operations();
        assert_eq!(ops.len(), 2);
        assert!(matches!(ops[0], Operation::SelectAll));
        assert!(matches!(ops[1], Operation::Deselect));
    }
}
