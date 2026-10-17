import { canvas, canvasFormat, context, device, profiler } from './renderer';
import { settings } from './settings';
import { clusteredDeferredFullscreenVertSrc } from './shaders/shaders';
import extractSrc from './shaders/bloom_extract.cs.wgsl?raw';
import blurSrc from './shaders/bloom_blur.cs.wgsl?raw';
import compositeSrc from './shaders/composite.fs.wgsl?raw';

export class PostProcess {
    private scene!: GPUTexture;
    private sceneView!: GPUTextureView;
    private bloomA: GPUTexture | undefined;
    private bloomB: GPUTexture | undefined;
    private readonly dummy: GPUTexture;
    private readonly params: GPUBuffer;
    private readonly sampler: GPUSampler;
    private readonly composite: GPURenderPipeline;
    private readonly extract: GPUComputePipeline;
    private readonly horizontal: GPUComputePipeline;
    private readonly vertical: GPUComputePipeline;
    private presentGroup!: GPUBindGroup;
    private extractGroup!: GPUBindGroup;
    private horizontalGroup!: GPUBindGroup;
    private verticalGroup!: GPUBindGroup;

    constructor() {
        this.params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.dummy = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
        this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
        this.composite = device.createRenderPipeline({ label: 'HDR composite', layout: 'auto', vertex: { module: device.createShaderModule({ code: clusteredDeferredFullscreenVertSrc }) }, fragment: { module: device.createShaderModule({ code: compositeSrc }), targets: [{ format: canvasFormat }] } });
        this.extract = device.createComputePipeline({ label: 'bloom extraction', layout: 'auto', compute: { module: device.createShaderModule({ code: extractSrc }) } });
        const blur = device.createShaderModule({ code: blurSrc });
        this.horizontal = device.createComputePipeline({ label: 'bloom horizontal', layout: 'auto', compute: { module: blur, constants: { horizontal: 1 } } });
        this.vertical = device.createComputePipeline({ label: 'bloom vertical', layout: 'auto', compute: { module: blur, constants: { horizontal: 0 } } });
    }

    target() {
        if (this.scene?.width !== canvas.width || this.scene?.height !== canvas.height) {
            this.scene?.destroy();
            this.bloomA?.destroy(); this.bloomB?.destroy();
            this.bloomA = undefined; this.bloomB = undefined;
            this.scene = device.createTexture({ label: 'HDR scene', size: [canvas.width, canvas.height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
            this.sceneView = this.scene.createView();
            this.createPresentGroup();
        }
        return this.sceneView;
    }

    private createPresentGroup() {
        this.presentGroup = device.createBindGroup({ layout: this.composite.getBindGroupLayout(0), entries: [
            { binding: 0, resource: this.sceneView }, { binding: 1, resource: (this.bloomA ?? this.dummy).createView() },
            { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.params } },
        ] });
    }

    render(encoder: GPUCommandEncoder) {
        const bloom = settings.bloom && settings.debugView === 0;
        device.queue.writeBuffer(this.params, 0, new Float32Array([Number(bloom), settings.bloomStrength, settings.bloomThreshold, 0]));
        if (bloom) {
            if (!this.bloomA) {
                const descriptor: GPUTextureDescriptor = { size: [Math.ceil(canvas.width / 2), Math.ceil(canvas.height / 2)], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING };
                this.bloomA = device.createTexture({ ...descriptor, label: 'bloom ping' });
                this.bloomB = device.createTexture({ ...descriptor, label: 'bloom pong' });
                const a = this.bloomA.createView(), b = this.bloomB.createView();
                this.extractGroup = device.createBindGroup({ layout: this.extract.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sceneView }, { binding: 1, resource: a }, { binding: 2, resource: { buffer: this.params } }] });
                this.horizontalGroup = device.createBindGroup({ layout: this.horizontal.getBindGroupLayout(0), entries: [{ binding: 0, resource: a }, { binding: 1, resource: b }] });
                this.verticalGroup = device.createBindGroup({ layout: this.vertical.getBindGroupLayout(0), entries: [{ binding: 0, resource: b }, { binding: 1, resource: a }] });
                this.createPresentGroup();
            }
            const stages: [string, GPUComputePipeline, GPUBindGroup][] = [
                ['Bloom extract', this.extract, this.extractGroup], ['Bloom horizontal', this.horizontal, this.horizontalGroup], ['Bloom vertical', this.vertical, this.verticalGroup],
            ];
            for (const [label, pipeline, group] of stages) {
                const pass = encoder.beginComputePass({ label, timestampWrites: profiler.timestampWrites(label) });
                pass.setPipeline(pipeline); pass.setBindGroup(0, group);
                pass.dispatchWorkgroups(Math.ceil(canvas.width / 16), Math.ceil(canvas.height / 16));
                pass.end();
            }
        }
        const pass = encoder.beginRenderPass({ label: 'scene composite', timestampWrites: profiler.timestampWrites('Composite'), colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        pass.setPipeline(this.composite); pass.setBindGroup(0, this.presentGroup); pass.draw(3); pass.end();
    }

    destroy() { this.scene?.destroy(); this.bloomA?.destroy(); this.bloomB?.destroy(); this.dummy.destroy(); this.params.destroy(); }
}
