/**
 * Mixbox LUT loader for WebGPU pigment mixing.
 *
 * Loads the 512x512 Mixbox LUT PNG and creates a GPUTexture + sampler
 * for use by the deposit and diffuse shaders.
 */

export interface MixboxResources {
  lutTexture: GPUTexture;
  lutSampler: GPUSampler;
}

/** Load the Mixbox LUT PNG from the public directory and create GPU resources. */
export async function initMixbox(device: GPUDevice): Promise<MixboxResources> {
  const base = import.meta.env.BASE_URL ?? "/";
  const url = `${base}mixbox_lut.png`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Mixbox LUT: ${response.status} ${response.statusText} (${url})`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });

  const lutTexture = device.createTexture({
    size: { width: bitmap.width, height: bitmap.height },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture: lutTexture },
    { width: bitmap.width, height: bitmap.height },
  );

  const lutSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  return { lutTexture, lutSampler };
}
