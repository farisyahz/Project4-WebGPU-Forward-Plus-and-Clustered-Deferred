@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> params: vec4f;
@fragment
fn main(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    var color = textureLoad(scene, vec2i(pixel.xy), 0).rgb;
    if (params.x != 0.0) {
        color += params.y * textureSampleLevel(bloom, linearSampler, pixel.xy / vec2f(textureDimensions(scene)), 0.0).rgb;
    }
    return vec4f(color, 1.0);
}
