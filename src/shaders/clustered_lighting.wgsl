@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read> clusterSet: ClusterSet;

fn shadeCluster(pixel: vec2f, world: vec3f, normal: vec3f, albedo: vec3f) -> vec3f {
    let index = clusterIndex(pixel, world, camera);
    let count = clusterSet.clusters[index].count;
    if (camera.debug.x != 0u) {
        return debugColor(camera.debug.x, count, world, normal, albedo, camera);
    }
    var lighting = vec3f(0.0);
    let overflow = count > ${maxLightsPerCluster}u;
    let iterations = select(count, lightSet.numLights, overflow);
    for (var i = 0u; i < iterations; i++) {
        var light = i;
        if (!overflow) { light = clusterSet.clusters[index].indices[i]; }
        lighting += calculateLightContrib(lightSet.lights[light], world, normal);
    }
    return albedo * lighting;
}
