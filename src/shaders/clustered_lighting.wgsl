@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read> clusterSet: ClusterSet;
@group(0) @binding(3) var<storage, read> indexPool: LightIndexPool;

fn shadeCluster(pixel: vec2f, world: vec3f, normal: vec3f, albedo: vec3f) -> vec3f {
    // Locate the fragment's cluster and its range in the shared light-index pool.
    let index = clusterIndex(pixel, world, camera);
    let count = clusterSet.clusters[index].count;
    let offset = clusterSet.clusters[index].offset;
    let overflow = offset == 0xffffffffu;

    if (camera.debug.x != 0u) {
        return debugColor(camera.debug.x, count, overflow, world, normal, albedo, camera);
    }
    var lighting = vec3f(0.0);
    // Exhausted clusters test every light so pool limits never drop contributions.
    let iterations = select(count, lightSet.numLights, overflow);
    for (var i = 0u; i < iterations; i++) {
        var light = i;
        if (!overflow) {
            light = indexPool.indices[offset + i];
        }
        lighting += calculateLightContrib(lightSet.lights[light], world, normal);
    }

    return albedo * lighting;
}
