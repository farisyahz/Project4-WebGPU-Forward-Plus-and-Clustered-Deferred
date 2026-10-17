export interface FrameTiming {
    cpuMs: number;
    gpuMs: number | null;
    passes: Record<string, number>;
}

interface Slot {
    queries: GPUQuerySet;
    resolve: GPUBuffer;
    read: GPUBuffer;
    busy: boolean;
    labels: string[];
}

// A small readback ring keeps normal rendering asynchronous. CPU encoding and
// GPU pass execution are deliberately reported as different quantities.
export class GpuProfiler {
    readonly supported: boolean;
    latest: FrameTiming = { cpuMs: 0, gpuMs: null, passes: {} };
    private readonly slots: Slot[] = [];
    private active: Slot | undefined;
    private pendingWithoutTimestamps = 0;

    constructor(device: GPUDevice) {
        this.deviceQueueDone = () => device.queue.onSubmittedWorkDone();
        this.supported = device.features.has('timestamp-query');
        if (!this.supported) {
            return;
        }
        for (let i = 0; i < 3; i++) {
            this.slots.push({
                queries: device.createQuerySet({
                    label: `frame timestamps ${i}`,
                    type: 'timestamp',
                    count: 32,
                }),
                resolve: device.createBuffer({
                    size: 256,
                    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
                }),
                read: device.createBuffer({
                    size: 256,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                }),
                busy: false,
                labels: [],
            });
        }
    }

    beginFrame() {
        if (!this.supported) {
            if (this.pendingWithoutTimestamps >= 3) {
                return false;
            }
            this.pendingWithoutTimestamps++;
            return true;
        }
        this.active = this.slots.find(slot => !slot.busy);
        if (this.active) {
            this.active.busy = true;
            this.active.labels = [];
        }
        return !this.supported || this.active !== undefined;
    }

    timestampWrites(label: string): GPUComputePassTimestampWrites | undefined {
        if (!this.active) {
            return undefined;
        }
        const index = this.active.labels.length * 2;
        if (index >= 32) {
            throw new Error('Too many timestamped passes');
        }
        this.active.labels.push(label);
        return {
            querySet: this.active.queries,
            beginningOfPassWriteIndex: index,
            endOfPassWriteIndex: index + 1,
        };
    }

    resolve(encoder: GPUCommandEncoder) {
        if (!this.active || !this.active.labels.length) {
            return;
        }
        const count = this.active.labels.length * 2;
        encoder.resolveQuerySet(this.active.queries, 0, count, this.active.resolve, 0);
        encoder.copyBufferToBuffer(this.active.resolve, 0, this.active.read, 0, count * 8);
    }

    async collect(cpuMs: number): Promise<FrameTiming | null> {
        const slot = this.active;
        this.active = undefined;
        if (!slot) {
            if (this.supported) {
                // Readback ring is busy; do not pretend this is a GPU sample.
                return null;
            }
            try {
                await this.deviceQueueDone();
            } finally {
                this.pendingWithoutTimestamps--;
            }
            return (this.latest = { cpuMs, gpuMs: null, passes: {} });
        }
        const passes: Record<string, number> = {};
        try {
            if (!slot.labels.length) {
                return null;
            }
            await slot.read.mapAsync(GPUMapMode.READ);
            const times = new BigUint64Array(slot.read.getMappedRange());
            for (let i = 0; i < slot.labels.length; i++) {
                passes[slot.labels[i]] = Number(times[i * 2 + 1] - times[i * 2]) / 1e6;
            }
            slot.read.unmap();
            return (this.latest = {
                cpuMs,
                gpuMs: Object.values(passes).reduce((a, b) => a + b, 0),
                passes,
            });
        } finally {
            slot.busy = false;
        }
    }

    private deviceQueueDone: () => Promise<void> = () => Promise.resolve();
}
