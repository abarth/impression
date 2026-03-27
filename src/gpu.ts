import compositeShaderSource from "../shaders/composite.wgsl?raw";
import selectionShaderSource from "../shaders/selection.wgsl?raw";
import gradientMapShaderSource from "../shaders/gradient_map.wgsl?raw";
import wetMediaCompositeShaderSource from "../shaders/wet_media_composite.wgsl?raw";
import wetMediaDepositShaderSource from "../shaders/wet_media_deposit.wgsl?raw";
import wetMediaAdvectShaderSource from "../shaders/wet_media_advect.wgsl?raw";
import wetMediaDiffuseShaderSource from "../shaders/wet_media_diffuse.wgsl?raw";
import wetMediaDryShaderSource from "../shaders/wet_media_dry.wgsl?raw";
import mixboxShaderSource from "../shaders/mixbox.wgsl?raw";
import { generatePaperTexture } from "./paperTexture";
import { initMixbox } from "./mixbox";
import type { MediumType } from "./hooks/useBrushSettings";
import { getMediumPhysics } from "./hooks/useBrushSettings";

export interface GPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  sampler: GPUSampler;

  // Per-layer resources
  layerTextures: GPUTexture[];
  layerBindGroups: GPUBindGroup[];
  layerUniformBuffers: GPUBuffer[];
  layerBindGroupLayout: GPUBindGroupLayout;

  // Ping-pong accumulation textures
  accumTextures: [GPUTexture, GPUTexture];
  accumViews: [GPUTextureView, GPUTextureView];
  dstBindGroupLayout: GPUBindGroupLayout;
  dstBindGroups: [GPUBindGroup, GPUBindGroup];

  // Pipelines
  compositePipeline: GPURenderPipeline;
  gradientMapPipeline: GPURenderPipeline;
  blitPipeline: GPURenderPipeline;
  blitBindGroupLayout: GPUBindGroupLayout;
  blitBindGroups: [GPUBindGroup, GPUBindGroup];
  blitUniformBuffer: GPUBuffer;

  // Selection overlay
  selectionPipeline: GPURenderPipeline;
  selectionBindGroupLayout: GPUBindGroupLayout;
  selectionTexture: GPUTexture | null;
  selectionBindGroup: GPUBindGroup | null;
  selectionTimeBuffer: GPUBuffer;

  // Wet media layer compositing
  wetMediaPipeline: GPURenderPipeline;
  wetMediaBindGroupLayout: GPUBindGroupLayout;

  // Wet media paint deposition compute
  wetMediaDepositPipeline: GPUComputePipeline;
  wetMediaDepositBindGroupLayout: GPUBindGroupLayout;

  // Wet media simulation compute pipelines
  wetMediaAdvectPipeline: GPUComputePipeline;
  wetMediaAdvectBindGroupLayout: GPUBindGroupLayout;
  wetMediaDiffusePipeline: GPUComputePipeline;
  wetMediaDiffuseBindGroupLayout: GPUBindGroupLayout;
  wetMediaDryPipeline: GPUComputePipeline;
  wetMediaDryBindGroupLayout: GPUBindGroupLayout;

  // Mixbox pigment mixing LUT
  mixboxLUT: GPUTexture;
  mixboxSampler: GPUSampler;
}

export async function initGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in this browser.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Failed to get GPU adapter.");
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageTexturesPerShaderStage: Math.min(
        8,
        adapter.limits.maxStorageTexturesPerShaderStage,
      ),
    },
  });
  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to get WebGPU context.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const sampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
  });

  // --- Composite pipeline (layer + dst → accum) ---

  // Group 0: layer texture + sampler + uniforms (opacity as f32 bits + blend mode)
  const layerBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  // Group 1: destination accumulation texture
  const dstBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
    ],
  });

  const shaderModule = device.createShaderModule({
    code: compositeShaderSource,
  });

  const compositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [layerBindGroupLayout, dstBindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: "vs",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }], // writes to accum texture
    },
    primitive: { topology: "triangle-list" },
  });

  // --- Gradient Map pipeline (same bind group layouts, different shader) ---

  const gradientMapModule = device.createShaderModule({
    code: gradientMapShaderSource,
  });

  const gradientMapPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [layerBindGroupLayout, dstBindGroupLayout],
    }),
    vertex: {
      module: gradientMapModule,
      entryPoint: "vs",
    },
    fragment: {
      module: gradientMapModule,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });

  // --- Blit pipeline (accum → canvas, simple pass-through) ---

  const blitBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const blitPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [blitBindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: "vs",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "blit_fs",
      targets: [{ format }], // writes to canvas
    },
    primitive: { topology: "triangle-list" },
  });

  // --- Accumulation textures (ping-pong pair) ---

  const { width, height } = canvas;
  const accumTextures = [
    createAccumTexture(device, width, height),
    createAccumTexture(device, width, height),
  ] as [GPUTexture, GPUTexture];

  const accumViews = [
    accumTextures[0].createView(),
    accumTextures[1].createView(),
  ] as [GPUTextureView, GPUTextureView];

  const dstBindGroups = [
    device.createBindGroup({
      layout: dstBindGroupLayout,
      entries: [{ binding: 0, resource: accumViews[0] }],
    }),
    device.createBindGroup({
      layout: dstBindGroupLayout,
      entries: [{ binding: 0, resource: accumViews[1] }],
    }),
  ] as [GPUBindGroup, GPUBindGroup];

  // Blit bind groups (one per accum texture, reuses blitBindGroupLayout)
  const blitUniformBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // opacity=1.0, blendMode=0 (unused by blit shader but must be bound)
  device.queue.writeBuffer(blitUniformBuffer, 0, new Uint32Array([
    floatToUint32(1.0), 0,
  ]));

  const blitBindGroups = [
    device.createBindGroup({
      layout: blitBindGroupLayout,
      entries: [
        { binding: 0, resource: accumViews[0] },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: blitUniformBuffer } },
      ],
    }),
    device.createBindGroup({
      layout: blitBindGroupLayout,
      entries: [
        { binding: 0, resource: accumViews[1] },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: blitUniformBuffer } },
      ],
    }),
  ] as [GPUBindGroup, GPUBindGroup];

  // --- Wet media compositing pipeline ---
  // Group 0: color texture + properties texture + sampler + uniforms
  const wetMediaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const wetMediaShaderModule = device.createShaderModule({
    code: wetMediaCompositeShaderSource,
  });

  const wetMediaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [wetMediaBindGroupLayout, dstBindGroupLayout],
    }),
    vertex: {
      module: wetMediaShaderModule,
      entryPoint: "vs",
    },
    fragment: {
      module: wetMediaShaderModule,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });

  // --- Wet media deposit compute pipeline ---
  const wetMediaDepositBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "r32float" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
    ],
  });

  const wetMediaDepositModule = device.createShaderModule({
    code: mixboxShaderSource + "\n" + wetMediaDepositShaderSource,
  });

  const wetMediaDepositPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [wetMediaDepositBindGroupLayout],
    }),
    compute: {
      module: wetMediaDepositModule,
      entryPoint: "main",
    },
  });

  // --- Wet media advection pipeline ---
  const wetMediaAdvectBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rg32float" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rg32float" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const wetMediaAdvectPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [wetMediaAdvectBindGroupLayout] }),
    compute: { module: device.createShaderModule({ code: wetMediaAdvectShaderSource }), entryPoint: "main" },
  });

  // --- Wet media diffusion pipeline ---
  const wetMediaDiffuseBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "r32float" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
    ],
  });
  const wetMediaDiffusePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [wetMediaDiffuseBindGroupLayout] }),
    compute: { module: device.createShaderModule({ code: mixboxShaderSource + "\n" + wetMediaDiffuseShaderSource }), entryPoint: "main" },
  });

  // --- Wet media drying pipeline ---
  const wetMediaDryBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba32float" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const wetMediaDryPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [wetMediaDryBindGroupLayout] }),
    compute: { module: device.createShaderModule({ code: wetMediaDryShaderSource }), entryPoint: "main" },
  });

  // --- Selection overlay pipeline ---

  const selectionBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const selectionShaderModule = device.createShaderModule({
    code: selectionShaderSource,
  });

  const selectionPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [selectionBindGroupLayout],
    }),
    vertex: {
      module: selectionShaderModule,
      entryPoint: "vs",
    },
    fragment: {
      module: selectionShaderModule,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const selectionTimeBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // --- Mixbox pigment mixing LUT ---
  const mixboxResources = await initMixbox(device);

  return {
    device,
    context,
    format,
    sampler,
    layerTextures: [],
    layerBindGroups: [],
    layerUniformBuffers: [],
    layerBindGroupLayout,
    accumTextures,
    accumViews,
    dstBindGroupLayout,
    dstBindGroups,
    compositePipeline,
    gradientMapPipeline,
    blitPipeline,
    blitBindGroupLayout,
    blitBindGroups,
    blitUniformBuffer,
    selectionPipeline,
    selectionBindGroupLayout,
    selectionTexture: null,
    selectionBindGroup: null,
    selectionTimeBuffer,
    wetMediaPipeline,
    wetMediaBindGroupLayout,
    wetMediaDepositPipeline,
    wetMediaDepositBindGroupLayout,
    wetMediaAdvectPipeline,
    wetMediaAdvectBindGroupLayout,
    wetMediaDiffusePipeline,
    wetMediaDiffuseBindGroupLayout,
    wetMediaDryPipeline,
    wetMediaDryBindGroupLayout,
    mixboxLUT: mixboxResources.lutTexture,
    mixboxSampler: mixboxResources.lutSampler,
  };
}

function createAccumTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Reinterpret a float as uint32 bits (for packing into uniform buffer). */
function floatToUint32(f: number): number {
  const buf = new Float32Array([f]);
  return new Uint32Array(buf.buffer)[0];
}

export { floatToUint32 };

export function createLayerTexture(
  gpu: GPUContext,
  width: number,
  height: number,
): number {
  const texture = gpu.device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Uniform buffer: [opacity as f32 bits (u32), blendMode (u32)]
  const uniformBuffer = gpu.device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  gpu.device.queue.writeBuffer(
    uniformBuffer,
    0,
    new Uint32Array([floatToUint32(1.0), 0]), // opacity=1.0, blendMode=Normal
  );

  const bindGroup = gpu.device.createBindGroup({
    layout: gpu.layerBindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: gpu.sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });

  const index = gpu.layerTextures.length;
  gpu.layerTextures.push(texture);
  gpu.layerBindGroups.push(bindGroup);
  gpu.layerUniformBuffers.push(uniformBuffer);
  return index;
}

export function removeLayerTexture(
  gpu: GPUContext,
  layerIndex: number,
): void {
  const texture = gpu.layerTextures[layerIndex];
  if (texture) texture.destroy();

  const buffer = gpu.layerUniformBuffers[layerIndex];
  if (buffer) buffer.destroy();

  gpu.layerTextures.splice(layerIndex, 1);
  gpu.layerBindGroups.splice(layerIndex, 1);
  gpu.layerUniformBuffers.splice(layerIndex, 1);
}

export function uploadLayerTexture(
  gpu: GPUContext,
  layerIndex: number,
  data: Uint8Array,
  width: number,
  height: number,
  region?: { x: number; y: number; w: number; h: number },
): void {
  const texture = gpu.layerTextures[layerIndex];
  if (!texture) return;

  if (region) {
    // Partial upload: data is a sub-view starting at the region origin,
    // with bytesPerRow = full canvas width (rows are contiguous in the full buffer).
    const offset = (region.y * width + region.x) * 4;
    gpu.device.queue.writeTexture(
      { texture, origin: { x: region.x, y: region.y } },
      data as unknown as BufferSource,
      { offset, bytesPerRow: width * 4, rowsPerImage: height },
      { width: region.w, height: region.h },
    );
  } else {
    gpu.device.queue.writeTexture(
      { texture },
      data as unknown as BufferSource,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height },
    );
  }
}

export function uploadSelectionTexture(
  gpu: GPUContext,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  // Create or recreate texture if size changed
  if (
    !gpu.selectionTexture ||
    gpu.selectionTexture.width !== width ||
    gpu.selectionTexture.height !== height
  ) {
    if (gpu.selectionTexture) gpu.selectionTexture.destroy();

    gpu.selectionTexture = gpu.device.createTexture({
      size: { width, height },
      format: "r8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });

    gpu.selectionBindGroup = gpu.device.createBindGroup({
      layout: gpu.selectionBindGroupLayout,
      entries: [
        { binding: 0, resource: gpu.selectionTexture.createView() },
        { binding: 1, resource: gpu.sampler },
        { binding: 2, resource: { buffer: gpu.selectionTimeBuffer } },
      ],
    });
  }

  gpu.device.queue.writeTexture(
    { texture: gpu.selectionTexture },
    data as unknown as BufferSource,
    { bytesPerRow: width, rowsPerImage: height },
    { width, height },
  );
}

export function clearSelectionTexture(gpu: GPUContext): void {
  if (gpu.selectionTexture) {
    gpu.selectionTexture.destroy();
    gpu.selectionTexture = null;
    gpu.selectionBindGroup = null;
  }
}

/**
 * Create a gradient texture slot for an adjustment layer.
 * Uses a 256×1 rgba8unorm texture with linear filtering.
 * Occupies the same layer slot arrays as a raster layer.
 */
export function createGradientLayerTexture(gpu: GPUContext): number {
  const texture = gpu.device.createTexture({
    size: { width: 256, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const uniformBuffer = gpu.device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  gpu.device.queue.writeBuffer(
    uniformBuffer,
    0,
    new Uint32Array([floatToUint32(1.0), 0]),
  );

  const bindGroup = gpu.device.createBindGroup({
    layout: gpu.layerBindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: gpu.sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });

  const index = gpu.layerTextures.length;
  gpu.layerTextures.push(texture);
  gpu.layerBindGroups.push(bindGroup);
  gpu.layerUniformBuffers.push(uniformBuffer);
  return index;
}

/**
 * GPU-side textures for a wet media layer.
 * These are stored separately from the layer texture arrays since wet media
 * layers use a different bind group layout (color + properties textures).
 */
export interface WetMediaLayerGPU {
  colorTexture: GPUTexture;
  propsTexture: GPUTexture;
  /** Ping-pong pair for advection/diffusion simulation. */
  colorTextureB: GPUTexture;
  propsTextureB: GPUTexture;
  /** Velocity field (RG32Float) for advection — ping-pong pair. */
  velocityTexture: GPUTexture;
  velocityTextureB: GPUTexture;
  /** Which buffer is current (0 = A, 1 = B). Toggled each sim step. */
  pingPong: number;
  /** Composite bind group (references current color + props textures). */
  bindGroup: GPUBindGroup;
  /** Second bind group for the other ping-pong state. */
  bindGroupB: GPUBindGroup;
  /** Canvas grain texture (r32float) generated from Perlin noise. */
  paperTexture: GPUTexture;
  /** Medium type for this layer's simulation parameters. */
  mediumType: MediumType;
  /** True if any pixel has wetness > 0 and simulation should run. */
  hasWetPaint: boolean;
}

/** Per-layer wet media GPU resources, keyed by layer index. */
const wetMediaLayers = new Map<number, WetMediaLayerGPU>();

/**
 * Create GPU textures for a wet media layer.
 * Allocates color (rgba32float) and properties (rgba32float) textures,
 * plus a bind group compatible with the wet media composite pipeline.
 * Also creates a placeholder raster layer slot so layer indices stay aligned.
 */
export function createWetMediaLayerTexture(
  gpu: GPUContext,
  width: number,
  height: number,
): number {
  const createFloat32Texture = (fmt: GPUTextureFormat = "rgba32float") =>
    gpu.device.createTexture({
      size: { width, height },
      format: fmt,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    });

  const colorTexture = createFloat32Texture();
  const propsTexture = createFloat32Texture();
  const colorTextureB = createFloat32Texture();
  const propsTextureB = createFloat32Texture();
  const velocityTexture = createFloat32Texture("rg32float");
  const velocityTextureB = createFloat32Texture("rg32float");

  // Paper grain texture (r32float) — deterministic from layer count as seed
  const paperSeed = gpu.layerTextures.length + 1;
  const paperData = generatePaperTexture(width, height, paperSeed);
  const paperTexture = gpu.device.createTexture({
    size: { width, height },
    format: "r32float",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST,
  });
  gpu.device.queue.writeTexture(
    { texture: paperTexture },
    paperData.buffer,
    { bytesPerRow: width * 4 },
    { width, height },
  );

  // Uniform buffer: [opacity as f32 bits (u32), blendMode (u32)]
  const uniformBuffer = gpu.device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  gpu.device.queue.writeBuffer(
    uniformBuffer,
    0,
    new Uint32Array([floatToUint32(1.0), 0]),
  );

  const makeBindGroup = (color: GPUTexture, props: GPUTexture) =>
    gpu.device.createBindGroup({
      layout: gpu.wetMediaBindGroupLayout,
      entries: [
        { binding: 0, resource: color.createView() },
        { binding: 1, resource: props.createView() },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

  const bindGroup = makeBindGroup(colorTexture, propsTexture);
  const bindGroupB = makeBindGroup(colorTextureB, propsTextureB);

  // Placeholder in regular layer arrays for index alignment
  const placeholderTexture = gpu.device.createTexture({
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const placeholderBindGroup = gpu.device.createBindGroup({
    layout: gpu.layerBindGroupLayout,
    entries: [
      { binding: 0, resource: placeholderTexture.createView() },
      { binding: 1, resource: gpu.sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });

  const index = gpu.layerTextures.length;
  gpu.layerTextures.push(placeholderTexture);
  gpu.layerBindGroups.push(placeholderBindGroup);
  gpu.layerUniformBuffers.push(uniformBuffer);

  wetMediaLayers.set(index, {
    colorTexture, propsTexture,
    colorTextureB, propsTextureB,
    velocityTexture, velocityTextureB,
    pingPong: 0,
    bindGroup, bindGroupB,
    paperTexture,
    mediumType: "Oil" as MediumType,
    hasWetPaint: false,
  });
  return index;
}

/** Dispatch the paint deposition compute shader for a single footprint. */
export function dispatchWetMediaDeposit(
  gpu: GPUContext,
  layerIndex: number,
  maskData: Float32Array,
  params: {
    originX: number;
    originY: number;
    paintR: number;
    paintG: number;
    paintB: number;
    paintLoad: number;
    velocityX: number;
    velocityY: number;
    mixingStrength: number;
    paintThickness: number;
    wetness: number;
    maskWidth: number;
    maskHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    canvasTextureStrength: number;
  },
): void {
  const wm = wetMediaLayers.get(layerIndex);
  if (!wm) return;

  // Upload mask to a storage buffer
  const maskBuffer = gpu.device.createBuffer({
    size: maskData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(maskBuffer.getMappedRange()).set(maskData);
  maskBuffer.unmap();

  // Create uniform buffer with deposit params
  // Must match the WGSL DepositParams struct layout (16 fields * 4 bytes = 64 bytes, padded to 80)
  const uniformData = new ArrayBuffer(80);
  const floatView = new Float32Array(uniformData);
  const uintView = new Uint32Array(uniformData);
  floatView[0] = params.originX;
  floatView[1] = params.originY;
  floatView[2] = params.paintR;
  floatView[3] = params.paintG;
  floatView[4] = params.paintB;
  floatView[5] = params.paintLoad;
  floatView[6] = params.velocityX;
  floatView[7] = params.velocityY;
  floatView[8] = params.mixingStrength;
  floatView[9] = params.paintThickness;
  floatView[10] = params.wetness;
  uintView[11] = params.maskWidth;
  uintView[12] = params.maskHeight;
  uintView[13] = params.canvasWidth;
  uintView[14] = params.canvasHeight;
  floatView[15] = params.canvasTextureStrength;

  const uniformBuffer = gpu.device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(uniformBuffer.getMappedRange()).set(new Uint8Array(uniformData));
  uniformBuffer.unmap();

  // Copy current state (A textures) to B textures so shader can read from B
  const encoder = gpu.device.createCommandEncoder();
  encoder.copyTextureToTexture(
    { texture: wm.colorTexture },
    { texture: wm.colorTextureB },
    { width: params.canvasWidth, height: params.canvasHeight },
  );
  encoder.copyTextureToTexture(
    { texture: wm.propsTexture },
    { texture: wm.propsTextureB },
    { width: params.canvasWidth, height: params.canvasHeight },
  );

  // Create bind group: read from B (src), write to A (dst)
  const bindGroup = gpu.device.createBindGroup({
    layout: gpu.wetMediaDepositBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: maskBuffer } },
      { binding: 1, resource: wm.colorTextureB.createView() },
      { binding: 2, resource: wm.colorTexture.createView() },
      { binding: 3, resource: wm.propsTextureB.createView() },
      { binding: 4, resource: wm.propsTexture.createView() },
      { binding: 5, resource: { buffer: uniformBuffer } },
      { binding: 6, resource: wm.paperTexture.createView() },
      { binding: 7, resource: gpu.mixboxLUT.createView() },
      { binding: 8, resource: gpu.mixboxSampler },
    ],
  });

  // Dispatch deposit (reads from B, writes to A)
  const pass = encoder.beginComputePass();
  pass.setPipeline(gpu.wetMediaDepositPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(
    Math.ceil(params.maskWidth / 8),
    Math.ceil(params.maskHeight / 8),
  );
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);

  // Clean up transient buffers
  maskBuffer.destroy();
  uniformBuffer.destroy();
}

/**
 * Run one simulation step (advect → diffuse → dry) for a wet media layer.
 * Toggles the ping-pong buffers.
 */
export function stepWetMediaSimulation(
  gpu: GPUContext,
  layerIndex: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const wm = wetMediaLayers.get(layerIndex);
  if (!wm || !wm.hasWetPaint) return;

  // Derive simulation constants from medium type
  const physics = getMediumPhysics(wm.mediumType);
  const dryingRate = physics.dryingRate;
  const diffusionRate = physics.diffusionRate;
  const advectionDissipation = physics.advectionDissipation;

  const workgroupsX = Math.ceil(canvasWidth / 8);
  const workgroupsY = Math.ceil(canvasHeight / 8);

  // Determine ping-pong source/dest
  const colorSrc = wm.pingPong === 0 ? wm.colorTexture : wm.colorTextureB;
  const colorDst = wm.pingPong === 0 ? wm.colorTextureB : wm.colorTexture;
  const propsSrc = wm.pingPong === 0 ? wm.propsTexture : wm.propsTextureB;
  const propsDst = wm.pingPong === 0 ? wm.propsTextureB : wm.propsTexture;
  const velSrc = wm.pingPong === 0 ? wm.velocityTexture : wm.velocityTextureB;
  const velDst = wm.pingPong === 0 ? wm.velocityTextureB : wm.velocityTexture;

  const encoder = gpu.device.createCommandEncoder();

  // --- Advection pass ---
  const advectUniform = gpu.device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  {
    const view = new ArrayBuffer(16);
    new Uint32Array(view, 0, 2).set([canvasWidth, canvasHeight]);
    new Float32Array(view, 8, 2).set([1.0, advectionDissipation]);
    new Uint8Array(advectUniform.getMappedRange()).set(new Uint8Array(view));
    advectUniform.unmap();
  }

  const advectBG = gpu.device.createBindGroup({
    layout: gpu.wetMediaAdvectBindGroupLayout,
    entries: [
      { binding: 0, resource: colorSrc.createView() },
      { binding: 1, resource: colorDst.createView() },
      { binding: 2, resource: propsSrc.createView() },
      { binding: 3, resource: propsDst.createView() },
      { binding: 4, resource: velSrc.createView() },
      { binding: 5, resource: velDst.createView() },
      { binding: 6, resource: { buffer: advectUniform } },
    ],
  });

  {
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpu.wetMediaAdvectPipeline);
    pass.setBindGroup(0, advectBG);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
  }

  // After advection, dst is now the "current" buffer
  // --- Diffusion pass (reads from dst, writes back to src) ---
  const diffuseUniform = gpu.device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  {
    const view = new ArrayBuffer(16);
    new Uint32Array(view, 0, 2).set([canvasWidth, canvasHeight]);
    new Float32Array(view, 8, 2).set([diffusionRate, 0.0]);
    new Uint8Array(diffuseUniform.getMappedRange()).set(new Uint8Array(view));
    diffuseUniform.unmap();
  }

  const diffuseBG = gpu.device.createBindGroup({
    layout: gpu.wetMediaDiffuseBindGroupLayout,
    entries: [
      { binding: 0, resource: colorDst.createView() },
      { binding: 1, resource: colorSrc.createView() },
      { binding: 2, resource: propsDst.createView() },
      { binding: 3, resource: propsSrc.createView() },
      { binding: 4, resource: { buffer: diffuseUniform } },
      { binding: 5, resource: wm.paperTexture.createView() },
      { binding: 6, resource: gpu.mixboxLUT.createView() },
      { binding: 7, resource: gpu.mixboxSampler },
    ],
  });

  {
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpu.wetMediaDiffusePipeline);
    pass.setBindGroup(0, diffuseBG);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
  }

  // After diffusion, src is now current again (ping-pong stays the same)
  // --- Drying pass (propsSrc → propsDst, then copy back to propsSrc) ---
  const dryUniform = gpu.device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  {
    const view = new ArrayBuffer(16);
    new Uint32Array(view, 0, 2).set([canvasWidth, canvasHeight]);
    new Float32Array(view, 8, 2).set([dryingRate, 0.0]);
    new Uint8Array(dryUniform.getMappedRange()).set(new Uint8Array(view));
    dryUniform.unmap();
  }

  const dryBG = gpu.device.createBindGroup({
    layout: gpu.wetMediaDryBindGroupLayout,
    entries: [
      { binding: 0, resource: propsSrc.createView() },
      { binding: 1, resource: propsDst.createView() },
      { binding: 2, resource: { buffer: dryUniform } },
    ],
  });

  {
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpu.wetMediaDryPipeline);
    pass.setBindGroup(0, dryBG);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
  }

  // Copy dried props back to src so compositing (which always reads from A textures) stays correct
  encoder.copyTextureToTexture(
    { texture: propsDst },
    { texture: propsSrc },
    { width: canvasWidth, height: canvasHeight },
  );

  gpu.device.queue.submit([encoder.finish()]);

  // Clean up transient uniform buffers
  advectUniform.destroy();
  diffuseUniform.destroy();
  dryUniform.destroy();

  // Note: ping-pong state stays the same because diffusion writes back to src
}

/** Mark a wet media layer as having wet paint (enables simulation). */
export function setWetMediaHasWetPaint(index: number, hasWet: boolean): void {
  const wm = wetMediaLayers.get(index);
  if (wm) wm.hasWetPaint = hasWet;
}

/** Set the medium type for a wet media layer. */
export function setWetMediaMediumType(index: number, medium: MediumType): void {
  const wm = wetMediaLayers.get(index);
  if (wm) wm.mediumType = medium;
}

/** Check if any wet media layers have wet paint needing simulation. */
export function hasAnyWetPaint(): boolean {
  for (const wm of wetMediaLayers.values()) {
    if (wm.hasWetPaint) return true;
  }
  return false;
}

/** Get all wet media layer indices. */
export function getWetMediaLayerIndices(): number[] {
  return [...wetMediaLayers.keys()];
}

/** Get wet media GPU resources for a layer, or undefined if not a wet media layer. */
export function getWetMediaLayer(index: number): WetMediaLayerGPU | undefined {
  return wetMediaLayers.get(index);
}

/** Clear all wet media textures for a layer (color, props, velocity) to zero.
 *  Used during undo/redo to reset GPU state before replaying operations. */
export function clearWetMediaTextures(gpu: GPUContext, index: number): void {
  const wm = wetMediaLayers.get(index);
  if (!wm) return;

  // Create a zeroed buffer large enough for the largest texture
  const textures = [
    wm.colorTexture, wm.propsTexture,
    wm.colorTextureB, wm.propsTextureB,
  ];
  for (const tex of textures) {
    const { width, height } = tex;
    const bytesPerPixel = 16; // rgba32float = 4 * 4 bytes
    const buf = new ArrayBuffer(width * height * bytesPerPixel);
    gpu.device.queue.writeTexture(
      { texture: tex },
      buf,
      { bytesPerRow: width * bytesPerPixel, rowsPerImage: height },
      { width, height },
    );
  }
  // rg32float velocity textures = 8 bytes per pixel
  for (const tex of [wm.velocityTexture, wm.velocityTextureB]) {
    const { width, height } = tex;
    const bytesPerPixel = 8;
    const buf = new ArrayBuffer(width * height * bytesPerPixel);
    gpu.device.queue.writeTexture(
      { texture: tex },
      buf,
      { bytesPerRow: width * bytesPerPixel, rowsPerImage: height },
      { width, height },
    );
  }

  wm.pingPong = 0;
  wm.hasWetPaint = false;
}

/** Remove wet media GPU resources for a layer. */
export function removeWetMediaLayer(index: number): void {
  const wm = wetMediaLayers.get(index);
  if (wm) {
    wm.colorTexture.destroy();
    wm.propsTexture.destroy();
    wm.colorTextureB.destroy();
    wm.propsTextureB.destroy();
    wm.velocityTexture.destroy();
    wm.velocityTextureB.destroy();
    wetMediaLayers.delete(index);
  }
  // Re-key entries above this index
  const entries = [...wetMediaLayers.entries()].filter(([k]) => k > index);
  for (const [k, v] of entries) {
    wetMediaLayers.delete(k);
    wetMediaLayers.set(k - 1, v);
  }
}

/**
 * Upload rasterized gradient data (256×1 RGBA) to a gradient layer texture.
 */
export function uploadGradientTexture(
  gpu: GPUContext,
  layerIndex: number,
  data: Uint8Array,
): void {
  const texture = gpu.layerTextures[layerIndex];
  if (!texture) return;
  gpu.device.queue.writeTexture(
    { texture },
    data as unknown as BufferSource,
    { bytesPerRow: 256 * 4, rowsPerImage: 1 },
    { width: 256, height: 1 },
  );
}

export function updateLayerOpacity(
  gpu: GPUContext,
  layerIndex: number,
  opacity: number,
): void {
  const buffer = gpu.layerUniformBuffers[layerIndex];
  if (!buffer) return;
  // Write opacity at offset 0 (as f32 reinterpreted to u32 bits)
  gpu.device.queue.writeBuffer(buffer, 0, new Uint32Array([floatToUint32(opacity)]));
}

/** Release all GPU resources (textures, buffers, device). */
export function destroyGPU(gpu: GPUContext): void {
  // Destroy layer resources
  for (const tex of gpu.layerTextures) tex.destroy();
  for (const buf of gpu.layerUniformBuffers) buf.destroy();
  gpu.layerTextures.length = 0;
  gpu.layerBindGroups.length = 0;
  gpu.layerUniformBuffers.length = 0;

  // Destroy accumulation textures
  for (const tex of gpu.accumTextures) tex.destroy();

  // Destroy selection resources
  if (gpu.selectionTexture) gpu.selectionTexture.destroy();
  gpu.selectionTimeBuffer.destroy();

  // Destroy shared buffers
  gpu.blitUniformBuffer.destroy();

  // Destroy the device itself
  gpu.device.destroy();
}

export function updateLayerBlendMode(
  gpu: GPUContext,
  layerIndex: number,
  mode: number,
): void {
  const buffer = gpu.layerUniformBuffers[layerIndex];
  if (!buffer) return;
  // Write blend mode at offset 4
  gpu.device.queue.writeBuffer(buffer, 4, new Uint32Array([mode]));
}
