// Surface tension compute shader for wet media paint.
//
// Computes paint boundary curvature from the height field and applies an
// inward restoring force proportional to curvature × surface_tension_coefficient.
// This prevents unrealistic spreading and creates natural edge accumulation
// (bead-up effect) seen in real oil and acrylic paint.
//
// Also adds edge accumulation: at stroke boundaries, paint piles up due to
// the velocity divergence pushing paint outward while surface tension pulls
// it inward, creating a visible ridge.

struct SurfaceTensionParams {
    canvas_width: u32,
    canvas_height: u32,
    surface_tension: f32, // Oil: ~0.7, Acrylic: ~0.4, Watercolor: ~0.1
    edge_accumulation: f32, // Strength of paint buildup at edges (0.0-1.0)
};

@group(0) @binding(0) var velocity_src: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var velocity_dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(3) var props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(5) var color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var<uniform> params: SurfaceTensionParams;

fn sample_props(coord: vec2i, dims: vec2i) -> vec4f {
    let c = clamp(coord, vec2i(0), dims - 1);
    return textureLoad(props_src, c);
}

fn sample_vel(coord: vec2i, dims: vec2i) -> vec2f {
    let c = clamp(coord, vec2i(0), dims - 1);
    return textureLoad(velocity_src, c).rg;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.canvas_width);
    let h = i32(params.canvas_height);

    if (x >= w || y >= h) { return; }

    let coord = vec2i(x, y);
    let dims = vec2i(w, h);

    let props = textureLoad(props_src, coord);
    let height = props.r;
    let wetness = props.g;
    let paint_amount = props.b;

    let vel = textureLoad(velocity_src, coord).rg;
    let color = textureLoad(color_src, coord);

    // Only apply to wet paint
    if (wetness < 0.01 || paint_amount < 0.001) {
        textureStore(velocity_dst, coord, vec4f(vel, 0.0, 0.0));
        textureStore(props_dst, coord, props);
        textureStore(color_dst, coord, color);
        return;
    }

    // --- Surface tension from height curvature ---
    // Compute Laplacian of paint_amount (mean curvature ≈ ∇²h)
    let h_l = sample_props(coord + vec2i(-1, 0), dims).b;
    let h_r = sample_props(coord + vec2i(1, 0), dims).b;
    let h_d = sample_props(coord + vec2i(0, -1), dims).b;
    let h_u = sample_props(coord + vec2i(0, 1), dims).b;

    let laplacian = (h_l + h_r + h_d + h_u - 4.0 * paint_amount);

    // Compute gradient of paint amount (points uphill)
    let grad_h = vec2f(
        0.5 * (h_r - h_l),
        0.5 * (h_u - h_d),
    );

    // Surface tension force: pulls paint inward at boundaries (where curvature is high)
    // F = -σ × ∇(∇²h) approximated as σ × laplacian × grad_direction
    let grad_len = length(grad_h);
    var tension_force = vec2f(0.0);
    if (grad_len > 0.001) {
        // Force points from low paint toward high paint (inward at edges)
        let grad_dir = grad_h / grad_len;
        tension_force = -params.surface_tension * laplacian * grad_dir * wetness;
    }

    // --- Edge accumulation ---
    // At stroke boundaries, velocity divergence is positive (paint spreading outward).
    // Surface tension opposes this, causing paint to pile up at edges.
    let v_r = sample_vel(coord + vec2i(1, 0), dims);
    let v_l = sample_vel(coord + vec2i(-1, 0), dims);
    let v_u = sample_vel(coord + vec2i(0, 1), dims);
    let v_d = sample_vel(coord + vec2i(0, -1), dims);
    let divergence = 0.5 * ((v_r.x - v_l.x) + (v_u.y - v_d.y));

    // Where paint is diverging (spreading), increase height (paint accumulates at edges)
    var height_delta = 0.0;
    if (divergence > 0.0 && grad_len > 0.01) {
        height_delta = params.edge_accumulation * divergence * paint_amount * wetness * 0.1;
    }

    // Apply surface tension to velocity
    let new_vel = vel + tension_force;

    // Update height with edge accumulation effect
    let new_height = height + height_delta;

    textureStore(velocity_dst, coord, vec4f(new_vel, 0.0, 0.0));
    textureStore(props_dst, coord, vec4f(new_height, wetness, paint_amount, props.a));
    textureStore(color_dst, coord, color);
}
