@group(1) @binding(0) var positionTex: texture_2d<f32>;
@group(1) @binding(1) var normalTex: texture_2d<f32>;
@group(1) @binding(2) var albedoTex: texture_2d<f32>;

@fragment
fn main(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let coord = vec2i(pixel.xy);
    let world = textureLoad(positionTex, coord, 0);
    if (world.w == 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let normal = normalize(textureLoad(normalTex, coord, 0).xyz);
    let albedo = textureLoad(albedoTex, coord, 0).rgb;
    return vec4f(shadeCluster(pixel.xy, world.xyz, normal, albedo), 1.0);
}
