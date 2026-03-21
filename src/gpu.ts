import compositeShaderSource from "../shaders/composite.wgsl?raw";
import selectionShaderSource from "../shaders/selection.wgsl?raw";
import gradientMapShaderSource from "../shaders/gradient_map.wgsl?raw";

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
}

export async function initGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in this browser.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Failed to get GPU adapter.");
  }

  const device = await adapter.requestDevice();
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
