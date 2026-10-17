import { FrameTiming } from './profiler';

export function summarize(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const percentile = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
    return {
        mean,
        median: percentile(0.5),
        p95: percentile(0.95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        standardDeviation: Math.sqrt(
            values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length
        ),
    };
}

export function summarizeFrames(frames: FrameTiming[]) {
    const gpu = frames.flatMap(frame => (frame.gpuMs === null ? [] : [frame.gpuMs]));
    const labels = [...new Set(frames.flatMap(frame => Object.keys(frame.passes)))];
    return {
        cpu: summarize(frames.map(frame => frame.cpuMs)),
        gpu: gpu.length ? summarize(gpu) : null,
        passes: Object.fromEntries(
            labels.map(label => [
                label,
                summarize(
                    frames.flatMap(frame =>
                        frame.passes[label] === undefined ? [] : [frame.passes[label]]
                    )
                ),
            ])
        ),
    };
}

export function downloadJson(name: string, value: unknown) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
