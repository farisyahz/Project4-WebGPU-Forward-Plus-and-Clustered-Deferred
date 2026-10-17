// CHECKITOUT: code that you add here will be prepended to all shaders

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

struct Cluster {
    offset: u32,
    count: u32,
}
struct ClusterSet {
    clusters: array<Cluster>
}

struct LightIndexPool {
    allocated: u32,
    unused: u32,
    padding: vec2u,
    indices: array<u32>,
}

struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    inverseProjMat: mat4x4f,
    inverseViewProjMat: mat4x4f,
    viewport: vec4f, // width, height, near, far
    grid: vec4u,
    debug: vec4u,
}

struct Surface {
    world: vec3f,
    normal: vec3f,
    albedo: vec3f,
    valid: bool
}

// Fold the unit normal onto an octahedron so two components can store it.
fn octEncode(normal: vec3f) -> vec2f {
    let n = normal / (abs(normal.x) + abs(normal.y) + abs(normal.z));
    if (n.z < 0.0) {
        return (1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
    }
    return n.xy;
}

fn octDecode(encoded: vec2f) -> vec3f {
    var n = vec3f(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
    if (n.z < 0.0) {
        n = vec3f(
            (1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0)),
            n.z
        );
    }
    return normalize(n);
}

fn depthSlice(depth: f32, data: CameraUniforms) -> u32 {
    let normalized = log(max(depth, data.viewport.z) / data.viewport.z)
        / log(data.viewport.w / data.viewport.z);
    return u32(clamp(floor(normalized * f32(data.grid.z)), 0.0, f32(data.grid.z - 1u)));
}

fn clusterIndex(pixel: vec2f, world: vec3f, data: CameraUniforms) -> u32 {
    let xy = min(vec2u(pixel / data.viewport.xy * vec2f(data.grid.xy)), data.grid.xy - 1u);
    let z = depthSlice(-(data.viewMat * vec4f(world, 1.0)).z, data);
    return xy.x + xy.y * data.grid.x + z * data.grid.x * data.grid.y;
}

fn reconstructPosition(pixel: vec2f, depth: f32, data: CameraUniforms) -> vec3f {
    // Canvas Y points down; WebGPU clip depth is already in the range 0 to 1.
    let ndc = vec4f(pixel / data.viewport.xy * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), depth, 1.0);
    let world = data.inverseViewProjMat * ndc;
    return world.xyz / world.w;
}

fn debugColor(
    mode: u32,
    count: u32,
    overflow: bool,
    world: vec3f,
    normal: vec3f,
    albedo: vec3f,
    data: CameraUniforms
) -> vec3f {
    switch mode {
        case 1u: {
            if (overflow) {
                return vec3f(1.0, 0.0, 1.0);
            }
            let t = min(f32(count) / 512.0, 1.0);
            return vec3f(t, t * t, 1.0 - t) * select(1.0, 0.0, count == 0u);
        }
        case 2u: {
            let z = f32(depthSlice(-(data.viewMat * vec4f(world, 1.0)).z, data));
            return 0.5 + 0.5 * cos(z * 1.7 + vec3f(0.0, 2.1, 4.2));
        }
        case 3u: {
            return albedo;
        }
        case 4u: {
            return normal * 0.5 + 0.5;
        }
        case 5u: {
            return abs(world) / 12.0;
        }
        case 6u: {
            return select(vec3f(0.03), vec3f(1.0, 0.0, 1.0), overflow);
        }
        default: {
            return vec3f(0.0);
        }
    }
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / max(distance * distance, 1e-6);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, vecToLight / max(distToLight, 1e-6)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}
