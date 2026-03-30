// Bristle array initialization compute shader.
//
// Constructs a 3D brush head as an array of independent bristle vectors
// attached to a central ferrule point. Supports Round, Flat, Filbert, and Fan
// brush shapes. Each bristle is assigned physical properties based on its
// position within the shape.
//
// Dispatched once when a stroke begins or brush shape changes.

struct BristleInitParams {
    // Number of bristles to initialize.
    bristle_count: u32,
    // Brush shape: 0=Round, 1=Flat, 2=Filbert, 3=Fan.
    brush_shape: u32,
    // Base brush radius in canvas pixels.
    brush_radius: f32,
    // Bristle length (relative to radius, typically 1.0-3.0).
    bristle_length: f32,
    // Base stiffness (spring constant, 0-1).
    base_stiffness: f32,
    // Base thickness (affects paint capacity, 0-1).
    base_thickness: f32,
    // Spread factor: how much bristles fan out from the center (0-1).
    spread: f32,
    // Random seed for deterministic initialization.
    seed: u32,
    // Form factor: controls the shape profile (0=pointy, 1=blunt).
    form: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

// Per-bristle data stored in a flat storage buffer.
// Each bristle occupies 20 f32 values (80 bytes, 16-byte aligned).
// Layout:
//   [0-2]   anchor (vec3f): rest position in brush-local space
//   [3]     length (f32): rest length
//   [4-6]   tip (vec3f): current tip position (world space)
//   [7]     stiffness (f32): spring constant (0-1)
//   [8-10]  paint_color (vec3f): RGB of held paint
//   [11]    paint_load (f32): amount of paint (0-1)
//   [12-14] velocity (vec3f): bristle tip velocity
//   [15]    thickness (f32): bristle thickness (affects paint capacity)
//   [16-18] reserved (vec3f)
//   [19]    reserved (f32)
const BRISTLE_STRIDE: u32 = 20u;

@group(0) @binding(0) var<storage, read_write> bristles: array<f32>;
@group(0) @binding(1) var<uniform> params: BristleInitParams;

// Simple hash function for deterministic pseudo-random numbers.
fn pcg_hash(input: u32) -> u32 {
    var state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

// Hash to float in [0, 1).
fn hash_to_float(seed: u32, index: u32) -> f32 {
    return f32(pcg_hash(seed ^ (index * 1664525u + 1013904223u))) / 4294967295.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= params.bristle_count) {
        return;
    }

    let base = idx * BRISTLE_STRIDE;
    let seed = params.seed;

    // Generate random values for this bristle
    let r0 = hash_to_float(seed, idx * 7u);
    let r1 = hash_to_float(seed, idx * 7u + 1u);
    let r2 = hash_to_float(seed, idx * 7u + 2u);
    let r3 = hash_to_float(seed, idx * 7u + 3u);
    let r4 = hash_to_float(seed, idx * 7u + 4u);

    var anchor = vec3f(0.0);
    var length = params.bristle_length;
    var stiffness = params.base_stiffness;
    var thickness = params.base_thickness;

    let radius = params.brush_radius;
    let spread = params.spread;

    if (params.brush_shape == 0u) {
        // Round brush: random distribution within a circle
        let angle = r0 * 6.2831853;
        // Use sqrt for uniform area distribution
        let dist = sqrt(r1) * radius * spread;
        anchor.x = cos(angle) * dist;
        anchor.y = sin(angle) * dist;
        anchor.z = 0.0;

        // Length varies with Gaussian-like falloff from center
        let normalized_dist = dist / (radius * max(spread, 0.01));
        let form_factor = mix(1.0, 1.0 - normalized_dist * normalized_dist, params.form);
        length *= max(0.3, form_factor + r2 * 0.15);

        // Stiffness slightly varies
        stiffness *= (0.85 + r3 * 0.3);
        thickness *= (0.8 + r4 * 0.4);

    } else if (params.brush_shape == 1u) {
        // Flat brush: 2D grid arrangement in a rectangle
        let count_f = f32(params.bristle_count);
        let cols = u32(ceil(sqrt(count_f * 4.0)));  // wider than tall
        let rows = u32(ceil(count_f / f32(cols)));
        let col = idx % cols;
        let row = idx / cols;

        let width = radius * 2.0 * spread;
        let depth = radius * 0.4 * spread;
        anchor.x = (f32(col) / max(1.0, f32(cols - 1u)) - 0.5) * width;
        anchor.y = (f32(row) / max(1.0, f32(rows - 1u)) - 0.5) * depth;
        anchor.z = 0.0;

        // Uniform length with slight jitter
        length *= (0.95 + r2 * 0.1);
        stiffness *= (0.9 + r3 * 0.2);
        thickness *= (0.9 + r4 * 0.2);

    } else if (params.brush_shape == 2u) {
        // Filbert brush: elliptical distribution with dome-shaped length gradient
        let angle = r0 * 6.2831853;
        let dist = sqrt(r1);
        // Elliptical: wider than deep
        anchor.x = cos(angle) * dist * radius * spread;
        anchor.y = sin(angle) * dist * radius * 0.5 * spread;
        anchor.z = 0.0;

        // Dome-shaped length: longer in center, shorter at edges
        let normalized_dist = dist;
        let dome = sqrt(max(0.0, 1.0 - normalized_dist * normalized_dist));
        length *= max(0.4, dome * mix(1.0, 0.7, params.form) + r2 * 0.1);
        stiffness *= (0.85 + r3 * 0.3);
        thickness *= (0.85 + r4 * 0.3);

    } else {
        // Fan brush: bristles spread outward in a wide arc
        let t = f32(idx) / max(1.0, f32(params.bristle_count - 1u));
        let fan_angle = (t - 0.5) * 3.14159 * spread;
        let dist = (0.3 + r1 * 0.7) * radius;
        anchor.x = cos(fan_angle) * dist;
        anchor.y = sin(fan_angle) * dist * 0.3;
        anchor.z = 0.0;

        // Fan bristles are longer at edges
        let edge_factor = abs(t - 0.5) * 2.0;
        length *= (0.7 + edge_factor * 0.5 + r2 * 0.1);
        stiffness *= (0.7 + r3 * 0.3);
        thickness *= (0.7 + r4 * 0.3);
    }

    // Clamp values
    length = max(0.1, length);
    stiffness = clamp(stiffness, 0.05, 1.0);
    thickness = clamp(thickness, 0.1, 1.0);

    // Write bristle data
    // anchor (vec3f)
    bristles[base + 0u] = anchor.x;
    bristles[base + 1u] = anchor.y;
    bristles[base + 2u] = anchor.z;
    // length
    bristles[base + 3u] = length;
    // tip (initially same as anchor projected downward by length)
    bristles[base + 4u] = anchor.x;
    bristles[base + 5u] = anchor.y;
    bristles[base + 6u] = -length;
    // stiffness
    bristles[base + 7u] = stiffness;
    // paint_color (initialized to zero — loaded later)
    bristles[base + 8u] = 0.0;
    bristles[base + 9u] = 0.0;
    bristles[base + 10u] = 0.0;
    // paint_load (starts empty)
    bristles[base + 11u] = 0.0;
    // velocity (zero)
    bristles[base + 12u] = 0.0;
    bristles[base + 13u] = 0.0;
    bristles[base + 14u] = 0.0;
    // thickness
    bristles[base + 15u] = thickness;
    // reserved
    bristles[base + 16u] = 0.0;
    bristles[base + 17u] = 0.0;
    bristles[base + 18u] = 0.0;
    bristles[base + 19u] = 0.0;
}
