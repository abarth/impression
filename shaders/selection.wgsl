@group(0) @binding(0) var selectionTexture: texture_2d<f32>;
@group(0) @binding(1) var selectionSampler: sampler;
@group(0) @binding(2) var<uniform> time: f32;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VertexOutput;
    out.position = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2f(uv.x, 1.0 - uv.y);
    return out;
}

@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let dims = vec2f(textureDimensions(selectionTexture, 0));
    let texel = 1.0 / dims;

    let c = textureSample(selectionTexture, selectionSampler, in.uv).r;
    let l = textureSample(selectionTexture, selectionSampler, in.uv + vec2f(-texel.x, 0.0)).r;
    let r = textureSample(selectionTexture, selectionSampler, in.uv + vec2f(texel.x, 0.0)).r;
    let t = textureSample(selectionTexture, selectionSampler, in.uv + vec2f(0.0, -texel.y)).r;
    let b = textureSample(selectionTexture, selectionSampler, in.uv + vec2f(0.0, texel.y)).r;

    // Edge detection: current pixel differs from any neighbor
    let threshold = 0.5;
    let is_selected = c > threshold;
    let neighbor_diff = (l < threshold) || (r < threshold) || (t < threshold) || (b < threshold);
    let is_edge = is_selected && neighbor_diff;

    if !is_edge {
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }

    // Marching ants: diagonal stripe pattern that shifts with time
    let screen_pos = in.uv * dims;
    let pattern = fract((screen_pos.x + screen_pos.y) * 0.125 - time * 3.0);
    let stripe = select(0.0, 1.0, pattern > 0.5);

    // Black and white alternating dashes
    return vec4f(stripe, stripe, stripe, 1.0);
}
