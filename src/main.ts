import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import { adapterInfo, canvas, initWebGPU, profiler, Renderer } from './renderer';
import { NaiveRenderer } from './renderers/naive';
import { ForwardPlusRenderer } from './renderers/forward_plus';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';
import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { debugViews, settings } from './settings';
import { downloadJson, summarizeFrames } from './benchmark';

await initWebGPU();
setupLoaders();
const scene = new Scene();
await scene.loadGltf('./scenes/sponza/Sponza.gltf');

export const camera = new Camera();
export const lights = new Lights(camera);
const stats = new Stats();
stats.showPanel(0);
stats.dom.id = 'fps-monitor';
stats.dom.removeAttribute('style');
stats.dom.title = 'Live FPS and history. Click to cycle performance graphs.';
stats.dom.setAttribute('role', 'button');
stats.dom.setAttribute('aria-label', 'Live performance graphs. Activate to switch graphs.');
stats.dom.tabIndex = 0;
stats.dom.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        stats.dom.click();
    }
});
document.getElementById('hud')!.appendChild(stats.dom);

const stage = new Stage(scene, lights, camera, stats);
export const renderModes = {
    naive: 'naive',
    forwardPlus: 'forward+',
    clusteredDeferred: 'clustered deferred',
};
const controls = {
    mode: renderModes.forwardPlus,
    camera: 'Atrium',
    resolution: 'Native',
    grid: '16 × 12 × 24',
};
export let renderer: Renderer;
export let benchmarkRunning = false;
export let lastBenchmark: Awaited<ReturnType<typeof runBenchmark>> | undefined;

export function setRenderer(mode: string) {
    if (!Object.values(renderModes).includes(mode)) {
        throw new Error(`Unknown renderer: ${mode}`);
    }
    renderer?.stop();
    controls.mode = mode;

    // Occupancy, slices, and overflow require cluster data, which naive lacks.
    if (mode === renderModes.naive && [1, 2, 6].includes(settings.debugView)) {
        settings.debugView = 0;
    }
    if (mode === renderModes.naive) {
        renderer = new NaiveRenderer(stage);
    } else if (mode === renderModes.forwardPlus) {
        renderer = new ForwardPlusRenderer(stage);
    } else {
        renderer = new ClusteredDeferredRenderer(stage);
    }
}

const gui = new GUI({ width: 290 });
gui.add(controls, 'mode', {
    'Naive forward': renderModes.naive,
    'Forward+': renderModes.forwardPlus,
    'Clustered deferred': renderModes.clusteredDeferred,
})
    .name('Renderer')
    .listen()
    .onChange(setRenderer);
const sceneFolder = gui.addFolder('Scene');
sceneFolder
    .add(lights, 'numLights', 1, Lights.maxNumLights, 1)
    .name('Point lights')
    .listen()
    .onChange(() => lights.updateLightSetUniformNumLights());
sceneFolder.add(lights, 'paused').name('Pause lights').listen();
sceneFolder
    .add(controls, 'camera', ['Atrium', 'Balcony', 'Side aisle'])
    .name('Camera preset')
    .onChange(name => camera.setPreset(name));
sceneFolder
    .add(
        {
            reset: () => {
                camera.setPreset(controls.camera);
                lights.animationTime = 0;
            },
        },
        'reset'
    )
    .name('Reset scene');
sceneFolder
    .add(controls, 'resolution', ['Native', '960 × 540', '1280 × 720', '1920 × 1080'])
    .name('Render resolution')
    .onChange(value => {
        const dimensions = value === 'Native' ? [0, 0] : value.split(' × ').map(Number);
        [settings.renderWidth, settings.renderHeight] = dimensions;
    });
sceneFolder.open();
const debugFolder = gui.addFolder('Clustering and debug');
debugFolder
    .add(settings, 'debugView', debugViews)
    .name('View')
    .listen()
    .onChange(value => {
        settings.debugView = Number(value);
        if (controls.mode === renderModes.naive && [1, 2, 6].includes(Number(value))) {
            setRenderer(renderModes.forwardPlus);
        }
    });
debugFolder
    .add(controls, 'grid', ['8 × 6 × 16', '16 × 12 × 24', '24 × 18 × 32'])
    .name('Cluster grid')
    .onChange(value => {
        [settings.clusterX, settings.clusterY, settings.clusterZ] = value.split(' × ').map(Number);
        lights.configureClustering();
        setRenderer(controls.mode);
    });
const benchmarkFolder = gui.addFolder('Measurements');
const optimizations = gui.addFolder('Effects and optimizations');
optimizations.add(settings, 'bundles').name('Render bundles');
optimizations.add(settings, 'depthPrepass').name('Forward+ depth prepass');
optimizations.add(settings, 'computeLighting').name('Deferred compute lighting');
optimizations
    .add(settings, 'compactGBuffer')
    .name('Packed G-buffer')
    .onChange(() => setRenderer(controls.mode));
optimizations.add(settings, 'bloom').name('Compute bloom');
optimizations.add(settings, 'bloomStrength', 0, 0.6, 0.01).name('Bloom strength');
optimizations.add(settings, 'bloomThreshold', 0.1, 2, 0.05).name('Bloom threshold');
debugFolder
    .add(settings, 'lightIndexBudget', [64, 128, 256, 512])
    .name('Pool budget / cluster')
    .onChange(() => {
        settings.lightIndexBudget = Number(settings.lightIndexBudget);
        lights.configureClustering();
        setRenderer(controls.mode);
    });
benchmarkFolder
    .add(
        {
            run: () =>
                void runBenchmark({
                    modes: [controls.mode],
                    lightCounts: [lights.numLights],
                    repeats: 1,
                }).catch(showError),
        },
        'run'
    )
    .name('Benchmark current');
benchmarkFolder
    .add({ run: () => void runBenchmark().catch(showError) }, 'run')
    .name('Full light sweep');
benchmarkFolder
    .add(
        {
            save: () => {
                if (lastBenchmark) {
                    downloadJson('lighting-benchmark.json', lastBenchmark);
                }
            },
        },
        'save'
    )
    .name('Export last results');

const status = document.getElementById('status')!;
const cancelBenchmark = document.getElementById('cancel-benchmark')!;
cancelBenchmark.addEventListener('click', () => renderer.cancelMeasurement());
function showError(error: unknown) {
    if (error instanceof Error && error.message === 'Benchmark cancelled') {
        status.textContent = 'Benchmark cancelled.';
        return;
    }
    console.error(error);
    status.textContent = String(error);
}

interface BenchmarkOptions {
    modes?: string[];
    lightCounts?: number[];
    warmup?: number;
    samples?: number;
    repeats?: number;
}

export async function runBenchmark(options: BenchmarkOptions = {}) {
    if (benchmarkRunning) {
        throw new Error('A benchmark is already running');
    }
    const modes = options.modes ?? Object.values(renderModes);
    const counts = options.lightCounts ?? [100, 500, 1000, 2000, 5000];
    const warmup = options.warmup ?? 30;
    const samples = options.samples ?? 120;
    const repeats = options.repeats ?? 3;
    if (
        !Number.isInteger(warmup) ||
        warmup < 0 ||
        !Number.isInteger(samples) ||
        samples < 1 ||
        !Number.isInteger(repeats) ||
        repeats < 1
    ) {
        throw new Error('Invalid benchmark sample counts');
    }
    if (
        !counts.length ||
        counts.some(
            count => !Number.isInteger(count) || count < 1 || count > Lights.maxNumLights
        ) ||
        !modes.length ||
        modes.some(mode => !Object.values(renderModes).includes(mode))
    ) {
        throw new Error('Invalid benchmark workload');
    }

    // Freeze the workload for all trials, then restore the user's scene in finally.
    const original = {
        mode: controls.mode,
        paused: lights.paused,
        time: lights.animationTime,
        count: lights.numLights,
        debug: settings.debugView,
        width: settings.renderWidth,
        height: settings.renderHeight,
    };

    benchmarkRunning = true;
    gui.domElement.style.pointerEvents = 'none';
    cancelBenchmark.hidden = false;
    settings.renderWidth = original.width || canvas.width;
    settings.renderHeight = original.height || canvas.height;
    camera.keys = {};
    camera.inputEnabled = false;
    lights.paused = true;
    lights.animationTime = 0;
    settings.debugView = 0;

    const runs = [];
    try {
        for (let repeat = 0; repeat < repeats; repeat++) {
            // Rotate order between repetitions to reduce a consistent warm/thermal bias.
            const order = [
                ...modes.slice(repeat % modes.length),
                ...modes.slice(0, repeat % modes.length),
            ];

            for (const count of counts) {
                for (const mode of order) {
                    lights.numLights = count;
                    lights.updateLightSetUniformNumLights();
                    setRenderer(mode);

                    status.textContent = `Measuring ${mode} / ${count} lights / run ${repeat + 1}/${repeats}`;
                    const frames = await renderer.measureFrames(warmup, samples);
                    const clusters =
                        mode === renderModes.naive ? null : await lights.getClusterStatistics();

                    runs.push({
                        mode,
                        lights: count,
                        repeat,
                        summary: summarizeFrames(frames),
                        frames,
                        clusters,
                    });
                }
            }
        }

        const result = {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            environment: {
                userAgent: navigator.userAgent,
                hardwareConcurrency: navigator.hardwareConcurrency,
                adapter: {
                    vendor: adapterInfo.vendor,
                    architecture: adapterInfo.architecture,
                    device: adapterInfo.device,
                    description: adapterInfo.description,
                },
                timestampQueries: profiler.supported,
                width: canvas.width,
                height: canvas.height,
                devicePixelRatio: window.devicePixelRatio,
            },
            camera: {
                position: Array.from(camera.cameraPos),
                yaw: camera.yaw,
                pitch: camera.pitch,
                near: Camera.nearPlane,
                far: Camera.farPlane,
            },
            settings: { ...settings },
            methodology: {
                warmupFrames: warmup,
                sampledFrames: samples,
                repeats,
                animationTimeMs: 0,
                lightColorSeed: 5650,
                gpuTiming:
                    'Sum of timestamped renderer passes including HDR composite and enabled bloom; excludes light animation, browser compositor/presentation, and readback. CPU measures draw command encoding and submit, excluding camera/light updates.',
            },
            runs,
        };
        lastBenchmark = result;
        status.textContent = `Finished ${runs.length} measurements. Export results to save raw samples.`;
        return result;
    } finally {
        // This also runs on cancellation, so input and controls never stay disabled.
        lights.numLights = original.count;
        lights.updateLightSetUniformNumLights();
        lights.paused = original.paused;
        lights.animationTime = original.time;
        settings.debugView = original.debug;
        camera.inputEnabled = true;
        benchmarkRunning = false;
        gui.domElement.style.pointerEvents = '';
        cancelBenchmark.hidden = true;
        settings.renderWidth = original.width;
        settings.renderHeight = original.height;
        setRenderer(original.mode);
        gui.updateDisplay();
    }
}

setRenderer(controls.mode);
setInterval(() => {
    const timing = profiler.latest;
    document.getElementById('gpu-time')!.textContent =
        timing.gpuMs === null ? 'Unavailable' : `${timing.gpuMs.toFixed(2)} ms`;
    document.getElementById('cpu-time')!.textContent = `${timing.cpuMs.toFixed(2)} ms`;
    document.getElementById('scene-info')!.textContent =
        `${controls.mode} / ${lights.numLights.toLocaleString()} lights / ${canvas.width} × ${canvas.height}`;
}, 250);
status.textContent = '';

// Public experiment API: browser tests and console experiments share the UI's
// application instance rather than importing the entry module a second time.
Object.assign(window, {
    lightingLab: {
        camera,
        lights,
        settings,
        setRenderer,
        runBenchmark,
        get renderer() {
            return renderer;
        },
        get lastBenchmark() {
            return lastBenchmark;
        },
        get benchmarkRunning() {
            return benchmarkRunning;
        },
    },
});
