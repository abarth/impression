// Bristle heightmap collision compute shader.
//
// Per-bristle raycasting against the canvas paper heightmap. Handles
// collision response (push-up), micro-collision skip (dry-brush effect),
// and friction forces that perturb bristle velocity on rough surfaces.
//
// Dispatched after bristle_sim.wgsl each sub-step.

struct CollisionParams {
    // Number of bristles.
    bristle_count: u32,
    // Canvas width in pixels.
    canvas_width: u32,
    // Canvas height in pixels.
    canvas_height: u32,
    // Paper roughness: higher values produce more friction drag (0-1).
    roughness: f32,
    // Micro-collision threshold: if tip is above heightmap by more than
    // this (in normalized height units), the bristle hovers (no contact).
    hover_threshold: f32,
    // Brush radius in canvas pixels (for coordinate mapping).
    brush_radius: f32,
    // Padding to 16-byte alignment.
    _pad0: f32,
    _pad1: f32,
};

const BRISTLE_STRIDE: u32 = 20u;

@group(0) @binding(0) var<storage, read_write> bristles: array<f32>;
@group(0) @binding(1) var paper_texture: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var<uniform> params: CollisionParams;

fn read_vec3(base: u32, offset: u32) -> vec3f {
    let i = base + offset;
    return vec3f(bristles[i], bristles[i + 1u], bristles[i + 2u]);
}

fn write_vec3(base: u32, offset: u32, v: vec3f) {
    let i = base + offset;
    bristles[i] = v.x;
    bristles[i + 1u] = v.y;
    bristles[i + 2u] = v.z;
}

fn read_f32(base: u32, offset: u32) -> f32 {
    return bristles[base + offset];
}

fn write_f32(base: u32, offset: u32, v: f32) {
    bristles[base + offset] = v;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= params.bristle_count) {
        return;
    }

    let base = idx * BRISTLE_STRIDE;

    var tip = read_vec3(base, 4u);
    var vel = read_vec3(base, 12u);
    let stiffness = read_f32(base, 7u);

    // Convert tip XY to integer texel coords. Tip is in canvas pixel space.
    let tx = clamp(i32(tip.x), 0, i32(params.canvas_width) - 1);
    let ty = clamp(i32(tip.y), 0, i32(params.canvas_height) - 1);
    let coord = vec2i(tx, ty);

    // Sample paper heightmap (0-1 normalized height).
    let paper_h = textureLoad(paper_texture, coord).r;

    // Scale heightmap value to world-space height.
    // Paper height is in [0, 1]; we scale it to a fraction of the brush radius
    // so the texture grain interacts meaningfully with bristle tips.
    let height_scale = params.brush_radius * 0.15;
    let surface_z = paper_h * height_scale;

    // --- Collision test ---
    let depth = surface_z - tip.z;

    if (depth > 0.0) {
        // Bristle is below the surface — push it up.
        tip.z = surface_z;

        // Deflection: the collision bends the bristle outward.
        // Higher collision depth → more lateral deflection.
        // This creates natural spray at high pressure.
        let deflection_strength = depth * (1.0 - stiffness * 0.5);

        // Lateral deflection direction: push away from the center of the
        // brush. We use the velocity direction as a fallback if the
        // bristle is near center.
        let vel_xy = vec2f(vel.x, vel.y);
        let speed = length(vel_xy);
        if (speed > 0.001) {
            // Friction: oppose movement proportional to roughness and depth
            let friction_mag = params.roughness * depth * 0.5;
            let friction_dir = -normalize(vel_xy);
            vel.x += friction_dir.x * friction_mag;
            vel.y += friction_dir.y * friction_mag;
        }

        // Cancel downward velocity
        if (vel.z < 0.0) {
            vel.z = 0.0;
        }
    } else {
        // Bristle tip is above the surface.
        let gap = -depth; // positive distance above surface

        // Micro-collision / hover check: if gap > threshold, bristle
        // doesn't touch the surface (dry-brush effect on light pressure).
        // We encode "in_contact" in a reserved field so bristle_transfer
        // can check whether this bristle should deposit paint.
        // reserved[0] at offset 16 is used as the contact flag (1.0 = contact, 0.0 = hover).
        if (gap > params.hover_threshold * height_scale) {
            // Hovering — no contact
            write_f32(base, 16u, 0.0);
            write_vec3(base, 4u, tip);
            write_vec3(base, 12u, vel);
            return;
        }
        // Close enough to surface — still in contact (light touch)
    }

    // Mark bristle as in-contact
    write_f32(base, 16u, 1.0);

    // --- Write back ---
    write_vec3(base, 4u, tip);
    write_vec3(base, 12u, vel);
}
