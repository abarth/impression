// Bristle kinematic simulation compute shader.
//
// Per-bristle spring mechanics, pressure-driven deformation, splaying,
// clumping (capillary action), and directional trailing. Reads the
// current stylus state and updates each bristle's tip position and
// velocity using a damped spring model.
//
// Dispatched once per sub-step during a stroke.

struct StylusState {
    // Canvas position of the ferrule center.
    position: vec2f,
    // Pressure (0 = lifted, 1 = full pressure).
    pressure: f32,
    // Altitude: angle from surface in radians (0 = flat, π/2 = perpendicular).
    altitude: f32,
    // Azimuth: compass direction on canvas plane in radians.
    azimuth: f32,
    // Barrel rotation in radians.
    twist: f32,
    // Brush velocity (canvas pixels per ms).
    velocity: vec2f,
};

struct SimParams {
    // Number of bristles.
    bristle_count: u32,
    // Delta time (in ms) for this sub-step.
    dt: f32,
    // Brush radius (canvas pixels).
    brush_radius: f32,
    // Maximum height above canvas when fully lifted (no pressure).
    max_height: f32,
    // Damping coefficient for bristle velocity (0-1, higher = more damping).
    damping: f32,
    // Splay force multiplier (pressure pushes bristles outward).
    splay_strength: f32,
    // Clumping force multiplier (wet paint pulls bristles together).
    clump_strength: f32,
    // Paint load threshold for clumping (bristles with load > this attract).
    clump_threshold: f32,
};

// Bristle data: same layout as bristle_init.wgsl (20 f32 per bristle).
const BRISTLE_STRIDE: u32 = 20u;

@group(0) @binding(0) var<storage, read_write> bristles: array<f32>;
@group(0) @binding(1) var<uniform> stylus: StylusState;
@group(0) @binding(2) var<uniform> sim: SimParams;

// Read a bristle field (vec3 starting at the given offset within the bristle).
fn read_vec3(base: u32, offset: u32) -> vec3f {
    let i = base + offset;
    return vec3f(bristles[i], bristles[i + 1u], bristles[i + 2u]);
}

// Write a vec3 to a bristle field.
fn write_vec3(base: u32, offset: u32, v: vec3f) {
    let i = base + offset;
    bristles[i] = v.x;
    bristles[i + 1u] = v.y;
    bristles[i + 2u] = v.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= sim.bristle_count) {
        return;
    }

    let base = idx * BRISTLE_STRIDE;

    // Read bristle state
    let anchor = read_vec3(base, 0u);         // rest position (brush-local)
    let length = bristles[base + 3u];
    var tip = read_vec3(base, 4u);            // current world position
    let stiffness = bristles[base + 7u];
    let paint_load = bristles[base + 11u];
    var vel = read_vec3(base, 12u);           // tip velocity

    let dt = sim.dt;

    // --- 1. Transform ferrule to world space ---
    // The ferrule is at the stylus position. The brush is tilted by altitude/azimuth.
    // Height above canvas = maxHeight * (1 - pressure). At full pressure, ferrule is at canvas.
    let ferrule_height = sim.max_height * (1.0 - stylus.pressure);

    // Rotation from stylus tilt: the brush tilts in the azimuth direction
    let cos_az = cos(stylus.azimuth + stylus.twist);
    let sin_az = sin(stylus.azimuth + stylus.twist);
    let cos_alt = cos(stylus.altitude);
    let sin_alt = sin(stylus.altitude);

    // Brush-local to world transform:
    // The brush local X-Y plane is the bristle spread plane.
    // When altitude = π/2, the brush is perpendicular and the local Z points down.
    // When tilted, the local Z tilts in the azimuth direction.
    let right = vec3f(cos_az, sin_az, 0.0);
    let forward = vec3f(-sin_az * sin_alt, cos_az * sin_alt, -cos_alt);
    let up = vec3f(sin_az * cos_alt, -cos_az * cos_alt, -sin_alt);

    // Transform anchor from brush-local to world, centered on ferrule
    let world_anchor = stylus.position.x * vec3f(1.0, 0.0, 0.0)
                     + stylus.position.y * vec3f(0.0, 1.0, 0.0)
                     + ferrule_height * vec3f(0.0, 0.0, 1.0)
                     + anchor.x * right
                     + anchor.y * forward
                     + anchor.z * up;

    // Target tip: anchor projected downward by bristle length along the brush axis
    let target_tip = world_anchor - up * length;

    // --- 2. Spring force: pull tip toward target ---
    let displacement = target_tip - tip;
    let spring_force = displacement * stiffness * 8.0;

    // --- 3. Damping: resist velocity ---
    let damp_force = -vel * sim.damping;

    // --- 4. Splaying: pressure pushes bristles outward ---
    var splay_force = vec3f(0.0);
    if (stylus.pressure > 0.01) {
        // Direction from brush center to this bristle (in XY plane)
        let center = vec2f(stylus.position.x, stylus.position.y);
        let tip_xy = vec2f(tip.x, tip.y);
        let to_bristle = tip_xy - center;
        let dist_from_center = length(to_bristle);
        if (dist_from_center > 0.01) {
            let splay_dir = normalize(to_bristle);
            // Splay strength increases with pressure and inversely with stiffness
            let splay_mag = stylus.pressure * sim.splay_strength * (1.0 - stiffness * 0.7) * sim.brush_radius;
            splay_force = vec3f(splay_dir * splay_mag, 0.0);
        }
    }

    // --- 5. Clumping (capillary action): wet bristles attract each other ---
    // This is approximated by pulling toward the centroid of nearby loaded bristles.
    // For performance, we use the brush center as a proxy (true neighbor averaging
    // would require shared memory or multi-pass).
    var clump_force = vec3f(0.0);
    if (paint_load > sim.clump_threshold) {
        let center = vec3f(stylus.position.x, stylus.position.y, tip.z);
        let to_center = center - tip;
        let clump_mag = paint_load * sim.clump_strength * (1.0 - stiffness * 0.5);
        clump_force = to_center * clump_mag;
    }

    // --- 6. Integrate forces ---
    let total_force = spring_force + damp_force + splay_force + clump_force;
    vel += total_force * dt;

    // Clamp velocity to prevent instability
    let max_vel = sim.brush_radius * 2.0;
    let speed = length(vel);
    if (speed > max_vel) {
        vel = vel * (max_vel / speed);
    }

    tip += vel * dt;

    // --- 7. Canvas floor constraint ---
    // Bristle tips cannot pass through the canvas surface (z = 0).
    // This is a simple floor; Phase 4 adds heightmap collision.
    if (tip.z < 0.0) {
        tip.z = 0.0;
        vel.z = max(0.0, vel.z); // prevent downward velocity
    }

    // --- 8. Write back ---
    write_vec3(base, 4u, tip);
    write_vec3(base, 12u, vel);
}
