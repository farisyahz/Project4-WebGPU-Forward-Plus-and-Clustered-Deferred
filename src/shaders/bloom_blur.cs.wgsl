override horizontal: bool = true;
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (any(id.xy >= textureDimensions(outputTex))) {
        return;
    }

    let axis = select(vec2i(0, 1), vec2i(1, 0), horizontal);
    let limit = vec2i(textureDimensions(source)) - 1;
    var color = vec3f(0.0);
    var weights = 0.0;
    // A horizontal pass followed by a vertical pass gives a separable Gaussian.
    // Radius is five texels and sigma is two, so 2 * sigma squared is eight.
    for (var offset = -5; offset <= 5; offset++) {
        let weight = exp(-f32(offset * offset) / 8.0);
        color += textureLoad(source, clamp(vec2i(id.xy) + axis * offset, vec2i(0), limit), 0).rgb * weight;
        weights += weight;
    }
    textureStore(outputTex, id.xy, vec4f(color / weights, 1.0));
}

