@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: vec4f;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (any(id.xy >= textureDimensions(outputTex))) { return; }
    let limit = vec2i(textureDimensions(source)) - 1;
    var color = vec3f(0.0);
    for (var y = 0; y < 2; y++) { for (var x = 0; x < 2; x++) {
        color += textureLoad(source, min(vec2i(id.xy * 2u) + vec2i(x, y), limit), 0).rgb;
    } }
    textureStore(outputTex, id.xy, vec4f(max(color * 0.25 - vec3f(params.z), vec3f(0.0)), 1.0));
}

