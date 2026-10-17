export const settings = {
    debugView: 0,
    renderWidth: 0,
    renderHeight: 0,
    clusterX: 16,
    clusterY: 12,
    clusterZ: 24,
    lightIndexBudget: 256,
    bundles: false,
    depthPrepass: false,
    computeLighting: false,
    compactGBuffer: false,
    bloom: false,
    bloomStrength: 0.2,
    bloomThreshold: 0.8,
};

export const debugViews = {
    Lit: 0,
    'Cluster occupancy': 1,
    'Depth slices': 2,
    Albedo: 3,
    Normals: 4,
    'World position': 5,
    'Cluster overflow': 6,
};
