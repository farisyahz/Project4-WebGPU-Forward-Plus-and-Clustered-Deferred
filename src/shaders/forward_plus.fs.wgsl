@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read> clusterSet: ClusterSet;
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
    if (albedo.a < 0.5) { discard; }
    let normal = normalize(in.nor);
    let index = clusterIndex(in.pixel.xy, in.pos, camera);
    let count = clusterSet.clusters[index].count;
    if (camera.debug.x != 0u) {
        return vec4f(debugColor(camera.debug.x, count, in.pos, normal, albedo.rgb, camera), 1.0);
    }
    var lighting = vec3f(0.0);
    let overflow = count > ${maxLightsPerCluster}u;
    let iterations = select(count, lightSet.numLights, overflow);
    for (var i = 0u; i < iterations; i++) {
        var light = i;
        if (!overflow) { light = clusterSet.clusters[index].indices[i]; }
        lighting += calculateLightContrib(lightSet.lights[light], in.pos, normal);
    }
    return vec4f(albedo.rgb * lighting, 1.0);
}
