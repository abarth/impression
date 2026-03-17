@group(0) @binding(0) var layerTexture: texture_2d<f32>;
@group(0) @binding(1) var layerSampler: sampler;
@group(0) @binding(2) var<uniform> layerOpacity: f32;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    // Fullscreen triangle trick: 3 vertices cover the screen
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VertexOutput;
    out.position = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2f(uv.x, 1.0 - uv.y); // flip Y for texture coords
    return out;
}

@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let color = textureSample(layerTexture, layerSampler, in.uv);
    // Premultiplied alpha output for Porter-Duff compositing
    let a = color.a * layerOpacity;
    return vec4f(color.rgb * a, a);
}
