@fragment
fn main(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let surface = loadSurface(vec2i(pixel.xy), pixel.xy);
    if (!surface.valid) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    return vec4f(shadeCluster(pixel.xy, surface.world, surface.normal, surface.albedo), 1.0);
}
