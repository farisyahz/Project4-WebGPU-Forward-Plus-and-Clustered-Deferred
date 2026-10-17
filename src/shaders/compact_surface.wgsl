@group(1) @binding(0) var packedTex: texture_2d<u32>;
@group(1) @binding(1) var depthTex: texture_depth_2d;

fn loadSurface(coord: vec2i, pixel: vec2f) -> Surface {
    let depth = textureLoad(depthTex, coord, 0);
    if (depth >= 1.0) { return Surface(vec3f(0.0), vec3f(0.0), vec3f(0.0), false); }
    let packed = textureLoad(packedTex, coord, 0);
    return Surface(reconstructPosition(pixel, depth, camera), octDecode(unpack2x16snorm(packed.y)), unpack4x8unorm(packed.x).rgb, true);
}
