/** Porter-Duff compositing operators with Photoshop-consistent naming. */
export const BLEND_MODES = [
  { value: 0, label: "Normal" },
  { value: 1, label: "Destination Over" },
  { value: 2, label: "Source In" },
  { value: 3, label: "Destination In" },
  { value: 4, label: "Source Out" },
  { value: 5, label: "Destination Out" },
  { value: 6, label: "Source Atop" },
  { value: 7, label: "Destination Atop" },
  { value: 8, label: "XOR" },
  { value: 9, label: "Lighter" },
  { value: 10, label: "Copy" },
] as const;

export type BlendModeValue = (typeof BLEND_MODES)[number]["value"];

export const BLEND_MODE_COUNT = BLEND_MODES.length;

/**
 * WebGPU blend state for each Porter-Duff operator.
 * All assume premultiplied alpha output from the shader.
 */
export function getBlendState(mode: number): GPUBlendState {
  switch (mode) {
    case 0: // Normal (Source Over)
      return {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
    case 1: // Destination Over
      return {
        color: { srcFactor: "one-minus-dst-alpha", dstFactor: "one", operation: "add" },
        alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "one", operation: "add" },
      };
    case 2: // Source In
      return {
        color: { srcFactor: "dst-alpha", dstFactor: "zero", operation: "add" },
        alpha: { srcFactor: "dst-alpha", dstFactor: "zero", operation: "add" },
      };
    case 3: // Destination In
      return {
        color: { srcFactor: "zero", dstFactor: "src-alpha", operation: "add" },
        alpha: { srcFactor: "zero", dstFactor: "src-alpha", operation: "add" },
      };
    case 4: // Source Out
      return {
        color: { srcFactor: "one-minus-dst-alpha", dstFactor: "zero", operation: "add" },
        alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "zero", operation: "add" },
      };
    case 5: // Destination Out
      return {
        color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
    case 6: // Source Atop
      return {
        color: { srcFactor: "dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
    case 7: // Destination Atop
      return {
        color: { srcFactor: "one-minus-dst-alpha", dstFactor: "src-alpha", operation: "add" },
        alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "src-alpha", operation: "add" },
      };
    case 8: // XOR
      return {
        color: { srcFactor: "one-minus-dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one-minus-dst-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
    case 9: // Lighter (Add)
      return {
        color: { srcFactor: "one", dstFactor: "one", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
      };
    case 10: // Copy
      return {
        color: { srcFactor: "one", dstFactor: "zero", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "zero", operation: "add" },
      };
    default: // Fall back to Normal
      return {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
  }
}
