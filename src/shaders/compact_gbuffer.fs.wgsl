@group(2) @binding(0) var diffuseTex: texture_2d<f32>;
@group(2) @binding(1) var diffuseSampler: sampler;

@fragment
fn main(@location(1) normal: vec3f, @location(2) uv: vec2f) -> @location(0) vec2u {
    let albedo = textureSample(diffuseTex, diffuseSampler, uv);
    if (albedo.a < 0.5) { discard; }
    return vec2u(pack4x8unorm(vec4f(albedo.rgb, 1.0)), pack2x16snorm(octEncode(normalize(normal))));
}
