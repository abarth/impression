// ==========================================================
//  MIXBOX 2.0 (c) 2022 Secret Weapons. All rights reserved.
//  License: Creative Commons Attribution-NonCommercial 4.0
//  Authors: Sarka Sochorova and Ondrej Jamriska
//  Ported to WGSL for WebGPU.
// ==========================================================

// Latent pigment representation: 3 pigment coefficients + 3 residual RGB
struct MixboxLatent {
  coeffs: vec3f,   // pigment mixing coefficients (c0, c1, c2)
  residual: vec3f, // RGB residual (rgb - polynomial(coeffs))
}

fn mixbox_eval_polynomial(c: vec3f) -> vec3f {
  let c0 = c[0];
  let c1 = c[1];
  let c2 = c[2];
  let c3 = 1.0 - (c0 + c1 + c2);

  let c00 = c0 * c0;
  let c11 = c1 * c1;
  let c22 = c2 * c2;
  let c01 = c0 * c1;
  let c02 = c0 * c2;
  let c12 = c1 * c2;
  let c33 = c3 * c3;

  return (c0*c00) * vec3f(+0.07717053, +0.02826978, +0.24832992) +
         (c1*c11) * vec3f(+0.95912302, +0.80256528, +0.03561839) +
         (c2*c22) * vec3f(+0.74683774, +0.04868586, +0.00000000) +
         (c3*c33) * vec3f(+0.99518138, +0.99978149, +0.99704802) +
         (c00*c1) * vec3f(+0.04819146, +0.83363781, +0.32515377) +
         (c01*c1) * vec3f(-0.68146950, +1.46107803, +1.06980936) +
         (c00*c2) * vec3f(+0.27058419, -0.15324870, +1.98735057) +
         (c02*c2) * vec3f(+0.80478189, +0.67093710, +0.18424500) +
         (c00*c3) * vec3f(-0.35031003, +1.37855826, +3.68865000) +
         (c0*c33) * vec3f(+1.05128046, +1.97815239, +2.82989073) +
         (c11*c2) * vec3f(+3.21607125, +0.81270228, +1.03384539) +
         (c1*c22) * vec3f(+2.78893374, +0.41565549, -0.04487295) +
         (c11*c3) * vec3f(+3.02162577, +2.55374103, +0.32766114) +
         (c1*c33) * vec3f(+2.95124691, +2.81201112, +1.17578442) +
         (c22*c3) * vec3f(+2.82677043, +0.79933038, +1.81715262) +
         (c2*c33) * vec3f(+2.99691099, +1.22593053, +1.80653661) +
         (c01*c2) * vec3f(+1.87394106, +2.05027182, -0.29835996) +
         (c01*c3) * vec3f(+2.56609566, +7.03428198, +0.62575374) +
         (c02*c3) * vec3f(+4.08329484, -1.40408358, +2.14995522) +
         (c12*c3) * vec3f(+6.00078678, +2.55552042, +1.90739502);
}

fn mixbox_rgb_to_latent(rgb_in: vec3f, lut: texture_2d<f32>, lut_sampler: sampler) -> MixboxLatent {
  let rgb = clamp(rgb_in, vec3f(0.0), vec3f(1.0));

  let x = rgb.r * 63.0;
  let y = rgb.g * 63.0;
  let z = rgb.b * 63.0;

  let iz = floor(z);

  let x0 = (iz % 8.0) * 64.0;
  let y0 = floor(iz / 8.0) * 64.0;

  let x1 = ((iz + 1.0) % 8.0) * 64.0;
  let y1 = floor((iz + 1.0) / 8.0) * 64.0;

  let uv0 = vec2f(x0 + x + 0.5, y0 + y + 0.5) / 512.0;
  let uv1 = vec2f(x1 + x + 0.5, y1 + y + 0.5) / 512.0;

  // Check LUT orientation (same as GLSL reference)
  var uv0_adj = uv0;
  var uv1_adj = uv1;
  let test_pixel = textureSampleLevel(lut, lut_sampler, vec2f(0.5 / 512.0, 0.5 / 512.0), 0.0);
  if (test_pixel.b < 0.1) {
    uv0_adj.y = 1.0 - uv0.y;
    uv1_adj.y = 1.0 - uv1.y;
  }

  let lut0 = textureSampleLevel(lut, lut_sampler, uv0_adj, 0.0).rgb;
  let lut1 = textureSampleLevel(lut, lut_sampler, uv1_adj, 0.0).rgb;

  let c = mix(lut0, lut1, z - iz);

  return MixboxLatent(c, rgb - mixbox_eval_polynomial(c));
}

fn mixbox_latent_to_rgb(latent: MixboxLatent) -> vec3f {
  return clamp(mixbox_eval_polynomial(latent.coeffs) + latent.residual, vec3f(0.0), vec3f(1.0));
}

fn mixbox_latent_scale(latent: MixboxLatent, s: f32) -> MixboxLatent {
  return MixboxLatent(latent.coeffs * s, latent.residual * s);
}

fn mixbox_latent_add(a: MixboxLatent, b: MixboxLatent) -> MixboxLatent {
  return MixboxLatent(a.coeffs + b.coeffs, a.residual + b.residual);
}

fn mixbox_lerp(color1: vec3f, color2: vec3f, t: f32, lut: texture_2d<f32>, lut_sampler: sampler) -> vec3f {
  let z1 = mixbox_rgb_to_latent(color1, lut, lut_sampler);
  let z2 = mixbox_rgb_to_latent(color2, lut, lut_sampler);
  let z_mix = mixbox_latent_add(
    mixbox_latent_scale(z1, 1.0 - t),
    mixbox_latent_scale(z2, t),
  );
  return mixbox_latent_to_rgb(z_mix);
}
