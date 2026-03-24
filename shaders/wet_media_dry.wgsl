// Drying simulation compute shader for wet media paint.
//
// Reduces wetness per frame. Below a threshold, paint becomes immovable.
// Uses separate read/write textures since rgba32float does not support read_write access.

struct DryParams {
    canvas_width: u32,
    canvas_height: u32,
    drying_rate: f32,   // wetness reduction per frame (e.g., 0.002)
    _pad: f32,
};

@group(0) @binding(0) var props_src: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var props_dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> params: DryParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;

    if (x >= params.canvas_width || y >= params.canvas_height) {
        return;
    }

    let coord = vec2i(i32(x), i32(y));
    var p = textureLoad(props_src, coord);

    // Reduce wetness
    let wetness = p.g;
    if (wetness > 0.0) {
        p.g = max(0.0, wetness - params.drying_rate);
    }

    textureStore(props_dst, coord, p);
}
