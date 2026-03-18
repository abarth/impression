/** Photoshop-compatible blend modes (separable), grouped by category. */
export const BLEND_MODES = [
  { value: 0, label: "Normal", group: "Normal" },
  // Darken group
  { value: 1, label: "Darken", group: "Darken" },
  { value: 2, label: "Multiply", group: "Darken" },
  { value: 3, label: "Color Burn", group: "Darken" },
  { value: 4, label: "Linear Burn", group: "Darken" },
  // Lighten group
  { value: 5, label: "Lighten", group: "Lighten" },
  { value: 6, label: "Screen", group: "Lighten" },
  { value: 7, label: "Color Dodge", group: "Lighten" },
  { value: 8, label: "Linear Dodge (Add)", group: "Lighten" },
  // Contrast group
  { value: 9, label: "Overlay", group: "Contrast" },
  { value: 10, label: "Soft Light", group: "Contrast" },
  { value: 11, label: "Hard Light", group: "Contrast" },
  { value: 12, label: "Vivid Light", group: "Contrast" },
  { value: 13, label: "Linear Light", group: "Contrast" },
  { value: 14, label: "Pin Light", group: "Contrast" },
  { value: 15, label: "Hard Mix", group: "Contrast" },
  // Inversion group
  { value: 16, label: "Difference", group: "Inversion" },
  { value: 17, label: "Exclusion", group: "Inversion" },
  { value: 18, label: "Subtract", group: "Inversion" },
  { value: 19, label: "Divide", group: "Inversion" },
] as const;

export type BlendModeValue = (typeof BLEND_MODES)[number]["value"];

export const BLEND_MODE_COUNT = BLEND_MODES.length;

/** Blend modes grouped by category, preserving order. */
export const BLEND_MODE_GROUPS: { group: string; modes: typeof BLEND_MODES[number][] }[] = (() => {
  const groups: { group: string; modes: typeof BLEND_MODES[number][] }[] = [];
  for (const mode of BLEND_MODES) {
    const last = groups[groups.length - 1];
    if (last && last.group === mode.group) {
      last.modes.push(mode);
    } else {
      groups.push({ group: mode.group, modes: [mode] });
    }
  }
  return groups;
})();
