@group(1) @binding(0) var packedTex: texture_2d<u32>;
@group(1) @binding(1) var depthTex: texture_depth_2d;

fn loadSurface(coord: vec2i, pixel: vec2f) -> Surface {
    let depth = textureLoad(depthTex, coord, 0);
    if (depth >= 1.0) {
        return Surface(vec3f(0.0), vec3f(0.0), vec3f(0.0), false);
    }

    // RG32uint holds RGBA8 albedo and two signed 16-bit normal coordinates.
    // Position comes from depth instead of a separate floating-point texture.
    let packed = textureLoad(packedTex, coord, 0);
    return Surface(
        reconstructPosition(pixel, depth, camera),
        octDecode(unpack2x16snorm(packed.y)),
        unpack4x8unorm(packed.x).rgb,
        true
    );
}
