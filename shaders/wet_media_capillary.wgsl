// Capillary Flow (Phase 5c)
// Paint flows preferentially along canvas grooves (capillary action).
// Creates natural paint settling in canvas valleys and texture-aware diffusion.

struct CapillaryParams {
  capillary_strength: f32,  // how strongly paint follows grooves (0.0-1.0)
  flow_rate: f32,           // base flow rate
  min_wetness: f32,         // minimum wetness for flow to occur
  dt: f32,
}

@group(0) @binding(0) var color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(3) var props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var velocity_src: texture_storage_2d<rg32float, read>;
@group(0) @binding(5) var velocity_dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var paper_tex: texture_storage_2d<r32float, read>;
@group(0) @binding(7) var<uniform> params: CapillaryParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(color_src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let coord = vec2i(gid.xy);

  let props = textureLoad(props_src, coord);
  let wetness = props.g;

  // Skip dry paint — pass through unchanged
  if (wetness < params.min_wetness) {
    textureStore(color_dst, coord, textureLoad(color_src, coord));
    textureStore(props_dst, coord, props);
    textureStore(velocity_dst, coord, textureLoad(velocity_src, coord));
    return;
  }

  // Compute canvas height gradient via central differences (direction of steepest descent)
  let max_coord = vec2i(dims) - vec2i(1);
  let cl = clamp(coord + vec2i(-1, 0), vec2i(0), max_coord);
  let cr = clamp(coord + vec2i(1, 0), vec2i(0), max_coord);
  let cu = clamp(coord + vec2i(0, -1), vec2i(0), max_coord);
  let cd = clamp(coord + vec2i(0, 1), vec2i(0), max_coord);

  let h_l = textureLoad(paper_tex, cl).r;
  let h_r = textureLoad(paper_tex, cr).r;
  let h_u = textureLoad(paper_tex, cu).r;
  let h_d = textureLoad(paper_tex, cd).r;

  // Gradient points downhill (toward canvas valleys)
  let grad = vec2f(h_l - h_r, h_u - h_d) * 0.5;
  let grad_magnitude = length(grad);

  // Capillary force: paint flows toward canvas valleys
  let capillary_vel = grad * params.capillary_strength * wetness * params.flow_rate;

  // Add capillary velocity to existing velocity field
  let old_vel = textureLoad(velocity_src, coord).rg;
  let new_vel = old_vel + capillary_vel * params.dt;

  // Simple 1-step advection of capillary component toward valleys
  let src_coord = vec2f(coord) - capillary_vel * params.dt;
  let src_i = clamp(vec2i(src_coord), vec2i(0), max_coord);
  let neighbor_color = textureLoad(color_src, src_i);
  let self_color = textureLoad(color_src, coord);
  let mix_factor = saturate(grad_magnitude * params.capillary_strength * wetness * params.dt);
  let blended = mix(self_color, neighbor_color, mix_factor * 0.1);

  // Paint settles in valleys: wetness decreases on peaks, increases in valleys
  let canvas_here = textureLoad(paper_tex, coord).r;
  let valley_factor = (1.0 - canvas_here) * 0.5 - canvas_here * 0.5;
  let wetness_shift = valley_factor * params.capillary_strength * 0.01 * params.dt;
  let new_wetness = saturate(wetness + wetness_shift);

  textureStore(color_dst, coord, blended);
  textureStore(props_dst, coord, vec4f(props.r, new_wetness, props.b, props.a));
  textureStore(velocity_dst, coord, vec4f(new_vel, 0.0, 0.0));
}
