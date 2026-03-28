// Horizon-Based Ambient Occlusion (HBAO) for wet media impasto self-shadowing.
//
// Computes screen-space shadow/AO from the paint height field by marching along
// the height map in multiple directions and finding the maximum horizon angle.
// Produces a single-channel shadow factor (0=fully shadowed, 1=fully lit).

struct ShadowParams {
    canvas_width: u32,
    canvas_height: u32,
    // Light elevation angle in radians (higher = more overhead light).
    light_elevation: f32,
    // Light azimuth angle in radians.
    light_azimuth: f32,
    // Shadow intensity (0=no shadows, 1=full shadows).
    shadow_intensity: f32,
    // Height scale for shadow computation.
    height_scale: f32,
    // Maximum march distance in pixels.
    max_distance: f32,
    // Medium type: 0=Oil, 1=Acrylic, 2=Watercolor
    medium_type: u32,
};

@group(0) @binding(0) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var shadow_dst: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> params: ShadowParams;

// Sample height from properties texture (R channel).
fn sample_height(coord: vec2i) -> f32 {
    let c = clamp(coord, vec2i(0), vec2i(i32(params.canvas_width) - 1, i32(params.canvas_height) - 1));
    return textureLoad(props_src, c).r;
}

// March along a direction and compute the maximum horizon angle.
// Returns the tangent (rise/run) of the maximum horizon seen.
fn march_horizon(origin: vec2i, origin_height: f32, dir: vec2f, steps: u32) -> f32 {
    var max_tan: f32 = -999.0;
    let max_dist = params.max_distance;

    for (var i = 1u; i <= steps; i++) {
        let dist = f32(i) * 2.0; // step size = 2 pixels
        if (dist > max_dist) { break; }

        let sample_pos = vec2i(origin) + vec2i(vec2f(dir * dist) + 0.5);
        let h = sample_height(sample_pos) * params.height_scale;
        let dh = h - origin_height * params.height_scale;
        let tan_angle = dh / dist;
        max_tan = max(max_tan, tan_angle);
    }
    return max_tan;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.canvas_width);
    let h = i32(params.canvas_height);

    if (x >= w || y >= h) { return; }

    let coord = vec2i(x, y);
    let center_height = sample_height(coord);

    // Skip shadow computation for empty areas
    if (center_height < 0.001) {
        textureStore(shadow_dst, coord, vec4f(1.0, 0.0, 0.0, 0.0));
        return;
    }

    let max_steps = u32(params.max_distance * 0.5);

    // 8-direction HBAO: march in 8 evenly-spaced directions
    let directions = array<vec2f, 8>(
        vec2f(1.0, 0.0),
        vec2f(0.707, 0.707),
        vec2f(0.0, 1.0),
        vec2f(-0.707, 0.707),
        vec2f(-1.0, 0.0),
        vec2f(-0.707, -0.707),
        vec2f(0.0, -1.0),
        vec2f(0.707, -0.707),
    );

    var ao_sum: f32 = 0.0;

    for (var d = 0u; d < 8u; d++) {
        let horizon_tan = march_horizon(coord, center_height, directions[d], max_steps);

        // Convert horizon tangent to an occlusion factor.
        // If the horizon is above the surface tangent plane, there's occlusion.
        // Higher horizon = more occlusion.
        let horizon_angle = atan(horizon_tan);
        let occlusion = clamp(horizon_angle / (3.14159 * 0.5), 0.0, 1.0);
        ao_sum += occlusion;
    }

    // Average AO across all directions
    let ao = ao_sum / 8.0;

    // Directional shadow from light source
    let light_dir = vec2f(
        cos(params.light_azimuth),
        sin(params.light_azimuth),
    );
    let light_horizon = march_horizon(coord, center_height, light_dir, max_steps);
    let light_angle = atan(light_horizon);
    let light_shadow = clamp(light_angle / params.light_elevation, 0.0, 1.0);

    // Combine AO and directional shadow
    let combined = 1.0 - params.shadow_intensity * (ao * 0.6 + light_shadow * 0.4);
    let final_shadow = clamp(combined, 0.0, 1.0);

    textureStore(shadow_dst, coord, vec4f(final_shadow, 0.0, 0.0, 0.0));
}
