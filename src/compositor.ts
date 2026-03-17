import type { GPUContext } from "./gpu";

export interface CompositeOptions {
  backgroundColor: [number, number, number];
  layerCount: number;
  getLayerVisible?: (index: number) => boolean;
  getLayerBlendMode?: (index: number) => number;
  time?: number;
}

export function composite(gpu: GPUContext, options: CompositeOptions): void {
  const { backgroundColor, layerCount } = options;
  const getVisible = options.getLayerVisible ?? (() => true);
  const getBlendMode = options.getLayerBlendMode ?? (() => 0);

  const encoder = gpu.device.createCommandEncoder();
  const textureView = gpu.context.getCurrentTexture().createView();

  const bg = backgroundColor;
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        clearValue: {
          r: bg[0] / 255,
          g: bg[1] / 255,
          b: bg[2] / 255,
          a: 1.0,
        },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  for (let i = 0; i < layerCount; i++) {
    if (!getVisible(i)) continue;
    if (i >= gpu.layerBindGroups.length) continue;

    const mode = getBlendMode(i);
    const pipeline = gpu.blendPipelines[mode] ?? gpu.blendPipelines[0];
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, gpu.layerBindGroups[i]);
    renderPass.draw(3, 1, 0, 0); // fullscreen triangle
  }

  // Selection marching ants overlay
  if (gpu.selectionBindGroup) {
    const t = (options.time ?? 0) / 1000; // convert ms to seconds
    gpu.device.queue.writeBuffer(
      gpu.selectionTimeBuffer,
      0,
      new Float32Array([t]),
    );
    renderPass.setPipeline(gpu.selectionPipeline);
    renderPass.setBindGroup(0, gpu.selectionBindGroup);
    renderPass.draw(3, 1, 0, 0);
  }

  renderPass.end();
  gpu.device.queue.submit([encoder.finish()]);
}
