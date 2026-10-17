import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { settings } from '../settings';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    private readonly sceneGroup: GPUBindGroup;
    private readonly geometryPipeline: GPURenderPipeline;
    private readonly lightingPipeline: GPURenderPipeline;
    private readonly computePipeline: GPUComputePipeline;
    private readonly outputLayout: GPUBindGroupLayout;
    private outputGroup!: GPUBindGroup;
    private readonly gBufferLayout: GPUBindGroupLayout;
    private gBufferGroup!: GPUBindGroup;
    private textures: GPUTexture[] = [];
    private depth!: GPUTexture;
    private readonly compact = settings.compactGBuffer;
    // Packed mode stores albedo and normal in one texture; depth supplies position.
    private readonly formats: GPUTextureFormat[] = this.compact
        ? ['rg32uint']
        : ['rgba32float', 'rgba16float', 'rgba8unorm'];

    constructor(stage: Stage) {
        super(stage);
        this.lights.configureClustering();

        // Lighting uses the same camera, light data, and cluster lists as Forward+.
        const sceneLayout = renderer.device.createBindGroupLayout({
            label: 'deferred scene layout',
            entries: [
                {
                    binding: 0,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
            ],
        });
        this.sceneGroup = renderer.device.createBindGroup({
            label: 'deferred scene',
            layout: sceneLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterBuffer } },
                { binding: 3, resource: { buffer: this.lights.indexPool } },
            ],
        });

        // The geometry pass writes visible surface attributes without lighting.
        this.geometryPipeline = renderer.device.createRenderPipeline({
            label: 'G-buffer geometry',
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [
                    sceneLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout,
                ],
            }),
            vertex: {
                module: renderer.device.createShaderModule({ code: shaders.naiveVertSrc }),
                buffers: [renderer.vertexBufferLayout],
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    code: this.compact
                        ? shaders.compactGBufferSrc
                        : shaders.clusteredDeferredFragSrc,
                }),
                targets: this.formats.map(format => ({ format })),
            },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
        });

        // Match the decoder's inputs: packed material + depth, or three attributes.
        this.gBufferLayout = renderer.device.createBindGroupLayout({
            label: 'G-buffer textures',
            entries: (this.compact
                ? ['uint', 'depth']
                : ['unfilterable-float', 'unfilterable-float', 'unfilterable-float']
            ).map((sampleType, binding) => ({
                binding,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                texture: { sampleType: sampleType as GPUTextureSampleType },
            })),
        });

        // Keep both lighting paths available for direct visual and timing comparisons.
        this.lightingPipeline = renderer.device.createRenderPipeline({
            label: 'deferred fullscreen lighting',
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [sceneLayout, this.gBufferLayout],
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    code: shaders.clusteredDeferredFullscreenVertSrc,
                }),
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    code: shaders.deferredLightingSrc(this.compact, false),
                }),
                targets: [{ format: renderer.sceneColorFormat }],
            },
        });

        // Compute lighting writes the same HDR texture as the fullscreen pass.
        this.outputLayout = renderer.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: 'write-only', format: renderer.sceneColorFormat },
                },
            ],
        });
        this.computePipeline = renderer.device.createComputePipeline({
            label: 'deferred compute lighting',
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [sceneLayout, this.gBufferLayout, this.outputLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    code: shaders.deferredLightingSrc(this.compact, true),
                }),
            },
        });
        this.resize();
    }

    private resize() {
        if (
            this.depth?.width === renderer.canvas.width &&
            this.depth?.height === renderer.canvas.height
        ) {
            return;
        }
        this.textures.forEach(texture => texture.destroy());
        this.depth?.destroy();

        // Resizing replaces attachments and every bind group that references them.
        const size = [renderer.canvas.width, renderer.canvas.height];
        this.textures = this.formats.map((format, index) =>
            renderer.device.createTexture({
                label: ['position', 'normal', 'albedo'][index],
                size,
                format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            })
        );
        this.depth = renderer.device.createTexture({
            label: 'deferred depth',
            size,
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.gBufferGroup = renderer.device.createBindGroup({
            layout: this.gBufferLayout,
            entries: (this.compact ? [this.textures[0], this.depth] : this.textures).map(
                (texture, binding) => ({ binding, resource: texture.createView() })
            ),
        });
        this.outputGroup = renderer.device.createBindGroup({
            layout: this.outputLayout,
            entries: [{ binding: 0, resource: this.colorTarget() }],
        });
    }

    override draw() {
        this.resize();
        const encoder = renderer.device.createCommandEncoder({ label: 'deferred frame' });

        this.lights.doLightClustering(encoder);

        const geometry = encoder.beginRenderPass({
            timestampWrites: renderer.profiler.timestampWrites('G-buffer geometry'),
            label: 'G-buffer geometry',
            colorAttachments: this.textures.map(texture => ({
                view: texture.createView(),
                clearValue: [0, 0, 0, 0],
                loadOp: 'clear',
                storeOp: 'store',
            })),
            depthStencilAttachment: {
                view: this.depth.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });
        this.renderScene(
            geometry,
            this.geometryPipeline,
            this.sceneGroup,
            this.formats,
            'depth32float'
        );
        geometry.end();

        // Shade the G-buffer once per pixel using the selected lighting path.
        if (settings.computeLighting) {
            const lighting = encoder.beginComputePass({
                label: 'deferred compute lighting',
                timestampWrites: renderer.profiler.timestampWrites('Deferred compute lighting'),
            });
            lighting.setPipeline(this.computePipeline);
            lighting.setBindGroup(0, this.sceneGroup);
            lighting.setBindGroup(1, this.gBufferGroup);
            lighting.setBindGroup(2, this.outputGroup);
            lighting.dispatchWorkgroups(
                Math.ceil(renderer.canvas.width / 8),
                Math.ceil(renderer.canvas.height / 8)
            );
            lighting.end();
        } else {
            const lighting = encoder.beginRenderPass({
                label: 'deferred lighting',
                timestampWrites: renderer.profiler.timestampWrites('Deferred lighting'),
                colorAttachments: [
                    {
                        view: this.colorTarget(),
                        loadOp: 'clear',
                        storeOp: 'store',
                        clearValue: [0, 0, 0, 1],
                    },
                ],
            });
            lighting.setPipeline(this.lightingPipeline);
            lighting.setBindGroup(0, this.sceneGroup);
            lighting.setBindGroup(1, this.gBufferGroup);
            lighting.draw(3);
            lighting.end();
        }

        this.submit(encoder);
    }

    override stop() {
        super.stop();
        this.textures.forEach(texture => texture.destroy());
        this.depth.destroy();
    }
}
