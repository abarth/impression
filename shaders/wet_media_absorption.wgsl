// Paint Absorption Model (Phase 5b)
// Canvas material absorbs thin wet paint over time, making it permanent.
// Thin washes and glazes "stain" the canvas and can no longer be mixed.

struct AbsorptionParams {
  absorption_rate: f32,     // base rate (oil=0.01, acrylic=0.05)
  max_absorption: f32,      // maximum absorption level (0.0-1.0)
  canvas_absorbency: f32,   // from paper texture (0.0=sealed, 1.0=raw canvas)
  dt: f32,                  // time step
}

@group(0) @binding(0) var props_src: texture_storage_2d<rgba32float, read>;    // R=height, G=wetness, B=paint_amount
@group(0) @binding(1) var props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var paper_tex: texture_storage_2d<r32float, read>;
@group(0) @binding(3) var<uniform> params: AbsorptionParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(props_src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let coord = vec2i(gid.xy);

  let props = textureLoad(props_src, coord);
  let height = props.r;
  let wetness = props.g;
  let paint_amount = props.b;

  // Canvas absorbency from paper texture: valleys absorb more than peaks
  let canvas_height = textureLoad(paper_tex, coord).r;
  let local_absorbency = params.canvas_absorbency * (1.0 - canvas_height * 0.5);

  // Thin wet paint absorbs faster (thickness_factor is higher for thinner paint)
  let thickness_factor = 1.0 - saturate(height * 2.0);
  let absorption = params.absorption_rate * wetness * thickness_factor * local_absorbency * params.dt;

  // Clamp absorption so wetness never exceeds max_absorption total drain
  let clamped_absorption = min(absorption, wetness * params.max_absorption);

  // Absorbed paint reduces wetness and mixable paint; color stays on canvas
  let new_wetness = max(0.0, wetness - clamped_absorption);
  let new_paint_amount = max(0.0, paint_amount - clamped_absorption * 0.5);

  textureStore(props_dst, coord, vec4f(height, new_wetness, new_paint_amount, props.a));
}
