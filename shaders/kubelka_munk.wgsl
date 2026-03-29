// Kubelka-Munk reflectance-based color mixing utilities.
// Concatenate this file before compute shaders that need K-M pigment blending.

struct KMPigment {
    K: vec3f,
    S: vec3f,
};

// Compute infinite-thickness reflectance R∞ from absorption (K) and scattering (S) coefficients.
// Per-channel formula: R = 1 + K/S - sqrt((K/S)^2 + 2*K/S)
fn km_reflectance(K: vec3f, S: vec3f) -> vec3f {
    var result: vec3f;
    for (var i = 0u; i < 3u; i = i + 1u) {
        let k = K[i];
        let s = S[i];
        if (s < 1e-6) {
            // No scattering: fully absorbing / transparent → zero reflectance
            result[i] = 0.0;
            continue;
        }
        let a = k / s;
        let r = 1.0 + a - sqrt(a * a + 2.0 * a);
        result[i] = clamp(r, 0.0, 1.0);
    }
    return result;
}

// Mix two pigments by weighted average of K and S coefficients.
fn km_mix(K1: vec3f, S1: vec3f, K2: vec3f, S2: vec3f, t: f32) -> KMPigment {
    var result: KMPigment;
    result.K = mix(K1, K2, t);
    result.S = mix(S1, S2, t);
    return result;
}

// Layer a thin transparent glaze over an opaque base.
// Uses simplified Saunderson-corrected K-M layering:
//   R = R_glaze + (1 - R_glaze)^2 * R_base * T^2 / (1 - R_glaze * R_base * T^2)
// where T = exp(-S * thickness) is the internal transmittance of the glaze layer.
fn km_layer_over(
    base_K: vec3f,
    base_S: vec3f,
    glaze_K: vec3f,
    glaze_S: vec3f,
    thickness: f32,
) -> vec3f {
    let r_base = km_reflectance(base_K, base_S);

    if (thickness < 1e-6) {
        return r_base;
    }

    let r_glaze = km_reflectance(glaze_K, glaze_S);

    var result: vec3f;
    for (var i = 0u; i < 3u; i = i + 1u) {
        let t2 = exp(-2.0 * glaze_S[i] * thickness);
        let rg = r_glaze[i];
        let rb = r_base[i];
        let denom = 1.0 - rg * rb * t2;
        if (abs(denom) < 1e-8) {
            result[i] = rg;
        } else {
            result[i] = rg + (1.0 - rg) * (1.0 - rg) * rb * t2 / denom;
        }
        result[i] = clamp(result[i], 0.0, 1.0);
    }
    return result;
}
