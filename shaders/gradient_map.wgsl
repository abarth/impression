// Gradient Map adjustment layer shader
//
// Reads the accumulated composite (dst), computes luminance,
// samples a 1D gradient texture at that luminance, then blends
// the mapped color back over dst with opacity and blend mode.

// Group 0: gradient texture (256×1 RGBA) + sampler + uniforms (opacity, blend mode)
@group(0) @binding(0) var gradientTexture: texture_2d<f32>;
@group(0) @binding(1) var gradientSampler: sampler;
@group(0) @binding(2) var<uniform> layerUniforms: vec2u;

// Group 1: destination (accumulated result from layers below)
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

// --- Blend mode functions (must match composite.wgsl) ---

fn blend_normal(s: vec3f, d: vec3f) -> vec3f { return s; }
fn blend_darken(s: vec3f, d: vec3f) -> vec3f { return min(s, d); }
fn blend_multiply(s: vec3f, d: vec3f) -> vec3f { return s * d; }

fn blend_color_burn(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(1.0 - min(1.0, (1.0 - d.x) / s.x), 0.0, s.x == 0.0),
        select(1.0 - min(1.0, (1.0 - d.y) / s.y), 0.0, s.y == 0.0),
        select(1.0 - min(1.0, (1.0 - d.z) / s.z), 0.0, s.z == 0.0),
    );
}

fn blend_linear_burn(s: vec3f, d: vec3f) -> vec3f {
    return max(s + d - 1.0, vec3f(0.0));
}

fn blend_lighten(s: vec3f, d: vec3f) -> vec3f { return max(s, d); }
fn blend_screen(s: vec3f, d: vec3f) -> vec3f { return s + d - s * d; }

fn blend_color_dodge(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(min(1.0, d.x / (1.0 - s.x)), 1.0, s.x == 1.0),
        select(min(1.0, d.y / (1.0 - s.y)), 1.0, s.y == 1.0),
        select(min(1.0, d.z / (1.0 - s.z)), 1.0, s.z == 1.0),
    );
}

fn blend_linear_dodge(s: vec3f, d: vec3f) -> vec3f {
    return min(s + d, vec3f(1.0));
}

fn blend_overlay(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(1.0 - 2.0 * (1.0 - s.x) * (1.0 - d.x), 2.0 * s.x * d.x, d.x < 0.5),
        select(1.0 - 2.0 * (1.0 - s.y) * (1.0 - d.y), 2.0 * s.y * d.y, d.y < 0.5),
        select(1.0 - 2.0 * (1.0 - s.z) * (1.0 - d.z), 2.0 * s.z * d.z, d.z < 0.5),
    );
}

fn soft_light_d(x: f32) -> f32 {
    if (x <= 0.25) {
        return ((16.0 * x - 12.0) * x + 4.0) * x;
    }
    return sqrt(x);
}

fn blend_soft_light(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(d.x + (2.0 * s.x - 1.0) * (soft_light_d(d.x) - d.x), d.x - (1.0 - 2.0 * s.x) * d.x * (1.0 - d.x), s.x <= 0.5),
        select(d.y + (2.0 * s.y - 1.0) * (soft_light_d(d.y) - d.y), d.y - (1.0 - 2.0 * s.y) * d.y * (1.0 - d.y), s.y <= 0.5),
        select(d.z + (2.0 * s.z - 1.0) * (soft_light_d(d.z) - d.z), d.z - (1.0 - 2.0 * s.z) * d.z * (1.0 - d.z), s.z <= 0.5),
    );
}

fn blend_hard_light(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(1.0 - 2.0 * (1.0 - s.x) * (1.0 - d.x), 2.0 * s.x * d.x, s.x < 0.5),
        select(1.0 - 2.0 * (1.0 - s.y) * (1.0 - d.y), 2.0 * s.y * d.y, s.y < 0.5),
        select(1.0 - 2.0 * (1.0 - s.z) * (1.0 - d.z), 2.0 * s.z * d.z, s.z < 0.5),
    );
}

fn blend_vivid_light(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(
            select(min(1.0, d.x / (2.0 * (1.0 - s.x))), 1.0, s.x >= 1.0),
            select(1.0 - min(1.0, (1.0 - d.x) / (2.0 * s.x)), 0.0, s.x == 0.0),
            s.x <= 0.5
        ),
        select(
            select(min(1.0, d.y / (2.0 * (1.0 - s.y))), 1.0, s.y >= 1.0),
            select(1.0 - min(1.0, (1.0 - d.y) / (2.0 * s.y)), 0.0, s.y == 0.0),
            s.y <= 0.5
        ),
        select(
            select(min(1.0, d.z / (2.0 * (1.0 - s.z))), 1.0, s.z >= 1.0),
            select(1.0 - min(1.0, (1.0 - d.z) / (2.0 * s.z)), 0.0, s.z == 0.0),
            s.z <= 0.5
        ),
    );
}

fn blend_linear_light(s: vec3f, d: vec3f) -> vec3f {
    return clamp(d + 2.0 * s - 1.0, vec3f(0.0), vec3f(1.0));
}

fn blend_pin_light(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(max(d.x, 2.0 * s.x - 1.0), min(d.x, 2.0 * s.x), s.x <= 0.5),
        select(max(d.y, 2.0 * s.y - 1.0), min(d.y, 2.0 * s.y), s.y <= 0.5),
        select(max(d.z, 2.0 * s.z - 1.0), min(d.z, 2.0 * s.z), s.z <= 0.5),
    );
}

fn blend_hard_mix(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(0.0, 1.0, s.x + d.x >= 1.0),
        select(0.0, 1.0, s.y + d.y >= 1.0),
        select(0.0, 1.0, s.z + d.z >= 1.0),
    );
}

fn blend_difference(s: vec3f, d: vec3f) -> vec3f { return abs(s - d); }
fn blend_exclusion(s: vec3f, d: vec3f) -> vec3f { return s + d - 2.0 * s * d; }
fn blend_subtract(s: vec3f, d: vec3f) -> vec3f { return max(d - s, vec3f(0.0)); }

fn blend_divide(s: vec3f, d: vec3f) -> vec3f {
    return vec3f(
        select(min(1.0, d.x / s.x), 1.0, s.x == 0.0),
        select(min(1.0, d.y / s.y), 1.0, s.y == 0.0),
        select(min(1.0, d.z / s.z), 1.0, s.z == 0.0),
    );
}

fn apply_blend(s: vec3f, d: vec3f, mode: u32) -> vec3f {
    switch (mode) {
        case 0u:  { return blend_normal(s, d); }
        case 1u:  { return blend_darken(s, d); }
        case 2u:  { return blend_multiply(s, d); }
        case 3u:  { return blend_color_burn(s, d); }
        case 4u:  { return blend_linear_burn(s, d); }
        case 5u:  { return blend_lighten(s, d); }
        case 6u:  { return blend_screen(s, d); }
        case 7u:  { return blend_color_dodge(s, d); }
        case 8u:  { return blend_linear_dodge(s, d); }
        case 9u:  { return blend_overlay(s, d); }
        case 10u: { return blend_soft_light(s, d); }
        case 11u: { return blend_hard_light(s, d); }
        case 12u: { return blend_vivid_light(s, d); }
        case 13u: { return blend_linear_light(s, d); }
        case 14u: { return blend_pin_light(s, d); }
        case 15u: { return blend_hard_mix(s, d); }
        case 16u: { return blend_difference(s, d); }
        case 17u: { return blend_exclusion(s, d); }
        case 18u: { return blend_subtract(s, d); }
        case 19u: { return blend_divide(s, d); }
        default:  { return blend_normal(s, d); }
    }
}

// Gradient Map: compute luminance from dst, sample gradient, blend result
@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let dst = textureSample(dstTexture, gradientSampler, in.uv);

    // Photoshop luminance weights (Rec. 601)
    let lum = dot(dst.rgb, vec3f(0.299, 0.587, 0.114));

    // Sample gradient at luminance position (256×1 texture, sample center of texel row)
    let mapped = textureSample(gradientTexture, gradientSampler, vec2f(lum, 0.5));

    let opacity = bitcast<f32>(layerUniforms.x);
    let mode = layerUniforms.y;

    // Apply gradient alpha × layer opacity
    let src_a = mapped.a * opacity;

    let blended = apply_blend(mapped.rgb, dst.rgb, mode);

    let result_rgb = src_a * blended + (1.0 - src_a) * dst.rgb;
    let result_a = src_a + dst.a * (1.0 - src_a);

    return vec4f(result_rgb, result_a);
}
