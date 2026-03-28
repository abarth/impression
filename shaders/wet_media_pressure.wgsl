// Jacobi pressure projection compute shader for incompressible wet media flow.
//
// Enforces mass conservation by solving the pressure Poisson equation:
//   ∇²p = ∇·v  (divergence of velocity)
// Then subtracts the pressure gradient from velocity:
//   v_new = v - ∇p
//
// This shader performs a single Jacobi iteration. The caller dispatches it
// multiple times (20-40 iterations) for convergence. Uses ping-pong on
// the pressure field: reads from pressure_src, writes to pressure_dst.
// After all iterations, a final pass subtracts ∇p from velocity.

struct PressureParams {
    canvas_width: u32,
    canvas_height: u32,
    // 0 = Jacobi iteration step, 1 = divergence computation, 2 = gradient subtraction
    phase: u32,
    _pad: u32,
};

@group(0) @binding(0) var velocity_src: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var velocity_dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var pressure_src: texture_storage_2d<r32float, read>;
@group(0) @binding(3) var pressure_dst: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var divergence_tex: texture_storage_2d<r32float, read>;
@group(0) @binding(5) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(6) var<uniform> params: PressureParams;

// Read velocity with boundary clamping (no-slip at edges).
fn sample_vel(coord: vec2i, dims: vec2i) -> vec2f {
    let c = clamp(coord, vec2i(0), dims - 1);
    return textureLoad(velocity_src, c).rg;
}

fn sample_pressure(coord: vec2i, dims: vec2i) -> f32 {
    let c = clamp(coord, vec2i(0), dims - 1);
    return textureLoad(pressure_src, c).r;
}

fn sample_divergence(coord: vec2i, dims: vec2i) -> f32 {
    let c = clamp(coord, vec2i(0), dims - 1);
    return textureLoad(divergence_tex, c).r;
}

@compute @workgroup_size(8, 8)
fn divergence_pass(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.canvas_width);
    let h = i32(params.canvas_height);

    if (x >= w || y >= h) { return; }

    let coord = vec2i(x, y);
    let dims = vec2i(w, h);

    // Only compute divergence where paint is wet
    let props = textureLoad(props_src, coord);
    let wetness = props.g;

    if (wetness < 0.01) {
        textureStore(pressure_dst, coord, vec4f(0.0));
        return;
    }

    // Central differences for divergence: ∇·v = ∂u/∂x + ∂v/∂y
    let v_r = sample_vel(coord + vec2i(1, 0), dims);
    let v_l = sample_vel(coord + vec2i(-1, 0), dims);
    let v_u = sample_vel(coord + vec2i(0, 1), dims);
    let v_d = sample_vel(coord + vec2i(0, -1), dims);

    let div = 0.5 * ((v_r.x - v_l.x) + (v_u.y - v_d.y));

    // Store divergence (using pressure_dst as temporary storage for divergence)
    textureStore(pressure_dst, coord, vec4f(div, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn jacobi_pass(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.canvas_width);
    let h = i32(params.canvas_height);

    if (x >= w || y >= h) { return; }

    let coord = vec2i(x, y);
    let dims = vec2i(w, h);

    // Only solve where paint is wet
    let props = textureLoad(props_src, coord);
    let wetness = props.g;

    if (wetness < 0.01) {
        textureStore(pressure_dst, coord, vec4f(0.0));
        return;
    }

    // Jacobi iteration: p_new = (p_L + p_R + p_D + p_U - divergence) / 4.0
    let p_l = sample_pressure(coord + vec2i(-1, 0), dims);
    let p_r = sample_pressure(coord + vec2i(1, 0), dims);
    let p_d = sample_pressure(coord + vec2i(0, -1), dims);
    let p_u = sample_pressure(coord + vec2i(0, 1), dims);

    let div = sample_divergence(coord, dims);

    let p_new = (p_l + p_r + p_d + p_u - div) * 0.25;

    textureStore(pressure_dst, coord, vec4f(p_new, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn gradient_subtract(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.canvas_width);
    let h = i32(params.canvas_height);

    if (x >= w || y >= h) { return; }

    let coord = vec2i(x, y);
    let dims = vec2i(w, h);

    let props = textureLoad(props_src, coord);
    let wetness = props.g;

    let vel = textureLoad(velocity_src, coord).rg;

    if (wetness < 0.01) {
        textureStore(velocity_dst, coord, vec4f(vel, 0.0, 0.0));
        return;
    }

    // Subtract pressure gradient: v_new = v - ∇p
    let p_l = sample_pressure(coord + vec2i(-1, 0), dims);
    let p_r = sample_pressure(coord + vec2i(1, 0), dims);
    let p_d = sample_pressure(coord + vec2i(0, -1), dims);
    let p_u = sample_pressure(coord + vec2i(0, 1), dims);

    let grad_p = vec2f(
        0.5 * (p_r - p_l),
        0.5 * (p_u - p_d),
    );

    let new_vel = vel - grad_p;

    textureStore(velocity_dst, coord, vec4f(new_vel, 0.0, 0.0));
}
