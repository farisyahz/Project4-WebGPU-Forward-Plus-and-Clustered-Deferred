# Implementation log

## Milestone 1 — deterministic naive renderer

- Completed camera uniform allocation, upload, binding, and vertex projection.
- Fixed-seed light colors, pausable animation clock, reset scene control.
- Canvas resizing updates projection and depth attachments; stopped renderers release their depth texture.
- Cross-platform production asset copy and explicit TypeScript checking in the build.
- Chrome hardware WebGPU validation at 960 × 540: visible Sponza, no console/validation errors.
- Two paused/reset reloads: pixel-identical canvas captures (UI overlays excluded).
- Resize to 801 × 451: matching canvas/depth sizing and no errors.
- `npm run build`: passed. Existing loaders.gl browser-external warning and starter shader `eval` warning remain; shader preprocessing will be replaced during clustering work.

## Upcoming milestones

1. Shared logarithmic clustering, Forward+, overflow fallback, debug views.
2. Baseline clustered deferred and image comparisons.
3. GPU/CPU benchmarks with repeatable presets and raw export.
4. Independently selectable compute lighting, packed G-buffer, bundles, bloom, and depth prepass.
5. Measured analysis, original media/README, deployment and submission preparation.

The reference student repository is used for presentation inspiration only. Implementation and measured results are produced independently.

## Milestone 2 — clustered Forward+

- Shared camera layout (304 bytes), logarithmic depth slicing, conservative sphere/AABB clustering.
- 128 stored indices per cluster; true counts are retained. Overflow falls back to all-light shading instead of truncation.
- Occupancy, slices, overflow, albedo, normal and position debug views.
- Shader constant substitution no longer uses `eval`.
- `npm run build`: passed (only existing loaders.gl browser-external warning).
- Chrome 960 × 540 frozen-frame comparison against naive at 1, 500, and 5,000 lights: every channel identical for all three cases. No console/WebGPU errors, including resize to 803 × 453.

## Milestone 3 — baseline clustered deferred

- Geometry writes world position (`rgba32float`), normal (`rgba16float`), albedo (`rgba8unorm`); fullscreen triangle shades visible pixels using the same light-list function as Forward+.
- 28 bytes/pixel of color attachments plus 4 bytes/pixel depth (logical storage, excluding implementation-specific allocation overhead).
- Chrome 960 × 540 comparisons at 1/500/5,000 lights passed with no errors. Deferred mean RGB error versus naive: 0 / 0.03994 / 0.19854 on a 0–255 scale. At 5,000 lights, 991 of 518,400 pixels have a channel error >3; maximum channel error 42 near bright lights. Quantization is retained as an explicit measured tradeoff.
- `npm run build`: passed.
