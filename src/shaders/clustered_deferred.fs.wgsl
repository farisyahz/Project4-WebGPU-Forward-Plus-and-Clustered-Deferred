@group(2) @binding(0) var diffuseTex: texture_2d<f32>;
@group(2) @binding(1) var diffuseSampler: sampler;

struct FragmentInput {
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
}
struct GBuffer {
    @location(0) position: vec4f,
    @location(1) normal: vec4f,
    @location(2) albedo: vec4f,
}
@fragment
fn main(in: FragmentInput) -> GBuffer {
    let albedo = textureSample(diffuseTex, diffuseSampler, in.uv);
    if (albedo.a < 0.5) { discard; }
    var out: GBuffer;
    out.position = vec4f(in.pos, 1.0);
    out.normal = vec4f(normalize(in.nor), 0.0);
    out.albedo = vec4f(albedo.rgb, 1.0);
    return out;
}
