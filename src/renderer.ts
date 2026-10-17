import { Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { FrameTiming, GpuProfiler } from './profiler';
import { settings } from './settings';

export var canvas: HTMLCanvasElement;
export var canvasFormat: GPUTextureFormat;
export var context: GPUCanvasContext;
export var device: GPUDevice;
export var profiler: GpuProfiler;
export var adapterInfo: GPUAdapterInfo;
export var canvasTextureView: GPUTextureView;

export var aspectRatio: number;
export const fovYDegrees = 45;

export var modelBindGroupLayout: GPUBindGroupLayout;
export var materialBindGroupLayout: GPUBindGroupLayout;

// CHECKITOUT: this function initializes WebGPU and also creates some bind group layouts shared by all the renderers
export async function initWebGPU() {
    canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;

    const devicePixelRatio = window.devicePixelRatio;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;

    aspectRatio = canvas.width / canvas.height;

    if (!navigator.gpu)
    {
        let errorMessageElement = document.createElement("h1");
        errorMessageElement.textContent = "This browser doesn't support WebGPU! Try using Google Chrome.";
        errorMessageElement.style.paddingLeft = '0.4em';
        document.body.innerHTML = '';
        document.body.appendChild(errorMessageElement);
        throw new Error("WebGPU not supported on this browser");
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter)
    {
        throw new Error("no appropriate GPUAdapter found");
    }

    adapterInfo = adapter.info;
    device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
    profiler = new GpuProfiler(device);
    device.addEventListener('uncapturederror', event => console.error('WebGPU:', event.error.message));
    device.lost.then(info => console.error('WebGPU device lost:', info.message));

    context = canvas.getContext("webgpu")!;
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    console.log("WebGPU init successsful");

    modelBindGroupLayout = device.createBindGroupLayout({
        label: "model bind group layout",
        entries: [
            { // modelMat
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform" }
            }
        ]
    });

    materialBindGroupLayout = device.createBindGroupLayout({
        label: "material bind group layout",
        entries: [
            { // diffuseTex
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {}
            },
            { // diffuseTexSampler
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {}
            }
        ]
    });
}

function updateCanvasSize() {
    const width = Math.max(1, Math.min(device.limits.maxTextureDimension2D, settings.renderWidth || Math.round(canvas.clientWidth * window.devicePixelRatio)));
    const height = Math.max(1, Math.min(device.limits.maxTextureDimension2D, settings.renderHeight || Math.round(canvas.clientHeight * window.devicePixelRatio)));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        aspectRatio = width / height;
    }
}

export const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
        { // pos
            format: "float32x3",
            offset: 0,
            shaderLocation: 0
        },
        { // nor
            format: "float32x3",
            offset: 12,
            shaderLocation: 1
        },
        { // uv
            format: "float32x2",
            offset: 24,
            shaderLocation: 2
        }
    ]
};

export abstract class Renderer {
    protected scene: Scene;
    protected lights: Lights;
    protected camera: Camera;

    protected stats: Stats;

    private prevTime: number = 0;
    private frameRequestId: number;
    private measurement: ((timing: FrameTiming) => void) | undefined;

    constructor(stage: Stage) {
        this.scene = stage.scene;
        this.lights = stage.lights;
        this.camera = stage.camera;
        this.stats = stage.stats;

        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }

    stop(): void {
        cancelAnimationFrame(this.frameRequestId);
    }

    protected abstract draw(): void;

    protected submit(encoder: GPUCommandEncoder) {
        profiler.resolve(encoder);
        device.queue.submit([encoder.finish()]);
    }

    measureFrames(warmup: number, samples: number): Promise<FrameTiming[]> {
        if (this.measurement) throw new Error('A measurement is already running');
        let seen = 0;
        const results: FrameTiming[] = [];
        return new Promise(resolve => {
            this.measurement = timing => {
                if (seen++ < warmup) return;
                results.push(timing);
                if (results.length === samples) { this.measurement = undefined; resolve(results); }
            };
        });
    }

    // CHECKITOUT: this is the main rendering loop
    private onFrame(time: number) {
        // Backpressure prevents an unbounded GPU queue on expensive workloads.
        if (!profiler.beginFrame()) {
            this.frameRequestId = requestAnimationFrame(t => this.onFrame(t));
            return;
        }
        updateCanvasSize();
        if (this.prevTime == 0) {
            this.prevTime = time;
        }

        let deltaTime = time - this.prevTime;
        this.camera.onFrame(deltaTime);
        this.lights.onFrame(time);

        this.stats.begin();
        const listener = this.measurement;
        const start = performance.now();
        this.draw();
        const cpuMs = performance.now() - start;
        void profiler.collect(cpuMs).then(timing => {
            if (timing && listener && listener === this.measurement) listener(timing);
        }).catch(error => console.error('GPU timing readback:', error));

        this.stats.end();

        this.prevTime = time;
        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }
}
