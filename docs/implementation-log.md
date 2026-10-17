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

## Milestone 4 — reproducible profiling

- Optional GPU timestamps with a three-slot asynchronous readback ring, bounded frames in flight, CPU encoding timing, pass breakdowns and raw JSON export.
- Fixed camera presets, render-resolution presets, cluster-grid presets, debug controls, and an in-app measurements panel.
- Smoke sweep (`benchmarks/fixed-list-smoke.json`): 10 warmup + 30 sampled frames, one repetition, 960 × 540, headless Chrome 155, AMD RDNA 3 / Radeon 780M. No console or validation errors. These short smoke runs establish a diagnostic baseline, not final publication-quality results.
- Diagnostic finding: at 5,000 lights the default grid has 2,376 overflowing clusters, maximum occupancy 1,283, mean occupancy 167.36. The correct fallback is expensive; compact variable-length lists are the next optimization.
- Hardware inventory also contains an RTX 4050 Laptop GPU. Browser selection must be recorded rather than inferred from installed hardware.

## Optimization — compact variable-length light lists

- Replaced fixed 128-index arrays with `(offset, count)` records and a shared pool. Each cluster counts intersections, reserves one contiguous range atomically, then writes its list in ascending light-index order.
- Default pool budget is 256 indices per cluster on average, not a per-cluster cap. Default grid storage is 4,755,472 bytes including records/header, versus 2,377,728 bytes for the previous capped lists. A pool exhaustion sentinel retains the correct all-lights fallback.
- At 5,000 lights/Atrium, 771,193 of 1,179,648 available indices are used and overflow is zero, including clusters with 1,283 lights.
- Frozen image checks at multiple light counts, default/balcony/side-aisle cameras and multiple grids passed; Forward+ remains pixel-identical to naive. Deferred quantization error remains unchanged. Raw correctness data: `benchmarks/compact-list-validation.json`.
- Short 10/30/1 smoke runs on the same headless AMD adapter: Forward+ 5,000-light mean GPU 262.95 → 36.26 ms; deferred 53.08 → 10.04 ms. Clustering itself costs 1.02 → 1.43 ms for Forward+. Timing comparisons are preliminary, with limited warmup/repetitions and possible thermal differences; preserve both raw datasets rather than presenting these as final headline results.

## Milestone 5 — render bundles and Forward+ prepass

- Static scene commands can be recorded once per geometry pipeline and replayed as render bundles in all renderers.
- Optional alpha-tested depth prepass followed by equal-depth shading. A stencil claim prevents later coplanar fragments from overwriting the first fragment at a depth tie, preserving baseline draw-order behavior. No depth-based cluster culling is claimed.
- Frozen-frame bundle toggles are pixel-identical for all renderers. Prepass off/on and prepass+bundles are pixel-identical after the depth-tie fix.
- Short post-fix Forward+ smoke: 5,000 lights, 30 warmup/20 samples, GPU 32.13 → 22.07 ms including prepass; 500-light CPU encoding 0.260 → 0.125 ms with bundles. These are diagnostic checks; final experiments need repeated sampling.

## Milestone 6 — packed G-buffer, compute lighting, compute bloom

- Deferred raster and 8 × 8 compute lighting share identical surface decoding and clustered lighting. Both remain selectable.
- Packed G-buffer uses one `rg32uint` attachment: RGBA8 albedo + signed 16-bit octahedral normal coordinates. Position is reconstructed using depth and inverse view-projection. Color storage 28 → 8 bytes/pixel; geometry attachments including depth 32 → 12 bytes/pixel (62.5% reduction).
- Shared `rgba16float` HDR scene output and fullscreen composite support all renderers. Optional half-resolution bloom uses compute extraction and two separable Gaussian compute passes. Composite is presentation, not the deferred lighting calculation.
- At 833 × 469 / 2,000 lights, raster and compute outputs were pixel-identical in both G-buffer modes. Packed versus baseline mean RGB error 0.02360 / 255; maximum 12; 28 pixels have a channel difference >3. Debug views bypass bloom exactly.
- Resize to 901 × 507 and renderer switching with combinations of bloom/compute/packing/bundles/prepass completed without console or validation errors.
- Benchmark cancellation restores controls. Timestamp-disabled validation (`?timestamps=off`) correctly reports CPU-only results and still bounds frames in flight. Numeric GUI options are normalized explicitly.
