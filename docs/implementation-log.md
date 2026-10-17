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
