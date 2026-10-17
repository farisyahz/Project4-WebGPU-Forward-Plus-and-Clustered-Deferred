@group(2) @binding(0) var outputTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    // Rounded-up dispatches can include invocations outside the render target.
    if (any(id.xy >= textureDimensions(outputTex))) {
        return;
    }

    let pixel = vec2f(id.xy) + 0.5;
    let surface = loadSurface(vec2i(id.xy), pixel);
    var color = vec3f(0.0);
    if (surface.valid) {
        color = shadeCluster(pixel, surface.world, surface.normal, surface.albedo);
    }
    textureStore(outputTex, id.xy, vec4f(color, 1.0));
}

