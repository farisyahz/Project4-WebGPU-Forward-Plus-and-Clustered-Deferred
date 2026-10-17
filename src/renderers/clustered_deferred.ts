import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    private readonly sceneGroup: GPUBindGroup;
    private readonly geometryPipeline: GPURenderPipeline;
    private readonly lightingPipeline: GPURenderPipeline;
    private readonly gBufferLayout: GPUBindGroupLayout;
    private gBufferGroup!: GPUBindGroup;
    private textures: GPUTexture[] = [];
    private depth!: GPUTexture;
    private readonly formats: GPUTextureFormat[] = ['rgba32float', 'rgba16float', 'rgba8unorm'];

    constructor(stage: Stage) {
        super(stage);
        this.lights.configureClustering();
        const sceneLayout = renderer.device.createBindGroupLayout({ label: 'deferred scene layout', entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        ] });
        this.sceneGroup = renderer.device.createBindGroup({ label: 'deferred scene', layout: sceneLayout, entries: [
            { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
            { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
            { binding: 2, resource: { buffer: this.lights.clusterBuffer } },
        ] });
        this.geometryPipeline = renderer.device.createRenderPipeline({
            label: 'G-buffer geometry',
            layout: renderer.device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, renderer.modelBindGroupLayout, renderer.materialBindGroupLayout] }),
            vertex: { module: renderer.device.createShaderModule({ code: shaders.naiveVertSrc }), buffers: [renderer.vertexBufferLayout] },
            fragment: { module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFragSrc }), targets: this.formats.map(format => ({ format })) },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
        });
        this.gBufferLayout = renderer.device.createBindGroupLayout({ label: 'G-buffer textures', entries: this.formats.map((_format, binding) => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' as GPUTextureSampleType } })) });
        this.lightingPipeline = renderer.device.createRenderPipeline({
            label: 'deferred fullscreen lighting',
            layout: renderer.device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, this.gBufferLayout] }),
            vertex: { module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFullscreenVertSrc }) },
            fragment: { module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFullscreenFragSrc }), targets: [{ format: renderer.canvasFormat }] },
        });
        this.resize();
    }

    private resize() {
        if (this.depth?.width === renderer.canvas.width && this.depth?.height === renderer.canvas.height) return;
        this.textures.forEach(texture => texture.destroy());
        this.depth?.destroy();
        const size = [renderer.canvas.width, renderer.canvas.height];
        this.textures = this.formats.map((format, index) => renderer.device.createTexture({ label: ['position', 'normal', 'albedo'][index], size, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
        this.depth = renderer.device.createTexture({ label: 'deferred depth', size, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.gBufferGroup = renderer.device.createBindGroup({ layout: this.gBufferLayout, entries: this.textures.map((texture, binding) => ({ binding, resource: texture.createView() })) });
    }

    override draw() {
        this.resize();
        const encoder = renderer.device.createCommandEncoder({ label: 'deferred frame' });
        this.lights.doLightClustering(encoder);
        const geometry = encoder.beginRenderPass({
            label: 'G-buffer geometry',
            colorAttachments: this.textures.map(texture => ({ view: texture.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' })),
            depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        geometry.setPipeline(this.geometryPipeline);
        geometry.setBindGroup(0, this.sceneGroup);
        this.scene.iterate(node => geometry.setBindGroup(1, node.modelBindGroup), material => geometry.setBindGroup(2, material.materialBindGroup), primitive => {
            geometry.setVertexBuffer(0, primitive.vertexBuffer);
            geometry.setIndexBuffer(primitive.indexBuffer, 'uint32');
            geometry.drawIndexed(primitive.numIndices);
        });
        geometry.end();
        const lighting = encoder.beginRenderPass({ label: 'deferred lighting', colorAttachments: [{ view: renderer.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        lighting.setPipeline(this.lightingPipeline);
        lighting.setBindGroup(0, this.sceneGroup);
        lighting.setBindGroup(1, this.gBufferGroup);
        lighting.draw(3);
        lighting.end();
        renderer.device.queue.submit([encoder.finish()]);
    }

    override stop() {
        super.stop();
        this.textures.forEach(texture => texture.destroy());
        this.depth.destroy();
    }
}
