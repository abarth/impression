import type { GPUContext } from "./gpu";
import { getWetMediaLayer, dispatchShadowPass } from "./gpu";

/** Layer kind constants matching Rust layer_kind() return values */
export const LAYER_KIND_RASTER = 0;
export const LAYER_KIND_GRADIENT_MAP = 1;
export const LAYER_KIND_WET_MEDIA = 2;

export interface CompositeOptions {
  backgroundColor: [number, number, number];
  canvasVisible?: boolean;
  layerCount: number;
  getLayerVisible?: (index: number) => boolean;
  getLayerBlendMode?: (index: number) => number;
  getLayerKind?: (index: number) => number;
  time?: number;
}

export function composite(gpu: GPUContext, options: CompositeOptions): void {
  const { backgroundColor, layerCount } = options;
  const getVisible = options.getLayerVisible ?? (() => true);
  const getKind = options.getLayerKind ?? (() => LAYER_KIND_RASTER);

  const encoder = gpu.device.createCommandEncoder();
  const bg = backgroundColor;

  // Step 1: Clear accumTextures[0] with background color (or transparent if hidden)
  const showCanvas = options.canvasVisible !== false;
  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpu.accumViews[0],
          clearValue: showCanvas
            ? { r: bg[0] / 255, g: bg[1] / 255, b: bg[2] / 255, a: 1.0 }
            : { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
  }

  // Step 2: Composite each visible layer (ping-pong between accum textures)
  let currentDst = 0; // accumTextures[0] currently holds the result
  for (let i = 0; i < layerCount; i++) {
    if (!getVisible(i)) continue;
    if (i >= gpu.layerBindGroups.length) continue;

    const srcIdx = currentDst; // read from current result
    const dstIdx = 1 - srcIdx; // write to the other

    // Run HBAO shadow compute pass before the composite render pass
    const kind = getKind(i);
    if (kind === LAYER_KIND_WET_MEDIA) {
      const wm = getWetMediaLayer(i);
      if (wm && wm.hasWetPaint) {
        dispatchShadowPass(gpu, encoder, wm);
      }
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpu.accumViews[dstIdx],
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });

    if (kind === LAYER_KIND_WET_MEDIA) {
      const wm = getWetMediaLayer(i);
      if (wm) {
        pass.setPipeline(gpu.wetMediaPipeline);
        pass.setBindGroup(0, wm.bindGroup);
        pass.setBindGroup(1, gpu.dstBindGroups[srcIdx]);
        pass.draw(3, 1, 0, 0);
      }
    } else if (kind === LAYER_KIND_GRADIENT_MAP) {
      pass.setPipeline(gpu.gradientMapPipeline);
      pass.setBindGroup(0, gpu.layerBindGroups[i]);
      pass.setBindGroup(1, gpu.dstBindGroups[srcIdx]);
      pass.draw(3, 1, 0, 0);
    } else {
      pass.setPipeline(gpu.compositePipeline);
      pass.setBindGroup(0, gpu.layerBindGroups[i]);
      pass.setBindGroup(1, gpu.dstBindGroups[srcIdx]);
      pass.draw(3, 1, 0, 0);
    }
    pass.end();

    currentDst = dstIdx;
  }

  // Step 3: Blit final result to canvas + selection overlay
  const canvasView = gpu.context.getCurrentTexture().createView();
  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasView,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });

    // Blit accumulated result
    pass.setPipeline(gpu.blitPipeline);
    pass.setBindGroup(0, gpu.blitBindGroups[currentDst]);
    pass.draw(3, 1, 0, 0);

    // Selection marching ants overlay
    if (gpu.selectionBindGroup) {
      const t = (options.time ?? 0) / 1000;
      gpu.device.queue.writeBuffer(
        gpu.selectionTimeBuffer,
        0,
        new Float32Array([t]),
      );
      pass.setPipeline(gpu.selectionPipeline);
      pass.setBindGroup(0, gpu.selectionBindGroup);
      pass.draw(3, 1, 0, 0);
    }

    pass.end();
  }

  gpu.device.queue.submit([encoder.finish()]);
}
