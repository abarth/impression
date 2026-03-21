import { describe, it, expect, vi } from "vitest";
import { composite } from "../compositor";
import type { GPUContext } from "../gpu";

function createMockGPUContext(layerCount: number): GPUContext {
  const bindGroups = Array.from({ length: layerCount }, () => ({}));
  const mockRenderPass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const mockEncoder = {
    beginRenderPass: vi.fn().mockReturnValue(mockRenderPass),
    finish: vi.fn().mockReturnValue({}),
  };

  return {
    device: {
      createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
      queue: { submit: vi.fn(), writeBuffer: vi.fn() },
    },
    context: {
      getCurrentTexture: vi.fn().mockReturnValue({
        createView: vi.fn().mockReturnValue({}),
      }),
    },
    compositePipeline: {},
    gradientMapPipeline: {},
    blitPipeline: {},
    layerBindGroups: bindGroups,
    accumViews: [{}, {}],
    dstBindGroups: [{}, {}],
    blitBindGroups: [{}, {}],
    selectionBindGroup: null,
    selectionTimeBuffer: {},
  } as unknown as GPUContext;
}

describe("composite", () => {
  it("should create a render pass with background color", () => {
    const gpu = createMockGPUContext(1);
    composite(gpu, {
      backgroundColor: [128, 64, 32],
      layerCount: 1,
    });

    expect(
      (gpu.device as any).createCommandEncoder,
    ).toHaveBeenCalled();
  });

  it("should draw each visible layer", () => {
    const gpu = createMockGPUContext(3);
    composite(gpu, {
      backgroundColor: [255, 255, 255],
      layerCount: 3,
    });

    expect(
      (gpu.device as any).createCommandEncoder,
    ).toHaveBeenCalled();
    expect((gpu.device as any).queue.submit).toHaveBeenCalled();
  });

  it("should skip invisible layers", () => {
    const gpu = createMockGPUContext(3);
    composite(gpu, {
      backgroundColor: [255, 255, 255],
      layerCount: 3,
      getLayerVisible: (i: number) => i !== 1,
    });

    expect(
      (gpu.device as any).createCommandEncoder,
    ).toHaveBeenCalled();
  });
});
