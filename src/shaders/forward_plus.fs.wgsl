@group(2) @binding(0) var diffuseTex: texture_2d<f32>;
@group(2) @binding(1) var diffuseSampler: sampler;

struct FragmentInput {
    @builtin(position) pixel: vec4f,
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f {
    let albedo = textureSample(diffuseTex, diffuseSampler, in.uv);
    if (albedo.a < 0.5) {
        discard;
    }

    // The shared helper locates the cluster, sums its lights, and applies albedo.
    return vec4f(shadeCluster(in.pixel.xy, in.pos, normalize(in.nor), albedo.rgb), 1.0);
}
