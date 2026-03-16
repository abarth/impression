import compositeShaderSource from "../shaders/composite.wgsl?raw";
import selectionShaderSource from "../shaders/selection.wgsl?raw";

export interface GPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
  layerTextures: GPUTexture[];
  layerBindGroups: GPUBindGroup[];
  opacityBuffers: GPUBuffer[];
  bindGroupLayout: GPUBindGroupLayout;
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

  const bindGroupLayout = device.createBindGroupLayout({
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

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const shaderModule = device.createShaderModule({
    code: compositeShaderSource,
  });

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs",
    },
    fragment: {
      module: shaderModule,
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
    primitive: {
      topology: "triangle-list",
    },
  });

  const sampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
  });

  // Selection overlay pipeline
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
    pipeline,
    sampler,
    layerTextures: [],
    layerBindGroups: [],
    opacityBuffers: [],
    bindGroupLayout,
    selectionPipeline,
    selectionBindGroupLayout,
    selectionTexture: null,
    selectionBindGroup: null,
    selectionTimeBuffer,
  };
}

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

  const opacityBuffer = gpu.device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  gpu.device.queue.writeBuffer(
    opacityBuffer,
    0,
    new Float32Array([1.0]),
  );

  const bindGroup = gpu.device.createBindGroup({
    layout: gpu.bindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: gpu.sampler },
      { binding: 2, resource: { buffer: opacityBuffer } },
    ],
  });

  const index = gpu.layerTextures.length;
  gpu.layerTextures.push(texture);
  gpu.layerBindGroups.push(bindGroup);
  gpu.opacityBuffers.push(opacityBuffer);
  return index;
}

export function removeLayerTexture(
  gpu: GPUContext,
  layerIndex: number,
): void {
  const texture = gpu.layerTextures[layerIndex];
  if (texture) texture.destroy();

  const buffer = gpu.opacityBuffers[layerIndex];
  if (buffer) buffer.destroy();

  gpu.layerTextures.splice(layerIndex, 1);
  gpu.layerBindGroups.splice(layerIndex, 1);
  gpu.opacityBuffers.splice(layerIndex, 1);
}

export function uploadLayerTexture(
  gpu: GPUContext,
  layerIndex: number,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  const texture = gpu.layerTextures[layerIndex];
  if (!texture) return;

  gpu.device.queue.writeTexture(
    { texture },
    data as unknown as BufferSource,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  );
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

export function updateLayerOpacity(
  gpu: GPUContext,
  layerIndex: number,
  opacity: number,
): void {
  const buffer = gpu.opacityBuffers[layerIndex];
  if (!buffer) return;
  gpu.device.queue.writeBuffer(buffer, 0, new Float32Array([opacity]));
}
