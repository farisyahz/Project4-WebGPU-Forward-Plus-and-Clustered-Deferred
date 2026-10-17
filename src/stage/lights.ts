import { vec3 } from 'wgpu-matrix';
import { device, profiler } from '../renderer';

import * as shaders from '../shaders/shaders';
import { Camera } from './camera';
import { settings } from '../settings';

// h in [0, 1]
function hueToRgb(h: number) {
    let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
    return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
    private readonly camera: Camera;
    numLights = 500;
    paused = false;
    animationTime = 0;
    private previousTime: number | undefined;
    static readonly maxNumLights = 5000;
    static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

    static readonly lightIntensity = 0.1;

    lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);
    lightSetStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
    moveLightsComputeBindGroup: GPUBindGroup;
    moveLightsComputePipeline: GPUComputePipeline;

    clusterBuffer!: GPUBuffer;
    indexPool!: GPUBuffer;
    private clusteringGroup!: GPUBindGroup;
    private clusteringPipeline!: GPUComputePipeline;

    constructor(camera: Camera) {
        this.camera = camera;

        this.lightSetStorageBuffer = device.createBuffer({
            label: 'lights',
            size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.populateLightsBuffer();
        this.updateLightSetUniformNumLights();

        this.timeUniformBuffer = device.createBuffer({
            label: 'time uniform',
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.moveLightsComputeBindGroupLayout = device.createBindGroupLayout({
            label: 'move lights compute bind group layout',
            entries: [
                {
                    // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' },
                },
                {
                    // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        this.moveLightsComputeBindGroup = device.createBindGroup({
            label: 'move lights compute bind group',
            layout: this.moveLightsComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer },
                },
            ],
        });

        this.moveLightsComputePipeline = device.createComputePipeline({
            label: 'move lights compute pipeline',
            layout: device.createPipelineLayout({
                label: 'move lights compute pipeline layout',
                bindGroupLayouts: [this.moveLightsComputeBindGroupLayout],
            }),
            compute: {
                module: device.createShaderModule({
                    label: 'move lights compute shader',
                    code: shaders.moveLightsComputeSrc,
                }),
                entryPoint: 'main',
            },
        });

        this.configureClustering();
    }

    private populateLightsBuffer() {
        // Fixed integer PRNG: identical colors on every reload without another dependency.
        let seed = 5650;
        for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
            // light pos is set by compute shader so no need to set it here
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const lightColor = vec3.scale(hueToRgb(seed / 4294967296), Lights.lightIntensity);
            this.lightsArray.set(lightColor, lightIdx * Lights.numFloatsPerLight + 4);
        }

        device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
    }

    updateLightSetUniformNumLights() {
        device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
    }

    configureClustering() {
        // Each cluster stores two u32s: its offset and count in the shared pool.
        const size = settings.clusterX * settings.clusterY * settings.clusterZ * 8;
        // The pool starts with a 16-byte allocation header, then u32 light indices.
        const poolSize = 16 + (size / 8) * settings.lightIndexBudget * 4;
        if (this.clusterBuffer?.size === size && this.indexPool?.size === poolSize) {
            return;
        }
        this.clusterBuffer?.destroy();
        this.indexPool?.destroy();
        this.clusterBuffer = device.createBuffer({
            label: 'cluster counts and indices',
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        this.indexPool = device.createBuffer({
            label: 'compact light-index pool',
            size: poolSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const layout = device.createBindGroupLayout({
            label: 'clustering layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.clusteringGroup = device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.clusterBuffer } },
                { binding: 3, resource: { buffer: this.indexPool } },
            ],
        });
        this.clusteringPipeline = device.createComputePipeline({
            label: 'sphere-AABB clustering',
            layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            compute: {
                module: device.createShaderModule({
                    label: 'clustering compute',
                    code: shaders.clusteringComputeSrc,
                }),
                entryPoint: 'main',
            },
        });
    }

    doLightClustering(encoder: GPUCommandEncoder) {
        // Clustering is shared by Forward+ and deferred. Reset only the allocator;
        // the compute pass overwrites every cluster record and its active indices.
        encoder.clearBuffer(this.indexPool, 0, 16);
        const pass = encoder.beginComputePass({
            label: 'light clustering',
            timestampWrites: profiler.timestampWrites('Light clustering'),
        });
        pass.setPipeline(this.clusteringPipeline);
        pass.setBindGroup(0, this.clusteringGroup);
        pass.dispatchWorkgroups(
            Math.ceil((settings.clusterX * settings.clusterY * settings.clusterZ) / 64)
        );
        pass.end();
    }

    async getClusterStatistics() {
        // Read statistics after sampling so this copy is outside measured GPU passes.
        const read = device.createBuffer({
            size: this.clusterBuffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        try {
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.clusterBuffer, 0, read, 0, read.size);
            device.queue.submit([encoder.finish()]);
            await read.mapAsync(GPUMapMode.READ);
            const data = new Uint32Array(read.getMappedRange());
            const histogram: Record<number, number> = {};
            let maximum = 0,
                total = 0,
                occupied = 0,
                overflow = 0;
            const stride = 2;
            for (let i = 0; i < data.length; i += stride) {
                const count = data[i + 1];
                histogram[count] = (histogram[count] || 0) + 1;
                maximum = Math.max(maximum, count);
                total += count;
                occupied += Number(count > 0);
                overflow += Number(data[i] === 0xffffffff);
            }
            const clusters = data.length / stride;
            read.unmap();
            return {
                clusters,
                occupied,
                overflow,
                maximum,
                mean: total / clusters,
                bytes: this.clusterBuffer.size + this.indexPool.size,
                poolCapacity: (this.indexPool.size - 16) / 4,
                requiredIndices: total,
                histogram,
            };
        } finally {
            read.destroy();
        }
    }

    // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
    onFrame(time: number) {
        if (!this.paused && this.previousTime !== undefined) {
            this.animationTime += Math.min(time - this.previousTime, 100);
        }
        this.previousTime = time;
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([this.animationTime]));

        // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.moveLightsComputePipeline);

        computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

        const workgroupCount = Math.ceil(
            this.numLights / shaders.constants.moveLightsWorkgroupSize
        );
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}
