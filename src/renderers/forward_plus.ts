import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ForwardPlusRenderer extends renderer.Renderer {
    private readonly sceneGroup: GPUBindGroup;
    private readonly pipeline: GPURenderPipeline;
    private depth!: GPUTexture;

    constructor(stage: Stage) {
        super(stage);
        this.lights.configureClustering();
        const layout = renderer.device.createBindGroupLayout({
            label: 'clustered scene layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            ],
        });
        this.sceneGroup = renderer.device.createBindGroup({
            label: 'forward+ scene', layout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterBuffer } },
            ],
        });
        this.pipeline = renderer.device.createRenderPipeline({
            label: 'forward+ pipeline',
            layout: renderer.device.createPipelineLayout({ bindGroupLayouts: [layout, renderer.modelBindGroupLayout, renderer.materialBindGroupLayout] }),
            vertex: { module: renderer.device.createShaderModule({ label: 'scene vertex', code: shaders.naiveVertSrc }), buffers: [renderer.vertexBufferLayout] },
            fragment: { module: renderer.device.createShaderModule({ label: 'forward+ fragment', code: shaders.forwardPlusFragSrc }), targets: [{ format: renderer.canvasFormat }] },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
        });
        this.resize();
    }

    private resize() {
        if (this.depth?.width === renderer.canvas.width && this.depth?.height === renderer.canvas.height) return;
        this.depth?.destroy();
        this.depth = renderer.device.createTexture({ label: 'forward+ depth', size: [renderer.canvas.width, renderer.canvas.height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }

    override draw() {
        this.resize();
        const encoder = renderer.device.createCommandEncoder({ label: 'forward+ frame' });
        this.lights.doLightClustering(encoder);
        const pass = encoder.beginRenderPass({
            timestampWrites: renderer.profiler.timestampWrites('Forward+ shading'),
            label: 'forward+ shading',
            colorAttachments: [{ view: renderer.context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
            depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.sceneGroup);
        this.scene.iterate(node => pass.setBindGroup(1, node.modelBindGroup), material => pass.setBindGroup(2, material.materialBindGroup), primitive => {
            pass.setVertexBuffer(0, primitive.vertexBuffer);
            pass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            pass.drawIndexed(primitive.numIndices);
        });
        pass.end();
        this.submit(encoder);
    }

    override stop() { super.stop(); this.depth.destroy(); }
}
