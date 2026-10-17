# Project 4: Faris Rafie Syahzani

Repo: https://github.com/farisyahz/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred

Deployment target: https://farisyahz.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred/

## Completed features

- Naive forward, Forward+, and clustered deferred renderers.
- Shared logarithmic clustering with variable-length light lists, occupancy/slice/overflow views, and a correctness-preserving pool-exhaustion fallback.
- GPU timestamp and CPU encoding benchmarks, fixed scene controls, raw samples and plotted performance analysis.
- Optional compute deferred lighting and a single `rg32uint` packed G-buffer (eight color bytes per pixel, position reconstructed from depth).
- Optional render bundles and alpha-tested Forward+ depth prepass with depth-tie handling.
- Optional compute bloom with half-resolution extraction and separable Gaussian blur.
- Original screenshots, feature-tour media, method descriptions, measured quality tradeoffs and reproducibility documentation.

## Validation

Production build and TypeScript checks; Chrome hardware WebGPU image comparisons, overflow, resize, renderer switching, compute/raster equivalence, timestamp fallback and benchmark cancellation. Actual benchmark adapter is AMD Radeon 780M; the machine's RTX 4050 was not selected by Chrome.

## Before submitting

Enable GitHub Actions/Pages on the fork, deploy `main`, and verify the public URL. Use the title above for the course submission PR and follow any course-specific target-repository instructions.

## Project feedback

The shared-clustering structure made it straightforward to compare shading strategies. Explicitly handling overflow and separating CPU/GPU timing were valuable parts of understanding the performance results.
