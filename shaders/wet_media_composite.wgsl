// Wet media layer compositing with impasto lighting.
//
// Group 0: wet media layer data
//   binding 0: color texture (rgba32float) — paint color + opacity
//   binding 1: properties texture (rgba32float) — R=height, G=wetness, B=paint_amount
//   binding 2: sampler
//   binding 3: uniforms (opacity as f32 bits, blend mode)
//
// Group 1: destination (accumulated result from previous layers)
//   binding 0: dst texture

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var propsTexture: texture_2d<f32>;
@group(0) @binding(2) var wetSampler: sampler;
@group(0) @binding(3) var<uniform> layerUniforms: vec2u;

@group(1) @binding(0) var dstTexture: texture_2d<f32>;

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

// Compute surface normal from height field using central differences.
fn compute_normal(uv: vec2f) -> vec3f {
    let dims = vec2f(textureDimensions(propsTexture));
    let texel = 1.0 / dims;

    let h_l = textureSample(propsTexture, wetSampler, uv - vec2f(texel.x, 0.0)).r;
    let h_r = textureSample(propsTexture, wetSampler, uv + vec2f(texel.x, 0.0)).r;
    let h_d = textureSample(propsTexture, wetSampler, uv - vec2f(0.0, texel.y)).r;
    let h_u = textureSample(propsTexture, wetSampler, uv + vec2f(0.0, texel.y)).r;

    // Height scale factor: controls how pronounced the impasto effect is.
    let height_scale = 4.0;
    let dx = (h_r - h_l) * height_scale;
    let dy = (h_u - h_d) * height_scale;

    return normalize(vec3f(-dx, -dy, 1.0));
}

@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(colorTexture, wetSampler, in.uv);
    let props = textureSample(propsTexture, wetSampler, in.uv);
    let dst = textureSample(dstTexture, wetSampler, in.uv);

    let opacity = bitcast<f32>(layerUniforms.x);
    let height = props.r;
    let wetness = props.g;

    // Compute impasto lighting from height field
    let normal = compute_normal(in.uv);

    // Light direction: top-left, slightly toward viewer
    let light_dir = normalize(vec3f(-0.4, -0.6, 0.8));

    // Diffuse lighting
    let ndotl = max(dot(normal, light_dir), 0.0);
    let ambient = 0.6;
    let diffuse = 0.4 * ndotl;
    let lighting = ambient + diffuse;

    // Specular highlight (Blinn-Phong) — stronger for wet paint
    let view_dir = vec3f(0.0, 0.0, 1.0);
    let half_dir = normalize(light_dir + view_dir);
    let spec = pow(max(dot(normal, half_dir), 0.0), 32.0);
    // Wet paint is shinier
    let spec_strength = 0.3 * wetness;

    // Apply lighting to paint color
    let lit_color = src.rgb * lighting + vec3f(spec * spec_strength);
    let lit_color_clamped = clamp(lit_color, vec3f(0.0), vec3f(1.0));

    let src_a = src.a * opacity;

    // Composite over destination (normal blend)
    let result_rgb = src_a * lit_color_clamped + (1.0 - src_a) * dst.rgb;
    let result_a = src_a + dst.a * (1.0 - src_a);

    return vec4f(result_rgb, result_a);
}
