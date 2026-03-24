// Diffusion compute shader for wet media paint.
//
// Spreads wet paint laterally using a weighted Gaussian blur.
// Only wet paint diffuses — dry paint stays put.

struct DiffuseParams {
    canvas_width: u32,
    canvas_height: u32,
    diffusion_rate: f32, // 0.0–1.0, how fast wet paint spreads
    _pad: f32,
};

@group(0) @binding(0) var color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(3) var props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var<uniform> params: DiffuseParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.canvas_width);
    let h = i32(params.canvas_height);

    if (x >= w || y >= h) {
        return;
    }

    let coord = vec2i(x, y);
    let center_color = textureLoad(color_src, coord);
    let center_props = textureLoad(props_src, coord);
    let wetness = center_props.g;

    // Only diffuse wet paint
    if (wetness < 0.01) {
        textureStore(color_dst, coord, center_color);
        textureStore(props_dst, coord, center_props);
        return;
    }

    // 3x3 Gaussian kernel weighted by neighbor wetness
    var sum_color = vec4f(0.0);
    var sum_props = vec4f(0.0);
    var total_weight: f32 = 0.0;

    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let nx = clamp(x + dx, 0, w - 1);
            let ny = clamp(y + dy, 0, h - 1);
            let ncoord = vec2i(nx, ny);

            let n_color = textureLoad(color_src, ncoord);
            let n_props = textureLoad(props_src, ncoord);
            let n_wetness = n_props.g;

            // Gaussian weight: center=1.0, adjacent=0.5, diagonal=0.25
            let dist_weight = select(select(0.25, 0.5, dx == 0 || dy == 0), 1.0, dx == 0 && dy == 0);
            let weight = dist_weight * max(wetness, n_wetness);

            sum_color += n_color * weight;
            sum_props += n_props * weight;
            total_weight += weight;
        }
    }

    let avg_color = sum_color / total_weight;
    let avg_props = sum_props / total_weight;

    // Blend between original and diffused based on wetness and diffusion rate
    let blend = wetness * params.diffusion_rate * 0.1; // small factor for stability
    let new_color = mix(center_color, avg_color, blend);
    let new_props = mix(center_props, avg_props, blend);

    textureStore(color_dst, coord, new_color);
    textureStore(props_dst, coord, new_props);
}
