// Semi-Lagrangian advection compute shader for wet media paint flow.
//
// Moves paint in the direction of the velocity field by tracing each pixel
// backward along the velocity and sampling the source color. Uses ping-pong:
// reads from color_src, writes to color_dst.

struct AdvectParams {
    canvas_width: u32,
    canvas_height: u32,
    dt: f32,         // time step
    dissipation: f32, // velocity dissipation factor (0.95–0.99)
};

@group(0) @binding(0) var color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(3) var props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var velocity_src: texture_storage_2d<rg32float, read>;
@group(0) @binding(5) var velocity_dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var<uniform> params: AdvectParams;

// Bilinear sample from a storage texture (manual, since textureLoad is point-only).
fn bilinear_color(tex: texture_storage_2d<rgba32float, read>, pos: vec2f, dims: vec2f) -> vec4f {
    let clamped = clamp(pos, vec2f(0.0), dims - vec2f(1.0));
    let floor_pos = floor(clamped);
    let frac = clamped - floor_pos;
    let c00 = textureLoad(tex, vec2i(floor_pos));
    let c10 = textureLoad(tex, vec2i(floor_pos) + vec2i(1, 0));
    let c01 = textureLoad(tex, vec2i(floor_pos) + vec2i(0, 1));
    let c11 = textureLoad(tex, vec2i(floor_pos) + vec2i(1, 1));
    let top = mix(c00, c10, frac.x);
    let bot = mix(c01, c11, frac.x);
    return mix(top, bot, frac.y);
}

fn bilinear_props(tex: texture_storage_2d<rgba32float, read>, pos: vec2f, dims: vec2f) -> vec4f {
    let clamped = clamp(pos, vec2f(0.0), dims - vec2f(1.0));
    let floor_pos = floor(clamped);
    let frac = clamped - floor_pos;
    let c00 = textureLoad(tex, vec2i(floor_pos));
    let c10 = textureLoad(tex, vec2i(floor_pos) + vec2i(1, 0));
    let c01 = textureLoad(tex, vec2i(floor_pos) + vec2i(0, 1));
    let c11 = textureLoad(tex, vec2i(floor_pos) + vec2i(1, 1));
    let top = mix(c00, c10, frac.x);
    let bot = mix(c01, c11, frac.x);
    return mix(top, bot, frac.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;

    if (x >= params.canvas_width || y >= params.canvas_height) {
        return;
    }

    let coord = vec2i(i32(x), i32(y));
    let dims = vec2f(f32(params.canvas_width), f32(params.canvas_height));

    // Read velocity at this pixel
    let vel = textureLoad(velocity_src, coord).rg;

    // Read properties for wetness-dependent advection
    let props = textureLoad(props_src, coord);
    let wetness = props.g;

    // Only advect if there's velocity and the paint is wet
    if (length(vel) < 0.001 || wetness < 0.01) {
        // Pass through unchanged
        textureStore(color_dst, coord, textureLoad(color_src, coord));
        textureStore(props_dst, coord, props);
        textureStore(velocity_dst, coord, vec4f(vel * params.dissipation, 0.0, 0.0));
        return;
    }

    // Trace backward: where did this paint come from?
    let source_pos = vec2f(f32(x), f32(y)) - vel * params.dt * wetness;

    // Sample color and props at the source position
    let advected_color = bilinear_color(color_src, source_pos, dims);
    let advected_props = bilinear_props(props_src, source_pos, dims);

    textureStore(color_dst, coord, advected_color);
    textureStore(props_dst, coord, advected_props);

    // Dissipate velocity
    textureStore(velocity_dst, coord, vec4f(vel * params.dissipation, 0.0, 0.0));
}
