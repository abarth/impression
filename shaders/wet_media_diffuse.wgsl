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
@group(0) @binding(5) var paper_texture: texture_storage_2d<r32float, read>;
@group(0) @binding(6) var mixbox_lut: texture_2d<f32>;
@group(0) @binding(7) var mixbox_lut_sampler: sampler;

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

    // 3x3 Gaussian kernel weighted by neighbor wetness and paper height similarity
    // Accumulate in Mixbox latent pigment space for physically accurate color diffusion
    let center_paper = textureLoad(paper_texture, coord).r;
    let center_latent = mixbox_rgb_to_latent(center_color.rgb, mixbox_lut, mixbox_lut_sampler);

    var latent_sum = MixboxLatent(vec3f(0.0), vec3f(0.0));
    var alpha_sum: f32 = 0.0;
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

            // Paper height similarity: paint flows more easily between similar-height texels
            let n_paper = textureLoad(paper_texture, ncoord).r;
            let paper_similarity = 1.0 - abs(center_paper - n_paper);

            // Gaussian weight: center=1.0, adjacent=0.5, diagonal=0.25
            let dist_weight = select(select(0.25, 0.5, dx == 0 || dy == 0), 1.0, dx == 0 && dy == 0);
            let weight = dist_weight * max(wetness, n_wetness) * paper_similarity;

            // Accumulate in latent pigment space
            let n_latent = mixbox_rgb_to_latent(n_color.rgb, mixbox_lut, mixbox_lut_sampler);
            latent_sum = mixbox_latent_add(latent_sum, mixbox_latent_scale(n_latent, weight));
            alpha_sum += n_color.a * weight;
            sum_props += n_props * weight;
            total_weight += weight;
        }
    }

    let avg_latent = MixboxLatent(latent_sum.coeffs / total_weight, latent_sum.residual / total_weight);
    let avg_color_rgb = mixbox_latent_to_rgb(avg_latent);
    let avg_alpha = alpha_sum / total_weight;
    let avg_props = sum_props / total_weight;

    // Blend between original and diffused based on wetness and diffusion rate
    let blend = wetness * params.diffusion_rate * 0.1; // small factor for stability
    let blended_rgb = mixbox_lerp(center_color.rgb, avg_color_rgb, blend, mixbox_lut, mixbox_lut_sampler);
    let new_color = vec4f(blended_rgb, mix(center_color.a, avg_alpha, blend));
    let new_props = mix(center_props, avg_props, blend);

    textureStore(color_dst, coord, new_color);
    textureStore(props_dst, coord, new_props);
}
