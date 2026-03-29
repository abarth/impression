// Wet media layer compositing with environment-mapped impasto lighting.
//
// RealShader-inspired rendering: multi-light IBL, anisotropic BRDF,
// self-shadowing (HBAO), and subsurface scattering approximation.
//
// Group 0: wet media layer data
//   binding 0: color texture (rgba32float) — paint color + opacity
//   binding 1: properties texture (rgba32float) — R=height, G=wetness, B=paint_amount
//   binding 2: uniforms
//   binding 3: shadow/AO texture (r32float) from HBAO pass
//   binding 4: velocity texture (rg32float) for stroke direction/anisotropy
//
// Group 1: destination (accumulated result from previous layers)
//   binding 0: dst texture

struct WetMediaCompositeParams {
    opacity_bits: u32,    // bitcast to f32
    medium_type: u32,     // 0=Oil, 1=Acrylic, 2=Watercolor
    // Environment lighting parameters
    env_rotation: f32,    // environment map rotation in radians
    env_intensity: f32,   // environment brightness multiplier
    // Impasto depth multiplier per-layer
    impasto_depth: f32,   // 0=flat, 1=normal, 2=exaggerated
    // Shadow parameters
    shadow_strength: f32, // 0=no shadows, 1=full shadows
    // Specular override
    specular_intensity: f32,
    _pad: u32,
};

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var propsTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: WetMediaCompositeParams;
@group(0) @binding(3) var shadowTexture: texture_2d<f32>;
@group(0) @binding(4) var velocityTexture: texture_2d<f32>;

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

// Compute surface normal from height field using Sobel filter for smoother results.
fn compute_normal(coord: vec2i, dims: vec2i) -> vec3f {
    var height_scale: f32;
    if (params.medium_type == 0u) {
        height_scale = 6.0 * params.impasto_depth;  // Oil: deep impasto
    } else if (params.medium_type == 1u) {
        height_scale = 4.0 * params.impasto_depth;  // Acrylic: moderate
    } else {
        height_scale = 2.0 * params.impasto_depth;  // Watercolor: subtle
    }

    // Sobel filter for smoother normals (3x3 neighborhood)
    let h_tl = textureLoad(propsTexture, clamp(coord + vec2i(-1, -1), vec2i(0), dims - 1), 0).r;
    let h_tc = textureLoad(propsTexture, clamp(coord + vec2i( 0, -1), vec2i(0), dims - 1), 0).r;
    let h_tr = textureLoad(propsTexture, clamp(coord + vec2i( 1, -1), vec2i(0), dims - 1), 0).r;
    let h_ml = textureLoad(propsTexture, clamp(coord + vec2i(-1,  0), vec2i(0), dims - 1), 0).r;
    let h_mr = textureLoad(propsTexture, clamp(coord + vec2i( 1,  0), vec2i(0), dims - 1), 0).r;
    let h_bl = textureLoad(propsTexture, clamp(coord + vec2i(-1,  1), vec2i(0), dims - 1), 0).r;
    let h_bc = textureLoad(propsTexture, clamp(coord + vec2i( 0,  1), vec2i(0), dims - 1), 0).r;
    let h_br = textureLoad(propsTexture, clamp(coord + vec2i( 1,  1), vec2i(0), dims - 1), 0).r;

    // Sobel X: [-1 0 +1; -2 0 +2; -1 0 +1]
    let dx = (-h_tl - 2.0 * h_ml - h_bl + h_tr + 2.0 * h_mr + h_br) * height_scale;
    // Sobel Y: [-1 -2 -1; 0 0 0; +1 +2 +1]
    let dy = (-h_tl - 2.0 * h_tc - h_tr + h_bl + 2.0 * h_bc + h_br) * height_scale;

    return normalize(vec3f(-dx, -dy, 1.0));
}

// Procedural environment map: simulates studio lighting setup.
// Returns diffuse irradiance for a given normal direction.
fn sample_environment_diffuse(normal: vec3f) -> vec3f {
    let rot = params.env_rotation;
    let cos_rot = cos(rot);
    let sin_rot = sin(rot);

    // Rotate normal around Z axis for environment rotation
    let rn = vec3f(
        normal.x * cos_rot - normal.y * sin_rot,
        normal.x * sin_rot + normal.y * cos_rot,
        normal.z,
    );

    // Studio soft lighting: warm key light from upper-left, cool fill from right,
    // rim light from behind, soft ambient bounce from below
    let key_dir = normalize(vec3f(-0.5, -0.3, 0.8));
    let fill_dir = normalize(vec3f(0.6, 0.2, 0.5));
    let rim_dir = normalize(vec3f(0.0, 0.5, -0.3));

    // Energy-conserving light intensities: total should be ~1.0 for a face-up surface
    let key_color = vec3f(1.0, 0.95, 0.88) * 0.55;  // warm key (dominant)
    let fill_color = vec3f(0.7, 0.78, 0.9) * 0.25;   // cool fill
    let rim_color = vec3f(0.9, 0.85, 0.75) * 0.10;    // subtle rim
    let ambient_color = vec3f(0.15, 0.14, 0.13);       // gentle ambient

    // Diffuse: hemisphere-weighted irradiance
    let key_diff = max(dot(rn, key_dir), 0.0);
    let fill_diff = max(dot(rn, fill_dir), 0.0);
    let rim_diff = max(dot(rn, rim_dir), 0.0);
    let sky_factor = rn.z * 0.5 + 0.5; // upward-facing bias
    let diffuse = key_color * key_diff + fill_color * fill_diff + rim_color * rim_diff + ambient_color * sky_factor;

    return diffuse * params.env_intensity;
}

// Returns specular radiance for a given reflection direction.
fn sample_environment_specular(reflect_dir: vec3f, roughness: f32) -> vec3f {
    let rot = params.env_rotation;
    let cos_rot = cos(rot);
    let sin_rot = sin(rot);

    let rr = vec3f(
        reflect_dir.x * cos_rot - reflect_dir.y * sin_rot,
        reflect_dir.x * sin_rot + reflect_dir.y * cos_rot,
        reflect_dir.z,
    );

    let key_dir = normalize(vec3f(-0.5, -0.3, 0.8));
    let fill_dir = normalize(vec3f(0.6, 0.2, 0.5));

    let key_color = vec3f(1.0, 0.95, 0.88) * 0.55;
    let fill_color = vec3f(0.7, 0.78, 0.9) * 0.25;

    // Specular: reflection-weighted radiance with roughness-based lobe width
    let spec_power = mix(256.0, 4.0, roughness * roughness);
    let key_spec = pow(max(dot(rr, key_dir), 0.0), spec_power);
    let fill_spec = pow(max(dot(rr, fill_dir), 0.0), spec_power) * 0.3;
    let specular = key_color * key_spec + fill_color * fill_spec;

    return specular * params.env_intensity;
}

// GGX normal distribution function for physically-based specular.
fn ggx_distribution(n_dot_h: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let denom = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
    return a2 / (3.14159 * denom * denom + 0.0001);
}

// Anisotropic GGX distribution: different roughness along tangent vs bitangent.
fn anisotropic_ggx(n_dot_h: f32, h_dot_t: f32, h_dot_b: f32, roughness_along: f32, roughness_across: f32) -> f32 {
    let at = roughness_along * roughness_along;
    let ab = roughness_across * roughness_across;
    let term_t = (h_dot_t * h_dot_t) / (at + 0.0001);
    let term_b = (h_dot_b * h_dot_b) / (ab + 0.0001);
    let term_n = n_dot_h * n_dot_h;
    let denom = term_t + term_b + term_n;
    return 1.0 / (3.14159 * at * ab * denom * denom + 0.0001);
}

// Subsurface scattering approximation for thin paint layers.
fn approximate_sss(coord: vec2i, dims: vec2i, center_height: f32) -> f32 {
    var higher_count: f32 = 0.0;
    let radius = 3;
    var samples: f32 = 0.0;

    for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
            if (dx == 0 && dy == 0) { continue; }
            let nc = clamp(coord + vec2i(dx, dy), vec2i(0), dims - 1);
            let nh = textureLoad(propsTexture, nc, 0).r;
            if (nh > center_height + 0.05) {
                higher_count += 1.0;
            }
            samples += 1.0;
        }
    }

    // If surrounded by higher paint, light scatters inward (warm glow at thin edges)
    return higher_count / max(samples, 1.0);
}

@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let dims = vec2i(textureDimensions(colorTexture));
    let coord = vec2i(in.uv * vec2f(dims));
    let clamped = clamp(coord, vec2i(0), dims - 1);

    let src = textureLoad(colorTexture, clamped, 0);
    let props = textureLoad(propsTexture, clamped, 0);

    let dst_dims = vec2i(textureDimensions(dstTexture));
    let dst_coord = clamp(vec2i(in.uv * vec2f(dst_dims)), vec2i(0), dst_dims - 1);
    let dst = textureLoad(dstTexture, dst_coord, 0);

    let opacity = bitcast<f32>(params.opacity_bits);
    let height = props.r;
    let wetness = props.g;
    let paint_amount = props.b;

    // Early out for empty pixels
    if (src.a < 0.001) {
        return dst;
    }

    // Read self-shadow from HBAO pass
    let shadow_dims = vec2i(textureDimensions(shadowTexture));
    let shadow_coord = clamp(vec2i(in.uv * vec2f(shadow_dims)), vec2i(0), shadow_dims - 1);
    let shadow_factor = textureLoad(shadowTexture, shadow_coord, 0).r;

    // Read velocity for anisotropic BRDF (stroke direction)
    let vel_dims = vec2i(textureDimensions(velocityTexture));
    let vel_coord = clamp(vec2i(in.uv * vec2f(vel_dims)), vec2i(0), vel_dims - 1);
    let velocity = textureLoad(velocityTexture, vel_coord, 0).rg;
    let vel_len = length(velocity);

    // Surface normal from height field (Sobel filter)
    let normal = compute_normal(clamped, dims);

    // View direction (looking straight down at canvas)
    let view_dir = vec3f(0.0, 0.0, 1.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);

    // Roughness based on wetness and medium
    var base_roughness: f32;
    var dry_roughness: f32;
    if (params.medium_type == 0u) {
        // Oil: glossy when wet, moderate gloss when dry
        base_roughness = 0.05;
        dry_roughness = 0.35;
    } else if (params.medium_type == 1u) {
        // Acrylic: semi-glossy when wet, matte when dry
        base_roughness = 0.1;
        dry_roughness = 0.65;
    } else {
        // Watercolor: matte throughout
        base_roughness = 0.7;
        dry_roughness = 0.9;
    }
    let roughness = mix(base_roughness, dry_roughness, 1.0 - wetness);

    // Anisotropic roughness from stroke direction
    var roughness_along = roughness;
    var roughness_across = roughness;
    var tangent = vec3f(1.0, 0.0, 0.0);
    var bitangent = vec3f(0.0, 1.0, 0.0);

    if (vel_len > 0.1) {
        let stroke_dir = velocity / vel_len;
        tangent = normalize(vec3f(stroke_dir.x, stroke_dir.y, 0.0));
        bitangent = normalize(cross(normal, tangent));

        // Anisotropy ratio: more specular across stroke than along it
        let aniso_ratio = select(0.6, 0.3, params.medium_type == 0u);
        roughness_along = roughness * (1.0 + aniso_ratio);
        roughness_across = roughness * (1.0 - aniso_ratio * 0.5);
    }

    // Fresnel (Schlick)
    var f0 = 0.04; // dielectric
    if (params.medium_type == 0u && wetness > 0.5) {
        f0 = 0.06; // wet oil is slightly more reflective
    }
    let fresnel = f0 + (1.0 - f0) * pow(1.0 - n_dot_v, 5.0);

    // Reflection direction for environment sampling
    let reflect_dir = reflect(-view_dir, normal);

    // Environment-mapped lighting (split diffuse/specular for energy conservation)
    let env_diffuse = sample_environment_diffuse(normal);
    let env_specular = sample_environment_specular(reflect_dir, roughness);

    // Key light direction for primary specular highlight
    let rot = params.env_rotation;
    let key_dir = normalize(vec3f(
        -0.5 * cos(rot) - (-0.3) * sin(rot),
        -0.5 * sin(rot) + (-0.3) * cos(rot),
        0.8,
    ));

    let half_dir = normalize(key_dir + view_dir);
    let n_dot_h = max(dot(normal, half_dir), 0.0);
    let h_dot_t = dot(half_dir, tangent);
    let h_dot_b = dot(half_dir, bitangent);

    // Anisotropic specular
    var spec: f32;
    if (vel_len > 0.1 && params.medium_type != 2u) {
        spec = anisotropic_ggx(n_dot_h, h_dot_t, h_dot_b, roughness_along, roughness_across);
    } else {
        spec = ggx_distribution(n_dot_h, roughness);
    }

    // Specular intensity with medium-specific adjustments
    var spec_strength = fresnel * spec * params.specular_intensity;

    if (params.medium_type == 0u) {
        // Oil: maintains gloss even when dry
        spec_strength = max(spec_strength, 0.08 * fresnel * params.specular_intensity);
    } else if (params.medium_type == 2u) {
        // Watercolor: minimal specular
        spec_strength *= 0.1;
    }

    // Subsurface scattering for thin paint
    var sss_contribution = vec3f(0.0);
    if (height < 0.3 && paint_amount > 0.1 && params.medium_type != 2u) {
        let sss_factor = approximate_sss(clamped, dims, height);
        // Warm glow at thin edges surrounded by thick paint
        let sss_color = src.rgb * vec3f(1.1, 1.0, 0.9);
        sss_contribution = sss_color * sss_factor * 0.15 * (1.0 - roughness);
    }

    // Apply self-shadowing
    let shadow = mix(1.0, shadow_factor, params.shadow_strength);

    // Combine lighting: energy-conserving diffuse + additive specular
    // Diffuse is modulated by (1 - fresnel) to conserve energy
    let diffuse_lit = src.rgb * env_diffuse * (1.0 - fresnel) * shadow;
    let specular_lit = env_specular * spec_strength * shadow;
    let lit_color = diffuse_lit + specular_lit + sss_contribution;
    let lit_color_clamped = clamp(lit_color, vec3f(0.0), vec3f(1.0));

    let src_a = src.a * opacity;

    // Composite over destination (normal blend)
    let result_rgb = src_a * lit_color_clamped + (1.0 - src_a) * dst.rgb;
    let result_a = src_a + dst.a * (1.0 - src_a);

    return vec4f(result_rgb, result_a);
}
