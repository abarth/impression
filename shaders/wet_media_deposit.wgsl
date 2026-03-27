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
};

@group(0) @binding(0) var<storage, read> footprint_mask: array<f32>;
@group(0) @binding(1) var canvas_color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(2) var canvas_color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var canvas_props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(4) var canvas_props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var<uniform> params: DepositParams;
@group(0) @binding(6) var paper_texture: texture_storage_2d<r32float, read>;

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
        return;
    }

    let existing_wetness = existing_props.g;

    // Mixing: new paint blends with existing wet paint
    let paint_color = vec3f(params.paint_r, params.paint_g, params.paint_b);
    let t = params.mixing_strength * existing_wetness * footprint_pressure;
    let load = params.paint_load;

    // Modulate deposit by canvas texture (paper grain)
    let paper_h = textureLoad(paper_texture, coord).r;
    let texture_mod = 1.0 - params.canvas_texture_strength * (1.0 - paper_h);

    // Blend color: deposit new paint, mix with existing wet paint
    let deposit_strength = footprint_pressure * load * texture_mod;
    let blend_factor = deposit_strength * (1.0 - t * 0.5);
    let new_color = mix(existing_color.rgb, paint_color, blend_factor);
    let new_alpha = min(1.0, existing_color.a + deposit_strength);

    // Accumulate height (impasto)
    let existing_height = existing_props.r;
    let new_height = existing_height + params.paint_thickness * footprint_pressure * load;

    // Update wetness (max of existing and new)
    let new_wetness = max(existing_wetness, params.wetness * footprint_pressure);

    // Paint amount
    let existing_amount = existing_props.b;
    let new_amount = min(1.0, existing_amount + deposit_strength);

    // Write to dst textures
    textureStore(canvas_color_dst, coord, vec4f(new_color, new_alpha));
    textureStore(canvas_props_dst, coord, vec4f(new_height, new_wetness, new_amount, 0.0));
}
