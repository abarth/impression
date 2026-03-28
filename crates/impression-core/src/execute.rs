use crate::brush::SerializableBrushSettings;
use crate::canvas::{Canvas, WetMediaReplayEvent};
use crate::color::Color;
use crate::dynamics;
use crate::operation::{Operation, SiteOperation};
use crate::selection::{CombineMode, SelectionMask};
use crate::stroke;
use crate::wet_media::{self, BrushModel};

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
                let site_state = self.sites.entry(site).or_default();
                let pressure = dynamics::remap_pressure(pressure, site_state.brush.pressure_curve);
                site_state.stroke_layer = layer;
                if site_state.brush.brush_model == BrushModel::WetMedia {
                    let brush = &site_state.brush;
                    let color = [
                        brush.color.r as f32 / 255.0,
                        brush.color.g as f32 / 255.0,
                        brush.color.b as f32 / 255.0,
                    ];
                    let rng = &mut site_state.wet_media_stroke.rng;
                    // Apply shape dynamics
                    let effective_size = dynamics::apply_dynamic(
                        &brush.shape_dynamics.size, brush.size, pressure, rng, 0.0,
                    );
                    let effective_angle = dynamics::apply_angle_dynamic(
                        &brush.shape_dynamics.angle, brush.angle, pressure, rng, 0.0,
                    );
                    let effective_roundness = dynamics::apply_dynamic(
                        &brush.shape_dynamics.roundness, brush.roundness, pressure, rng, 0.0,
                    );
                    // Apply transfer dynamics (flow → paint_load scaling, opacity → multiplier)
                    let flow_factor = dynamics::apply_dynamic(
                        &brush.transfer_dynamics.flow, 1.0, pressure, rng, 0.0,
                    );
                    let opacity_multiplier = dynamics::apply_dynamic(
                        &brush.transfer_dynamics.opacity, 1.0, pressure, rng, 0.0,
                    );
                    wet_media::wet_media_stroke_begin(
                        &mut site_state.wet_media_stroke,
                        x, y, pressure,
                        effective_size, effective_angle, effective_roundness, brush.spacing,
                        &brush.wet_media,
                        color,
                    );
                    // Apply transfer dynamics to footprints
                    for fp in site_state.wet_media_stroke.footprints.iter_mut() {
                        fp.paint_load *= flow_factor;
                        fp.opacity_multiplier = opacity_multiplier;
                    }
                    // During replay (undo/redo), drain footprints into replay events
                    // so TS can re-execute them on GPU. During normal painting,
                    // leave them in place for TS to read via wet_media_footprint_count().
                    if self.is_replaying {
                        let replay_layer = layer;
                        let footprints: Vec<_> = site_state.wet_media_stroke.footprints.drain(..).collect();
                        for fp in footprints {
                            self.wet_media_replay_events.push(WetMediaReplayEvent::Deposit {
                                layer: replay_layer,
                                footprint: fp,
                            });
                        }
                    }
                } else {
                    let params = stroke::StrokeParams {
                        brush: &site_state.brush,
                        active_tip: site_state.active_tip.as_ref(),
                        secondary_tip: site_state.secondary_tip.as_ref(),
                        texture_tip: site_state.texture_tip.as_ref(),
                        selection: site_state.selection.as_ref().map(|s| s.data.as_slice()),
                    };
                    if let Some(l) = self.layers.iter_mut().find(|l| l.id == layer) {
                        stroke::stroke_begin(l, &mut site_state.stroke_state, &params, x, y, pressure);
                    }
                }
            }
            Operation::StrokeMove { x, y, pressure } => {
                let site_state = self.sites.entry(site).or_default();
                let pressure = dynamics::remap_pressure(pressure, site_state.brush.pressure_curve);
                let is_wet_media = site_state.brush.brush_model == BrushModel::WetMedia;
                if is_wet_media {
                    let brush = &site_state.brush;
                    let color = [
                        brush.color.r as f32 / 255.0,
                        brush.color.g as f32 / 255.0,
                        brush.color.b as f32 / 255.0,
                    ];
                    // Compute stroke direction from previous point
                    let (lx, ly) = site_state.wet_media_stroke.last_point
                        .map(|(px, py, _)| (px, py))
                        .unwrap_or((x, y));
                    let dx = x - lx;
                    let dy = y - ly;
                    let direction_angle = dy.atan2(dx).to_degrees();
                    let rng = &mut site_state.wet_media_stroke.rng;
                    // Apply shape dynamics
                    let effective_size = dynamics::apply_dynamic(
                        &brush.shape_dynamics.size, brush.size, pressure, rng, direction_angle,
                    );
                    let effective_angle = dynamics::apply_angle_dynamic(
                        &brush.shape_dynamics.angle, brush.angle, pressure, rng, direction_angle,
                    );
                    let effective_roundness = dynamics::apply_dynamic(
                        &brush.shape_dynamics.roundness, brush.roundness, pressure, rng, direction_angle,
                    );
                    // Apply transfer dynamics
                    let flow_factor = dynamics::apply_dynamic(
                        &brush.transfer_dynamics.flow, 1.0, pressure, rng, direction_angle,
                    );
                    let opacity_multiplier = dynamics::apply_dynamic(
                        &brush.transfer_dynamics.opacity, 1.0, pressure, rng, direction_angle,
                    );
                    let footprint_start = site_state.wet_media_stroke.footprints.len();
                    wet_media::wet_media_stroke_move(
                        &mut site_state.wet_media_stroke,
                        x, y, pressure,
                        effective_size, effective_angle, effective_roundness, brush.spacing,
                        &brush.wet_media,
                        color,
                    );
                    // Apply transfer dynamics to newly generated footprints
                    for fp in site_state.wet_media_stroke.footprints[footprint_start..].iter_mut() {
                        fp.paint_load *= flow_factor;
                        fp.opacity_multiplier = opacity_multiplier;
                    }
                    if self.is_replaying {
                        let replay_layer = site_state.stroke_layer;
                        let footprints: Vec<_> = site_state.wet_media_stroke.footprints.drain(..).collect();
                        for fp in footprints {
                            self.wet_media_replay_events.push(WetMediaReplayEvent::Deposit {
                                layer: replay_layer,
                                footprint: fp,
                            });
                        }
                    }
                } else {
                    let stroke_layer = site_state.stroke_layer;
                    let params = stroke::StrokeParams {
                        brush: &site_state.brush,
                        active_tip: site_state.active_tip.as_ref(),
                        secondary_tip: site_state.secondary_tip.as_ref(),
                        texture_tip: site_state.texture_tip.as_ref(),
                        selection: site_state.selection.as_ref().map(|s| s.data.as_slice()),
                    };
                    if let Some(l) = self.layers.iter_mut().find(|l| l.id == stroke_layer) {
                        stroke::stroke_move(l, &mut site_state.stroke_state, &params, x, y, pressure);
                    }
                }
            }
            Operation::StrokeEnd => {
                let site_state = self.site_for_mut(site);
                if site_state.brush.brush_model == BrushModel::WetMedia {
                    wet_media::wet_media_stroke_end(&mut site_state.wet_media_stroke);
                } else {
                    stroke::stroke_end(&mut site_state.stroke_state);
                }
            }
            Operation::SetBrushSettings(ref data) => {
                match SerializableBrushSettings::from_bytes(data) {
                    Ok(s) => {
                        self.apply_brush_settings_internal(site, &s);
                    }
                    Err(e) => {
                        crate::console_log!("Failed to deserialize brush settings: {}", e);
                    }
                }
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
            Operation::WetMediaSimStep { layer, frames } => {
                // Simulation runs on GPU — no CPU-side effect.
                // During replay, record so TS can re-run simulation steps.
                if self.is_replaying {
                    self.wet_media_replay_events.push(WetMediaReplayEvent::SimStep {
                        layer,
                        frames,
                    });
                }
            }
            Operation::AddWetMediaLayer { id } => {
                let mut layer =
                    crate::layer::Layer::new_wet_media(id, self.width, self.height);
                layer.name = format!("Wet Media {}", self.layers.len() + 1);
                self.layers.push(layer);
                let counter = (id & 0xFFFFFFFF) as u32;
                if counter >= self.layer_id_counter {
                    self.layer_id_counter = counter + 1;
                }
            }
        }
    }
}
