/** Photoshop-compatible blend modes (separable). */
export const BLEND_MODES = [
  { value: 0, label: "Normal" },
  // Darken group
  { value: 1, label: "Darken" },
  { value: 2, label: "Multiply" },
  { value: 3, label: "Color Burn" },
  { value: 4, label: "Linear Burn" },
  // Lighten group
  { value: 5, label: "Lighten" },
  { value: 6, label: "Screen" },
  { value: 7, label: "Color Dodge" },
  { value: 8, label: "Linear Dodge (Add)" },
  // Contrast group
  { value: 9, label: "Overlay" },
  { value: 10, label: "Soft Light" },
  { value: 11, label: "Hard Light" },
  { value: 12, label: "Vivid Light" },
  { value: 13, label: "Linear Light" },
  { value: 14, label: "Pin Light" },
  { value: 15, label: "Hard Mix" },
  // Inversion group
  { value: 16, label: "Difference" },
  { value: 17, label: "Exclusion" },
  { value: 18, label: "Subtract" },
  { value: 19, label: "Divide" },
] as const;

export type BlendModeValue = (typeof BLEND_MODES)[number]["value"];

export const BLEND_MODE_COUNT = BLEND_MODES.length;
