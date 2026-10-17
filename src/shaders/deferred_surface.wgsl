@group(1) @binding(0) var positionTex: texture_2d<f32>;
@group(1) @binding(1) var normalTex: texture_2d<f32>;
@group(1) @binding(2) var albedoTex: texture_2d<f32>;

fn loadSurface(coord: vec2i, pixel: vec2f) -> Surface {
    let world = textureLoad(positionTex, coord, 0);
    if (world.w == 0.0) { return Surface(vec3f(0.0), vec3f(0.0), vec3f(0.0), false); }
    return Surface(world.xyz, normalize(textureLoad(normalTex, coord, 0).xyz), textureLoad(albedoTex, coord, 0).rgb, true);
}
