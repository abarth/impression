// Semi-Lagrangian advection compute shader for wet media paint flow.
//
// Moves paint in the direction of the velocity field by tracing each pixel
// backward along the velocity and sampling the source color. Uses ping-pong:
// reads from color_src, writes to color_dst.
//
// Includes vorticity confinement to preserve swirl detail that semi-Lagrangian
// advection would otherwise dampen, and gravity-driven flow for realistic
// paint dripping under its own weight.

struct AdvectParams {
    canvas_width: u32,
    canvas_height: u32,
    dt: f32,         // time step
    dissipation: f32, // velocity dissipation factor (0.95–0.99)
    vorticity_strength: f32, // vorticity confinement epsilon (0.0–1.0)
    gravity_x: f32,  // gravity direction X component
    gravity_y: f32,  // gravity direction Y component (positive = down)
    gravity_strength: f32, // gravity force magnitude (0.0–1.0)
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

// Sample velocity with clamping for vorticity computation.
fn sample_vel_clamped(coord: vec2i, dims: vec2i) -> vec2f {
    let c = clamp(coord, vec2i(0), dims - 1);
    return textureLoad(velocity_src, c).rg;
}

// Compute vorticity (curl of 2D velocity field) at a given coordinate.
// ω = ∂v/∂x - ∂u/∂y (scalar in 2D)
fn compute_vorticity(coord: vec2i, dims: vec2i) -> f32 {
    let v_r = sample_vel_clamped(coord + vec2i(1, 0), dims);
    let v_l = sample_vel_clamped(coord + vec2i(-1, 0), dims);
    let v_u = sample_vel_clamped(coord + vec2i(0, 1), dims);
    let v_d = sample_vel_clamped(coord + vec2i(0, -1), dims);
    return 0.5 * ((v_r.y - v_l.y) - (v_u.x - v_d.x));
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
    let idims = vec2i(i32(params.canvas_width), i32(params.canvas_height));

    // Read velocity at this pixel
    var vel = textureLoad(velocity_src, coord).rg;

    // Read properties for wetness-dependent advection
    let props = textureLoad(props_src, coord);
    let wetness = props.g;
    let height = props.r;
    let viscosity_factor = 1.0 - height * 0.3; // thicker paint moves slower

    // Only advect if there's velocity and the paint is wet
    if (length(vel) < 0.001 && wetness < 0.01) {
        // Pass through unchanged
        textureStore(color_dst, coord, textureLoad(color_src, coord));
        textureStore(props_dst, coord, props);
        textureStore(velocity_dst, coord, vec4f(vel * params.dissipation, 0.0, 0.0));
        return;
    }

    // --- Vorticity confinement ---
    // Preserves swirl detail that semi-Lagrangian advection artificially dampens.
    if (params.vorticity_strength > 0.0 && wetness > 0.01) {
        let omega = compute_vorticity(coord, idims);

        // Compute gradient of |ω| to find direction of vorticity increase
        let omega_r = abs(compute_vorticity(coord + vec2i(1, 0), idims));
        let omega_l = abs(compute_vorticity(coord + vec2i(-1, 0), idims));
        let omega_u = abs(compute_vorticity(coord + vec2i(0, 1), idims));
        let omega_d = abs(compute_vorticity(coord + vec2i(0, -1), idims));

        var N = vec2f(omega_r - omega_l, omega_u - omega_d);
        let N_len = length(N);
        if (N_len > 0.0001) {
            N = N / N_len;
            // Confinement force: F = ε × (N × ω) — in 2D this gives a velocity boost
            let confinement = params.vorticity_strength * vec2f(N.y * omega, -N.x * omega);
            vel += confinement * wetness;
        }
    }

    // --- Gravity-driven flow ---
    // Paint flows under gravity, modulated by wetness and inversely by viscosity (height)
    if (params.gravity_strength > 0.0 && wetness > 0.05) {
        let gravity_dir = vec2f(params.gravity_x, params.gravity_y);
        let gravity_force = gravity_dir * params.gravity_strength * wetness * max(viscosity_factor, 0.1);
        vel += gravity_force;
    }

    // Trace backward: where did this paint come from?
    let effective_wetness = wetness * max(viscosity_factor, 0.2);
    let source_pos = vec2f(f32(x), f32(y)) - vel * params.dt * effective_wetness;

    // Sample color and props at the source position
    let advected_color = bilinear_color(color_src, source_pos, dims);
    let advected_props = bilinear_props(props_src, source_pos, dims);

    textureStore(color_dst, coord, advected_color);
    textureStore(props_dst, coord, advected_props);

    // Dissipate velocity
    textureStore(velocity_dst, coord, vec4f(vel * params.dissipation, 0.0, 0.0));
}
