@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read_write> clusterSet: ClusterSet;
struct WritablePool {
    allocated: atomic<u32>,
    unused: u32,
    padding: vec2u,
    indices: array<u32>,
}
@group(0) @binding(3) var<storage, read_write> indexPool: WritablePool;

fn pointAtDepth(uv: vec2f, depth: f32) -> vec3f {
    let ray = camera.inverseProjMat * vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 1.0, 1.0);
    return ray.xyz * (-depth / ray.z);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global: vec3u) {
    let index = global.x;
    let grid = camera.grid.xyz;
    if (index >= grid.x * grid.y * grid.z) { return; }
    let cell = vec3u(index % grid.x, (index / grid.x) % grid.y, index / (grid.x * grid.y));
    let uv0 = vec2f(cell.xy) / vec2f(grid.xy);
    let uv1 = vec2f(cell.xy + 1u) / vec2f(grid.xy);
    let near = camera.viewport.z * pow(camera.viewport.w / camera.viewport.z, f32(cell.z) / f32(grid.z));
    let far = camera.viewport.z * pow(camera.viewport.w / camera.viewport.z, f32(cell.z + 1u) / f32(grid.z));
    var lower = vec3f(1e30);
    var upper = vec3f(-1e30);
    for (var corner = 0u; corner < 8u; corner++) {
        let uv = vec2f(select(uv0.x, uv1.x, (corner & 1u) != 0u), select(uv0.y, uv1.y, (corner & 2u) != 0u));
        let point = pointAtDepth(uv, select(near, far, (corner & 4u) != 0u));
        lower = min(lower, point);
        upper = max(upper, point);
    }
    // Conservative expansion protects boundaries against floating-point rounding.
    lower -= vec3f(1e-4);
    upper += vec3f(1e-4);
    var count = 0u;
    for (var light = 0u; light < lightSet.numLights; light++) {
        let center = (camera.viewMat * vec4f(lightSet.lights[light].pos, 1.0)).xyz;
        let delta = center - clamp(center, lower, upper);
        if (dot(delta, delta) <= ${lightRadius} * ${lightRadius}) {
            count++;
        }
    }
    clusterSet.clusters[index].count = count;
    if (count == 0u) { clusterSet.clusters[index].offset = 0u; return; }
    // One allocation per cluster avoids a fixed per-cluster cap and keeps each
    // list contiguous. A second intersection sweep writes indices in light order.
    let offset = atomicAdd(&indexPool.allocated, count);
    if (offset + count > arrayLength(&indexPool.indices)) {
        clusterSet.clusters[index].offset = 0xffffffffu;
        return; // A correct all-lights fallback handles exhausted pool storage.
    }
    clusterSet.clusters[index].offset = offset;
    var output = offset;
    for (var light = 0u; light < lightSet.numLights; light++) {
        let center = (camera.viewMat * vec4f(lightSet.lights[light].pos, 1.0)).xyz;
        let delta = center - clamp(center, lower, upper);
        if (dot(delta, delta) <= ${lightRadius} * ${lightRadius}) {
            indexPool.indices[output] = light;
            output++;
        }
    }
}
