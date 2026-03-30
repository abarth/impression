// Bristle deposition reduction pass.
//
// Composites all per-bristle mini-grid deposits from the atlas into
// the canvas color/props/velocity textures. Uses Mixbox pigment-space
// blending for physically accurate paint mixing.
//
// Dispatched over canvas dimensions (not atlas dimensions).
// Each thread processes one canvas texel by scanning through all
// bristle mini-grids that overlap it.

struct ReduceParams {
    // Number of bristles.
    bristle_count: u32,
    // Mini-grid size per bristle.
    grid_size: u32,
    // Canvas width in pixels.
    canvas_width: u32,
    // Canvas height in pixels.
    canvas_height: u32,
    // Atlas width in texels.
    atlas_width: u32,
    // Bristles per row in atlas.
    atlas_cols: u32,
    // Mixing strength (0-1): how much deposited paint blends with existing.
    mixing_strength: f32,
    // Viscosity for height buildup.
    viscosity: f32,
    // Velocity X for velocity field seeding.
    velocity_x: f32,
    // Velocity Y for velocity field seeding.
    velocity_y: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var deposit_atlas_color: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var deposit_atlas_props: texture_storage_2d<rgba32float, read>;
@group(0) @binding(2) var canvas_color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(3) var canvas_color_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var canvas_props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(5) var canvas_props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var<uniform> params: ReduceParams;
@group(0) @binding(7) var mixbox_lut: texture_2d<f32>;
@group(0) @binding(8) var mixbox_lut_sampler: sampler;
@group(0) @binding(9) var velocity_src: texture_storage_2d<rg32float, read>;
@group(0) @binding(10) var velocity_dst: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let cx = gid.x;
    let cy = gid.y;
    if (cx >= params.canvas_width || cy >= params.canvas_height) {
        return;
    }

    let coord = vec2i(i32(cx), i32(cy));
    let existing_color = textureLoad(canvas_color_src, coord);
    let existing_props = textureLoad(canvas_props_src, coord);
    let existing_vel = textureLoad(velocity_src, coord).rg;

    // Accumulate deposits from all bristles that overlap this canvas texel.
    // For each bristle, check if this canvas pixel falls within its mini-grid.
    var total_deposit = 0.0;
    var accum_color = vec3f(0.0);
    var accum_height = 0.0;
    var accum_wetness = 0.0;

    let grid = params.grid_size;
    let half_grid = f32(grid) / 2.0;

    // Rather than scanning all bristles for each canvas pixel (O(n*m)),
    // we iterate over the atlas and match by the stored canvas coordinates.
    // This is efficient because the atlas is small relative to the canvas.
    let atlas_rows = (params.bristle_count + params.atlas_cols - 1u) / params.atlas_cols;
    let total_atlas_h = atlas_rows * grid;

    for (var bi = 0u; bi < params.bristle_count; bi++) {
        let col = bi % params.atlas_cols;
        let row = bi / params.atlas_cols;
        let ax_base = col * grid;
        let ay_base = row * grid;

        // Quick AABB check: read the center texel's props to get canvas origin
        let center_props = textureLoad(deposit_atlas_props,
            vec2i(i32(ax_base + grid / 2u), i32(ay_base + grid / 2u)));
        let center_cx = center_props.z;
        let center_cy = center_props.w;

        // Skip if this bristle's center is too far from our canvas pixel
        if (abs(f32(cx) - center_cx) > half_grid + 1.0 ||
            abs(f32(cy) - center_cy) > half_grid + 1.0) {
            continue;
        }

        // Scan the mini-grid for texels matching our canvas coordinate
        for (var gy = 0u; gy < grid; gy++) {
            for (var gx = 0u; gx < grid; gx++) {
                let atlas_coord = vec2i(i32(ax_base + gx), i32(ay_base + gy));
                let atlas_props = textureLoad(deposit_atlas_props, atlas_coord);
                let stored_cx = i32(round(atlas_props.z));
                let stored_cy = i32(round(atlas_props.w));

                if (stored_cx == i32(cx) && stored_cy == i32(cy)) {
                    let atlas_color = textureLoad(deposit_atlas_color, atlas_coord);
                    let deposit = atlas_color.a;
                    if (deposit > 0.0) {
                        accum_color += atlas_color.rgb * deposit;
                        accum_height += atlas_props.r;
                        accum_wetness += atlas_props.g;
                        total_deposit += deposit;
                    }
                }
            }
        }
    }

    // If no bristles deposited here, pass through unchanged
    if (total_deposit <= 0.0) {
        textureStore(canvas_color_dst, coord, existing_color);
        textureStore(canvas_props_dst, coord, existing_props);
        textureStore(velocity_dst, coord, vec4f(existing_vel, 0.0, 0.0));
        return;
    }

    // Average the deposited color by total deposit weight
    let deposit_color = accum_color / total_deposit;

    // Blend with existing canvas using Mixbox
    let existing_wetness = existing_props.g;
    let existing_stain = existing_props.a;
    let effective_mixing = params.mixing_strength * (1.0 - params.viscosity * 0.7) * (1.0 - existing_stain * 0.8);
    let t = effective_mixing * existing_wetness;
    let blend = clamp(total_deposit * (1.0 - t * 0.5), 0.0, 1.0);

    let mixed_color = mixbox_lerp(existing_color.rgb, deposit_color, blend,
                                   mixbox_lut, mixbox_lut_sampler);
    let new_alpha = min(1.0, existing_color.a + total_deposit);

    // Props: accumulate height, wetness
    let existing_height = existing_props.r;
    let existing_amount = existing_props.b;

    let new_height = existing_height + accum_height;
    let new_wetness = max(existing_props.g, accum_wetness);
    let new_amount = min(1.0, existing_amount + total_deposit);

    textureStore(canvas_color_dst, coord, vec4f(mixed_color, new_alpha));
    textureStore(canvas_props_dst, coord, vec4f(new_height, new_wetness, new_amount, existing_stain));

    // Seed velocity field
    let brush_vel = vec2f(params.velocity_x, params.velocity_y);
    let vel_strength = total_deposit * new_wetness * (1.0 - params.viscosity * 0.5);
    let new_vel = mix(existing_vel, brush_vel, vel_strength);
    textureStore(velocity_dst, coord, vec4f(new_vel, 0.0, 0.0));
}
