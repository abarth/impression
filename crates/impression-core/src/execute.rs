use crate::canvas::Canvas;
use crate::color::Color;
use crate::operation::{Operation, SiteOperation};
use crate::selection::{CombineMode, SelectionMask};
use crate::stroke;

impl Canvas {
    /// Execute a single operation mutating the canvas state, without recording it
    /// to the oplog. Used for both initial execution and playback.
    pub(crate) fn execute_op(&mut self, site_op: SiteOperation) {
        let site = site_op.site;
        match site_op.op {
            Operation::CreateCanvas { .. } => {
                // Canvas dimensions are fixed; ignore during replay
            }
            Operation::StrokeBegin {
                layer,
                x,
                y,
                pressure,
            } => {
                self.sites.entry(site).or_default().stroke_layer = layer;
                let site_state = self.sites.get(&site).unwrap();
                let sel_data: Option<Vec<u8>> =
                    site_state.selection.as_ref().map(|s| s.data.clone());
                let brush = site_state.brush.clone();
                let tip = site_state.active_tip.clone();
                let sec_tip = site_state.secondary_tip.clone();
                let tex_tip = site_state.texture_tip.clone();
                let sel_ref = sel_data.as_deref();
                if let Some(l) = self.layers.iter_mut().find(|l| l.id == layer) {
                    let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
                    stroke::stroke_begin(
                        l,
                        stroke_state,
                        &brush,
                        x,
                        y,
                        pressure,
                        tip.as_ref(),
                        sec_tip.as_ref(),
                        tex_tip.as_ref(),
                        sel_ref,
                    );
                }
            }
            Operation::StrokeMove { x, y, pressure } => {
                let site_state = self.sites.get(&site).unwrap();
                let stroke_layer = site_state.stroke_layer;
                let sel_data: Option<Vec<u8>> =
                    site_state.selection.as_ref().map(|s| s.data.clone());
                let brush = site_state.brush.clone();
                let tip = site_state.active_tip.clone();
                let sec_tip = site_state.secondary_tip.clone();
                let tex_tip = site_state.texture_tip.clone();
                let sel_ref = sel_data.as_deref();
                if let Some(l) = self.layers.iter_mut().find(|l| l.id == stroke_layer) {
                    let stroke_state = &mut self.sites.get_mut(&site).unwrap().stroke_state;
                    stroke::stroke_move(
                        l,
                        stroke_state,
                        &brush,
                        x,
                        y,
                        pressure,
                        tip.as_ref(),
                        sec_tip.as_ref(),
                        tex_tip.as_ref(),
                        sel_ref,
                    );
                }
            }
            Operation::StrokeEnd => {
                stroke::stroke_end(&mut self.site_for_mut(site).stroke_state);
            }
            Operation::SetBrushSize(size) => self.site_for_mut(site).brush.size = size,
            Operation::SetBrushSpacing(spacing) => self.site_for_mut(site).brush.spacing = spacing,
            Operation::SetBrushColor { r, g, b } => {
                self.site_for_mut(site).brush.color = Color::new(r, g, b)
            }
            Operation::SetBrushOpacity(opacity) => self.site_for_mut(site).brush.opacity = opacity,
            Operation::SetBrushFlow(flow) => self.site_for_mut(site).brush.flow = flow,
            Operation::SetBrushBlendMode(mode) => self.site_for_mut(site).brush.blend_mode = mode,
            Operation::SetBrushHardness(hardness) => {
                self.site_for_mut(site).brush.hardness = hardness
            }
            Operation::SetBrushRoundness(roundness) => {
                self.site_for_mut(site).brush.roundness = roundness
            }
            Operation::SetBrushAngle(angle) => self.site_for_mut(site).brush.angle = angle,
            Operation::ResetBrush => {
                let site_state = self.site_for_mut(site);
                let color = site_state.brush.color;
                site_state.brush = crate::brush::BrushSettings::default();
                site_state.brush.color = color;
                site_state.active_tip = None;
                site_state.secondary_tip = None;
                site_state.texture_tip = None;
            }
            Operation::SetBrushTip(ref tip_id) => {
                let cloned_tip = tip_id
                    .as_ref()
                    .and_then(|id| self.tip_registry.get(id).cloned());
                let site_state = self.site_for_mut(site);
                site_state.brush.active_tip_id = tip_id.clone();
                site_state.active_tip = cloned_tip;
            }
            Operation::AddLayer { id } => {
                let mut layer = crate::layer::Layer::new(id, self.width, self.height);
                layer.name = format!("Layer {}", self.layers.len() + 1);
                self.layers.push(layer);
                // Keep layer_id_counter past any loaded IDs
                let counter = (id & 0xFFFFFFFF) as u32;
                if counter >= self.layer_id_counter {
                    self.layer_id_counter = counter + 1;
                }
            }
            Operation::RemoveLayer(id) => {
                if let Some(idx) = self.layer_index_by_id(id) {
                    self.layers.remove(idx);
                }
            }
            Operation::SetLayerOpacity { layer, opacity } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.opacity = opacity;
                }
            }
            Operation::SetLayerBlendMode { layer, mode } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.blend_mode = mode;
                }
            }
            Operation::SetLayerVisible { layer, visible } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.visible = visible;
                }
            }
            Operation::SetBackgroundColor { r, g, b } => {
                self.background_color = Color::new(r, g, b);
            }
            Operation::SetCanvasVisible(_) => {
                // Tracked on the TS side
            }
            Operation::SelectionRect { x, y, w, h, mode } => {
                let (width, height) = (self.width, self.height);
                let site_state = self.sites.entry(site).or_default();
                if mode == CombineMode::Replace || site_state.selection.is_none() {
                    let mut mask = SelectionMask::new(width, height);
                    mask.fill_rect(x, y, w, h, CombineMode::Replace);
                    site_state.selection = Some(mask);
                } else if let Some(ref mut mask) = site_state.selection {
                    mask.fill_rect(x, y, w, h, mode);
                }
            }
            Operation::SelectionLasso { points, mode } => {
                let (width, height) = (self.width, self.height);
                let site_state = self.sites.entry(site).or_default();
                if mode == CombineMode::Replace || site_state.selection.is_none() {
                    let mut mask = SelectionMask::new(width, height);
                    mask.fill_polygon(&points, CombineMode::Replace);
                    site_state.selection = Some(mask);
                } else if let Some(ref mut mask) = site_state.selection {
                    mask.fill_polygon(&points, mode);
                }
            }
            Operation::SelectAll => {
                let (width, height) = (self.width, self.height);
                let site_state = self.sites.entry(site).or_default();
                let mut mask = SelectionMask::new_full(width, height);
                mask.dirty = true;
                site_state.selection = Some(mask);
            }
            Operation::Deselect => {
                self.site_for_mut(site).selection = None;
            }
            Operation::ClearLayer { layer } => {
                let sel_data: Option<Vec<u8>> = self
                    .sites
                    .get(&site)
                    .and_then(|s| s.selection.as_ref())
                    .map(|s| s.data.clone());
                if let Some(l) = self.layer_by_id_mut(layer) {
                    if let Some(mask) = sel_data {
                        // Clear only selected pixels
                        for i in 0..mask.len() {
                            if mask[i] > 0 {
                                let px = i * 4;
                                l.pixels[px] = 0;
                                l.pixels[px + 1] = 0;
                                l.pixels[px + 2] = 0;
                                l.pixels[px + 3] = 0;
                            }
                        }
                        l.mark_fully_dirty();
                    } else {
                        l.clear();
                    }
                }
            }
            Operation::RenameLayer { layer, name } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.name = name;
                }
            }
            Operation::MoveLayer { layer, before } => {
                if let Some(from_idx) = self.layer_index_by_id(layer) {
                    let moved = self.layers.remove(from_idx);
                    let insert_at = match before {
                        Some(before_id) => self
                            .layer_index_by_id(before_id)
                            .unwrap_or(self.layers.len()),
                        None => self.layers.len(),
                    };
                    self.layers.insert(insert_at, moved);
                }
            }
            Operation::SetShapeDynamics(dynamics) => {
                self.site_for_mut(site).brush.shape_dynamics = dynamics;
            }
            Operation::SetTransferDynamics(dynamics) => {
                self.site_for_mut(site).brush.transfer_dynamics = dynamics;
            }
            Operation::SetBrushFlipX(flip) => {
                self.site_for_mut(site).brush.flip_x = flip;
            }
            Operation::SetBrushFlipY(flip) => {
                self.site_for_mut(site).brush.flip_y = flip;
            }
            Operation::SetScatter(scatter) => {
                self.site_for_mut(site).brush.scatter = scatter;
            }
            Operation::SetDualBrush(settings) => {
                self.site_for_mut(site).brush.dual_brush = settings;
            }
            Operation::SetSecondaryBrushTip(ref tip_id) => {
                let cloned_tip = tip_id
                    .as_ref()
                    .and_then(|id| self.tip_registry.get(id).cloned());
                let site_state = self.site_for_mut(site);
                site_state.brush.secondary_tip_id = tip_id.clone();
                site_state.secondary_tip = cloned_tip;
            }
            Operation::SetTexture(settings) => {
                self.site_for_mut(site).brush.texture = settings;
            }
            Operation::SetTextureTip(ref tip_id) => {
                let cloned_tip = tip_id
                    .as_ref()
                    .and_then(|id| self.tip_registry.get(id).cloned());
                let site_state = self.site_for_mut(site);
                site_state.brush.texture_tip_id = tip_id.clone();
                site_state.texture_tip = cloned_tip;
            }
            Operation::AddAdjustmentLayer { id, ref kind } => {
                let mut layer =
                    crate::layer::Layer::new_adjustment(id, self.width, self.height, kind.clone());
                let adj_name = match kind {
                    crate::layer::AdjustmentKind::GradientMap { .. } => "Gradient Map",
                };
                layer.name = adj_name.to_string();
                self.layers.push(layer);
                let counter = (id & 0xFFFFFFFF) as u32;
                if counter >= self.layer_id_counter {
                    self.layer_id_counter = counter + 1;
                }
            }
            Operation::SetAdjustmentData { layer, ref kind } => {
                if let Some(l) = self.layer_by_id_mut(layer) {
                    l.kind = crate::layer::LayerKind::Adjustment(kind.clone());
                }
            }
        }
    }
}
