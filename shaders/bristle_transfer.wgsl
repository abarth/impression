// Bristle paint transfer compute shader.
//
// Per-bristle deposition to mini-grid atlas and bi-directional pickup.
// Each bristle writes to its own region in the deposition atlas texture.
// A subsequent reduction pass (bristle_reduce.wgsl) composites the atlas
// into the canvas color/props textures using Mixbox pigment mixing.
//
// Dispatched after bristle_collide.wgsl each sub-step.

struct TransferParams {
    // Number of bristles.
    bristle_count: u32,
    // Mini-grid size per bristle (e.g., 8 = 8×8 texel grid).
    grid_size: u32,
    // Canvas width in pixels.
    canvas_width: u32,
    // Canvas height in pixels.
    canvas_height: u32,
    // Atlas width in texels (grid_size * bristles_per_row).
    atlas_width: u32,
    // Bristles per row in the atlas.
    atlas_cols: u32,
    // Paint deposition rate (0-1).
    deposition_rate: f32,
    // Paint pickup rate (0-1) for bi-directional transfer.
    pickup_rate: f32,
    // Minimum paint load on bristle before pickup occurs (0-1).
    pickup_threshold: f32,
    // Paint thickness multiplier.
    paint_thickness: f32,
    // Wetness for freshly deposited paint (0-1).
    wetness: f32,
    // Brush velocity X (canvas pixels/ms).
    velocity_x: f32,
    // Brush velocity Y (canvas pixels/ms).
    velocity_y: f32,
    // Viscosity (0-1): high viscosity resists mixing and builds height.
    viscosity: f32,
    // Canvas texture interaction strength (0-1).
    canvas_texture_strength: f32,
    _pad: f32,
};

const BRISTLE_STRIDE: u32 = 20u;

@group(0) @binding(0) var<storage, read_write> bristles: array<f32>;
@group(0) @binding(1) var canvas_color_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(2) var canvas_props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(3) var deposit_atlas_color: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var deposit_atlas_props: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var<uniform> params: TransferParams;
@group(0) @binding(6) var paper_texture: texture_storage_2d<r32float, read>;

fn read_vec3(base: u32, offset: u32) -> vec3f {
    let i = base + offset;
    return vec3f(bristles[i], bristles[i + 1u], bristles[i + 2u]);
}

fn read_f32(base: u32, offset: u32) -> f32 {
    return bristles[base + offset];
}

fn write_f32(base: u32, offset: u32, v: f32) {
    bristles[base + offset] = v;
}

fn write_vec3(base: u32, offset: u32, v: vec3f) {
    let i = base + offset;
    bristles[i] = v.x;
    bristles[i + 1u] = v.y;
    bristles[i + 2u] = v.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= params.bristle_count) {
        return;
    }

    let base = idx * BRISTLE_STRIDE;

    // Read bristle state
    let tip = read_vec3(base, 4u);
    let stiffness = read_f32(base, 7u);
    let paint_color = read_vec3(base, 8u);
    var paint_load = read_f32(base, 11u);
    let thickness = read_f32(base, 15u);
    let contact = read_f32(base, 16u); // set by bristle_collide

    // Compute atlas position for this bristle's mini-grid
    let grid = params.grid_size;
    let col = idx % params.atlas_cols;
    let row = idx / params.atlas_cols;
    let atlas_x = col * grid;
    let atlas_y = row * grid;

    let half_grid = f32(grid) / 2.0;

    // If not in contact, clear the mini-grid and skip
    if (contact < 0.5) {
        for (var gy = 0u; gy < grid; gy++) {
            for (var gx = 0u; gx < grid; gx++) {
                let px = vec2i(i32(atlas_x + gx), i32(atlas_y + gy));
                textureStore(deposit_atlas_color, px, vec4f(0.0));
                textureStore(deposit_atlas_props, px, vec4f(0.0));
            }
        }
        return;
    }

    // Canvas coordinates of the bristle tip
    let tip_x = tip.x;
    let tip_y = tip.y;

    // Bristle radius in canvas pixels — thin, crisp marks.
    // Thickness is 0.1–1.0; map to a 0.4–1.5 pixel radius so individual
    // bristle strands remain distinct rather than blurring into each other.
    let bristle_radius = 0.4 + thickness * 1.1;

    // Amount to deposit this sub-step
    let deposit_amount = min(paint_load, params.deposition_rate * paint_load);

    // Track how much paint was actually deposited
    var total_deposited = 0.0;

    // For each texel in this bristle's mini-grid
    for (var gy = 0u; gy < grid; gy++) {
        for (var gx = 0u; gx < grid; gx++) {
            let atlas_coord = vec2i(i32(atlas_x + gx), i32(atlas_y + gy));

            // Offset from the bristle tip center
            let dx = f32(gx) - half_grid + 0.5;
            let dy = f32(gy) - half_grid + 0.5;
            let dist = sqrt(dx * dx + dy * dy);

            // Hard-edge bristle profile with ~0.6px anti-aliased border.
            // Beyond the radius, the texel contributes nothing.
            let aa_width = 0.6;
            if (dist > bristle_radius + aa_width) {
                textureStore(deposit_atlas_color, atlas_coord, vec4f(0.0));
                textureStore(deposit_atlas_props, atlas_coord, vec4f(0.0));
                continue;
            }

            // Smooth step from 1 at the core to 0 at the outer edge
            let pressure = 1.0 - smoothstep(bristle_radius - aa_width, bristle_radius + aa_width, dist);

            // Canvas coordinate for this texel
            let cx = i32(round(tip_x - half_grid + f32(gx) + 0.5));
            let cy = i32(round(tip_y - half_grid + f32(gy) + 0.5));

            // Bounds check
            if (cx < 0 || cy < 0 || u32(cx) >= params.canvas_width || u32(cy) >= params.canvas_height) {
                textureStore(deposit_atlas_color, atlas_coord, vec4f(0.0));
                textureStore(deposit_atlas_props, atlas_coord, vec4f(0.0));
                continue;
            }

            let canvas_coord = vec2i(cx, cy);

            // Paper texture modulation
            let paper_h = textureLoad(paper_texture, canvas_coord).r;
            let texture_mod = 1.0 - params.canvas_texture_strength * (1.0 - paper_h);

            // Deposit amount at this texel
            let texel_deposit = deposit_amount * pressure * texture_mod;

            // Write deposition data:
            // Color atlas: (R, G, B, deposit_strength)
            textureStore(deposit_atlas_color, atlas_coord,
                vec4f(paint_color, texel_deposit));

            // Props atlas: (height, wetness, canvas_x as f32, canvas_y as f32)
            // We store canvas coords in the atlas so the reduction pass knows where to write
            let height = params.paint_thickness * texel_deposit * (0.5 + params.viscosity * 0.5);
            textureStore(deposit_atlas_props, atlas_coord,
                vec4f(height, params.wetness * texel_deposit, f32(cx), f32(cy)));

            total_deposited += texel_deposit;
        }
    }

    // Reduce bristle paint load
    paint_load = max(0.0, paint_load - total_deposited);

    // --- Bi-directional pickup ---
    if (paint_load < params.pickup_threshold) {
        let canvas_coord = vec2i(i32(round(tip_x)), i32(round(tip_y)));
        if (canvas_coord.x >= 0 && canvas_coord.y >= 0 &&
            u32(canvas_coord.x) < params.canvas_width &&
            u32(canvas_coord.y) < params.canvas_height) {

            let existing_props = textureLoad(canvas_props_src, canvas_coord);
            let canvas_wetness = existing_props.g;
            let canvas_amount = existing_props.b;

            if (canvas_wetness > 0.01 && canvas_amount > 0.01) {
                let pickup = (1.0 - paint_load) * canvas_wetness * params.pickup_rate;
                let existing_color = textureLoad(canvas_color_src, canvas_coord).rgb;

                // Weighted average of bristle color and canvas color
                let total_load = paint_load + pickup;
                if (total_load > 0.001) {
                    let new_color = (paint_color * paint_load + existing_color * pickup) / total_load;
                    write_vec3(base, 8u, new_color);
                }
                paint_load = min(1.0, paint_load + pickup);
            }
        }
    }

    // Write back updated paint load
    write_f32(base, 11u, paint_load);
}
