@group(2) @binding(0) var diffuseTex: texture_2d<f32>;
@group(2) @binding(1) var diffuseSampler: sampler;

@fragment
fn main(@location(2) uv: vec2f) {
    // The same alpha test is essential: masked leaves/fabric must not occlude
    // geometry through their transparent texels in the lighting pass.
    if (textureSample(diffuseTex, diffuseSampler, uv).a < 0.5) {
        discard;
    }
}
