# Benchmark methodology

Use the Measurements controls in the application. **Benchmark current** captures the selected renderer/light count. **Full light sweep** compares all three renderers at 100, 500, 1,000, 2,000 and 5,000 lights, with three repetitions. Export preserves every sampled frame as JSON.

## Controlled conditions

- Select a fixed render resolution and camera preset before each experiment.
- Light colors always use integer PRNG seed 5650. Benchmarks pause animation at 0 ms and disable camera input and debug views, then restore scene controls afterward.
- Defaults: 30 completed warmup frames, 120 sampled frames per case, three repetitions. Mode order rotates across repetitions.
- Three asynchronous timestamp/readback slots bound GPU frames in flight. Readback runs outside the CPU encoding interval; the benchmark does not serialize every frame with an explicit queue wait.
- Keep the browser foreground for interactive measurements. Headless runs must be labeled as headless and should not be mixed with interactive browser results.
- Keep the laptop plugged in and use a consistent power mode. Close unrelated GPU workloads. Record OS, browser, driver/GPU and CPU/RAM in the final report.

## Reported quantities

- GPU milliseconds: sum of timestamp intervals for clustering and renderer passes, including the final HDR composite and enabled bloom passes. This excludes the separate light-animation compute submission, browser compositor/presentation, timestamp resolution, and readback copies. Pass-level breakdowns are exported.
- CPU milliseconds: command encoding and submission in the renderer draw call. Excludes camera/light updates, browser UI and asynchronous readback.
- GPU timing is unavailable when the adapter lacks `timestamp-query`; CPU encoding is not presented as GPU timing.
- Summary includes mean, median, p95, min/max and standard deviation. Each repetition remains separate in raw data.
- Cluster statistics are read once after sampling; their readback cost is excluded from renderer timings. Counts cover the full frustum grid, not only clusters containing visible geometry.
- Exhausting the shared light-index pool causes affected clusters to use an all-lights fallback. Compare overflow counts when interpreting timing differences; omitted lights must never be treated as a speedup. The pool budget is an average storage allowance, not a per-cluster light limit.
- G-buffer memory is calculated from format bytes per pixel, not measured VRAM allocation. Report color and depth storage separately.

## Experiment matrix

1. All renderers versus number of lights.
2. Forward+ versus deferred at multiple render resolutions.
3. Atrium, balcony and side-aisle camera presets.
4. Coarse/default/fine cluster grids with occupancy and overflow statistics.
5. Every optimization off/on with all other settings fixed. Render bundles primarily target CPU encoding; GPU timing alone cannot establish their benefit.
6. Frozen-frame image comparisons for baseline and optimized pipelines. Report quantization differences rather than assuming identical images.

Use milliseconds on chart axes. Keep raw samples next to generated charts. Explain observed relationships, uncertainty and tradeoffs; distinguish hypotheses about overdraw/bandwidth from directly measured evidence.
