// Paint deposition compute shader for wet media brush.
//
// Reads a bristle footprint mask and deposits paint onto the wet media canvas,
// mixing with existing wet paint using the provided parameters.
// Uses separate read/write textures since rgba32float does not support read_write.
// Before dispatch, the caller copies the current canvas state to the src textures
// so this shader can read from src and write the mixed result to dst.

struct DepositParams {
    // Footprint origin in canvas coordinates.
    origin_x: f32,
    origin_y: f32,
    // Paint color (RGB, 0-1).
    paint_r: f32,
    paint_g: f32,
    paint_b: f32,
    // Remaining paint load (0-1).
    paint_load: f32,
    // Brush velocity for velocity field.
    velocity_x: f32,
    velocity_y: f32,
    // Mixing and appearance parameters.
    mixing_strength: f32,
    paint_thickness: f32,
    wetness: f32,
    // Footprint mask dimensions.
    mask_width: u32,
    mask_height: u32,
    // Canvas dimensions.
    canvas_width: u32,
    canvas_height: u32,
    // Canvas texture interaction strength.
    canvas_texture_strength: f32,
    // Paint viscosity (0-1). High viscosity resists mixing and builds height.
    viscosity: f32,
    // Opacity multiplier from transfer dynamics (0-1, default 1.0).
    opacity_multiplier: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<storage, read> footprint_mask: array<f32>;
@group(0) @binding(1) var canvas_color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(2) var canvas_color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var canvas_props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(4) var canvas_props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var<uniform> params: DepositParams;
@group(0) @binding(6) var paper_texture: texture_storage_2d<r32float, read>;
@group(0) @binding(7) var mixbox_lut: texture_2d<f32>;
@group(0) @binding(8) var mixbox_lut_sampler: sampler;
@group(0) @binding(9) var velocity_src: texture_storage_2d<rg32float, read>;
@group(0) @binding(10) var velocity_dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(11) var<storage, read> color_mask: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let mask_x = gid.x;
    let mask_y = gid.y;

    if (mask_x >= params.mask_width || mask_y >= params.mask_height) {
        return;
    }

    // Read footprint pressure at this pixel
    let mask_idx = mask_y * params.mask_width + mask_x;
    let footprint_pressure = footprint_mask[mask_idx];

    // Compute canvas coordinates
    let half_w = f32(params.mask_width) * 0.5;
    let half_h = f32(params.mask_height) * 0.5;
    let canvas_x = i32(round(params.origin_x - half_w + f32(mask_x)));
    let canvas_y = i32(round(params.origin_y - half_h + f32(mask_y)));

    // Bounds check
    if (canvas_x < 0 || canvas_y < 0 ||
        u32(canvas_x) >= params.canvas_width || u32(canvas_y) >= params.canvas_height) {
        return;
    }

    let coord = vec2i(canvas_x, canvas_y);

    // Read existing canvas state from src textures
    let existing_color = textureLoad(canvas_color_src, coord);
    let existing_props = textureLoad(canvas_props_src, coord);

    // If no footprint pressure, pass through unchanged
    if (footprint_pressure <= 0.0) {
        textureStore(canvas_color_dst, coord, existing_color);
        textureStore(canvas_props_dst, coord, existing_props);
        textureStore(velocity_dst, coord, textureLoad(velocity_src, coord));
        return;
    }

    let existing_wetness = existing_props.g;

    // Canvas staining: absorbed paint resists re-mixing
    // Stain channel (props.a) is 0.0 for fresh paint, 1.0 for fully absorbed
    let stain_resistance = existing_props.a;

    // Mixing: new paint blends with existing wet paint
    // Viscosity reduces effective mixing (high viscosity = paint resists blending)
    // Stained areas resist mixing — absorbed paint is locked into the canvas
    // Read per-bristle color from color mask (3 floats per pixel: R, G, B)
    let cm_base = mask_idx * 3u;
    var paint_color = vec3f(params.paint_r, params.paint_g, params.paint_b);
    if (arrayLength(&color_mask) >= (cm_base + 3u)) {
        paint_color = vec3f(color_mask[cm_base], color_mask[cm_base + 1u], color_mask[cm_base + 2u]);
    }
    let effective_mixing = params.mixing_strength * (1.0 - params.viscosity * 0.7) * (1.0 - stain_resistance * 0.8);
    let t = effective_mixing * existing_wetness * footprint_pressure;
    let load = params.paint_load;

    // Modulate deposit by canvas texture (paper grain)
    let paper_h = textureLoad(paper_texture, coord).r;
    let texture_mod = 1.0 - params.canvas_texture_strength * (1.0 - paper_h);

    // Blend color: deposit new paint, mix with existing wet paint
    let deposit_strength = footprint_pressure * load * texture_mod * params.opacity_multiplier;
    // Scale blend factor linearly with deposit strength (no perceptual boost for thin paint)
    let blend_factor = deposit_strength * (1.0 - t * 0.5);
    let mixbox_result = mixbox_lerp(existing_color.rgb, paint_color, blend_factor, mixbox_lut, mixbox_lut_sampler);

    // K-M glazing correction: for thick paint layers, add Kubelka-Munk layering
    // for physically-based pigment depth. Thin layers stay Mixbox-only to avoid lightening.
    let base_rgb = clamp(existing_color.rgb, vec3f(0.01), vec3f(0.99));
    let paint_rgb = clamp(paint_color, vec3f(0.01), vec3f(0.99));
    let base_K = (1.0 - base_rgb) * (1.0 - base_rgb) / (2.0 * base_rgb);
    let base_S = vec3f(1.0);
    let paint_K = (1.0 - paint_rgb) * (1.0 - paint_rgb) / (2.0 * paint_rgb);
    let paint_S = vec3f(1.0);
    let km_thickness = deposit_strength * 2.0;
    let km_result = km_layer_over(base_K, base_S, paint_K, paint_S, km_thickness);
    // Thick deposits favor K-M for physically-based depth; thin deposits stay Mixbox
    let km_weight = deposit_strength * 0.3;
    let new_color = mix(mixbox_result, km_result, km_weight);
    // Alpha scales with deposit strength — depleted paint becomes transparent
    let new_alpha = min(1.0, existing_color.a + deposit_strength);

    // Paint displacement: brush scrapes/pushes existing wet paint
    // Real brushes don't just add paint — they displace what's already there
    let existing_height = existing_props.r;
    let existing_stain = existing_props.a;  // permanent absorbed paint (0-1)

    // Scrape amount: brush pressure removes height from wet paint
    // High pressure + wet paint = more scraping; dry/stained paint resists
    let scrape_factor = footprint_pressure * existing_wetness * (1.0 - existing_stain);
    let scrape_amount = scrape_factor * (1.0 - params.viscosity * 0.8) * 0.4;
    let scraped_height = max(0.0, existing_height - scrape_amount);

    // Add new paint on top (viscosity increases buildup)
    let height_factor = 0.5 + params.viscosity * 0.5;
    let deposit_height = params.paint_thickness * footprint_pressure * load * height_factor;
    let new_height = scraped_height + deposit_height;

    // Wetness: blend existing and new, accounting for displacement
    let new_wetness = max(existing_wetness * (1.0 - scrape_factor * 0.3),
                          params.wetness * footprint_pressure);

    // Paint amount: displaced paint partially removed
    let existing_amount = existing_props.b;
    let displaced_amount = existing_amount * (1.0 - scrape_factor * 0.2);
    let new_amount = min(1.0, displaced_amount + deposit_strength);

    // Preserve stain channel (written by absorption shader)
    let new_stain = existing_stain;

    // Write to dst textures (R=height, G=wetness, B=paint_amount, A=stain)
    textureStore(canvas_color_dst, coord, vec4f(new_color, new_alpha));
    textureStore(canvas_props_dst, coord, vec4f(new_height, new_wetness, new_amount, new_stain));

    // Seed velocity field from brush motion — this drives the fluid simulation
    let existing_vel = textureLoad(velocity_src, coord).rg;
    let brush_vel = vec2f(params.velocity_x, params.velocity_y);
    // Blend brush velocity into existing field, weighted by footprint pressure and wetness
    let vel_strength = footprint_pressure * new_wetness * (1.0 - params.viscosity * 0.5);
    let new_vel = mix(existing_vel, brush_vel, vel_strength);
    textureStore(velocity_dst, coord, vec4f(new_vel, 0.0, 0.0));
}
