/** Stored in brush_tips IndexedDB store — shared across presets and documents. */
export interface StoredBrushTip {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** Stored in brush_presets IndexedDB store. */
export interface BrushPreset {
  id: string;
  name: string;
  group: string;
  tip:
    | { type: "computed"; hardness: number }
    | { type: "image"; tipId: string };
  size: number;
  spacing: number;
  roundness: number;
  angle: number;
  flow?: number;
  opacity?: number;
  sort_order: number;
}

/** Default brush presets seeded on first DB upgrade. */
export const DEFAULT_PRESETS: BrushPreset[] = [
  {
    id: "default-hard-round",
    name: "Hard Round",
    group: "Default",
    tip: { type: "computed", hardness: 1.0 },
    size: 20,
    spacing: 0.15,
    roundness: 1.0,
    angle: 0,
    sort_order: 0,
  },
  {
    id: "default-soft-round",
    name: "Soft Round",
    group: "Default",
    tip: { type: "computed", hardness: 0.0 },
    size: 40,
    spacing: 0.15,
    roundness: 1.0,
    angle: 0,
    sort_order: 1,
  },
];
