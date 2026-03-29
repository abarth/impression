/** Stored in brush_tips IndexedDB store — shared across presets and documents. */
export interface StoredBrushTip {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
}

import type { ShapeDynamics, TransferDynamics, ScatterSettings, DualBrushSettings, TextureSettings, WetMediaSettings } from "./hooks/useBrushSettings";

/** Pen-pressure size dynamics shared by all wet media presets. */
const WET_MEDIA_SHAPE_DYNAMICS: ShapeDynamics = {
  size: { jitter: 0, control: 1, minimum: 0.2 },
  angle: { jitter: 0, control: 0, minimum: 0 },
  roundness: { jitter: 0, control: 0, minimum: 0 },
};

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
  shapeDynamics?: ShapeDynamics;
  transferDynamics?: TransferDynamics;
  scatterSettings?: ScatterSettings;
  dualBrush?: DualBrushSettings;
  texture?: TextureSettings;
  flipX?: boolean;
  flipY?: boolean;
  smoothing?: number;
  wetMedia?: WetMediaSettings;
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
  // -- Oil presets --
  {
    id: "wet-oil-round",
    name: "Oil Round",
    group: "Oil",
    tip: { type: "computed", hardness: 0.6 },
    size: 24,
    spacing: 0.04,
    roundness: 1.0,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.8, paintThickness: 0.6, wetness: 0.7,
      mixingStrength: 0.6, bristleCount: 256, bristleSpread: 0.2,
      paintDepletionRate: 0.08, canvasTextureStrength: 0.25,
      mediumType: "Oil", viscosity: 0.8, bristleStiffness: 0.5,
      brushForm: 0.5, colorNoise: 0.12, speedSmudging: 0.3,
      brushShape: "Round", splittingThreshold: 0.3,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 10,
  },
  {
    id: "wet-oil-flat",
    name: "Oil Flat",
    group: "Oil",
    tip: { type: "computed", hardness: 0.8 },
    size: 30,
    spacing: 0.04,
    roundness: 0.35,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.9, paintThickness: 0.7, wetness: 0.6,
      mixingStrength: 0.5, bristleCount: 384, bristleSpread: 0.12,
      paintDepletionRate: 0.06, canvasTextureStrength: 0.3,
      mediumType: "Oil", viscosity: 0.85, bristleStiffness: 0.6,
      brushForm: 0.3, colorNoise: 0.15, speedSmudging: 0.25,
      brushShape: "Flat", splittingThreshold: 0.25,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 11,
  },
  {
    id: "wet-oil-filbert",
    name: "Oil Filbert",
    group: "Oil",
    tip: { type: "computed", hardness: 0.7 },
    size: 28,
    spacing: 0.04,
    roundness: 0.6,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.85, paintThickness: 0.65, wetness: 0.65,
      mixingStrength: 0.55, bristleCount: 320, bristleSpread: 0.18,
      paintDepletionRate: 0.07, canvasTextureStrength: 0.25,
      mediumType: "Oil", viscosity: 0.8, bristleStiffness: 0.5,
      brushForm: 0.45, colorNoise: 0.12, speedSmudging: 0.3,
      brushShape: "Filbert", splittingThreshold: 0.28,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 12,
  },
  {
    id: "wet-oil-fan",
    name: "Oil Fan",
    group: "Oil",
    tip: { type: "computed", hardness: 0.5 },
    size: 40,
    spacing: 0.05,
    roundness: 0.3,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.4, paintThickness: 0.3, wetness: 0.5,
      mixingStrength: 0.7, bristleCount: 128, bristleSpread: 0.5,
      paintDepletionRate: 0.15, canvasTextureStrength: 0.2,
      mediumType: "Oil", viscosity: 0.7, bristleStiffness: 0.3,
      brushForm: 0.8, colorNoise: 0.08, speedSmudging: 0.5,
      brushShape: "Fan", splittingThreshold: 0.4,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 13,
  },
  {
    id: "wet-oil-impasto",
    name: "Oil Impasto",
    group: "Oil",
    tip: { type: "computed", hardness: 0.9 },
    size: 20,
    spacing: 0.04,
    roundness: 0.85,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 1.0, paintThickness: 1.0, wetness: 0.4,
      mixingStrength: 0.25, bristleCount: 192, bristleSpread: 0.08,
      paintDepletionRate: 0.04, canvasTextureStrength: 0.2,
      mediumType: "Oil", viscosity: 0.95, bristleStiffness: 0.75,
      brushForm: 0.4, colorNoise: 0.1, speedSmudging: 0.15,
      brushShape: "Round", splittingThreshold: 0.15,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 14,
  },
  {
    id: "wet-oil-glaze",
    name: "Oil Glaze",
    group: "Oil",
    tip: { type: "computed", hardness: 0.25 },
    size: 35,
    spacing: 0.03,
    roundness: 1.0,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.15, paintThickness: 0.05, wetness: 0.3,
      mixingStrength: 0.85, bristleCount: 192, bristleSpread: 0.1,
      paintDepletionRate: 0.2, canvasTextureStrength: 0.15,
      mediumType: "Oil", viscosity: 0.6, bristleStiffness: 0.35,
      brushForm: 0.5, colorNoise: 0.05, speedSmudging: 0.4,
      brushShape: "Round", splittingThreshold: 0.5,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 15,
  },
  {
    id: "wet-oil-dry-brush",
    name: "Oil Dry Brush",
    group: "Oil",
    tip: { type: "computed", hardness: 0.85 },
    size: 35,
    spacing: 0.05,
    roundness: 0.55,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.25, paintThickness: 0.15, wetness: 0.1,
      mixingStrength: 0.15, bristleCount: 256, bristleSpread: 0.55,
      paintDepletionRate: 0.3, canvasTextureStrength: 0.55,
      mediumType: "Oil", viscosity: 0.85, bristleStiffness: 0.3,
      brushForm: 0.7, colorNoise: 0.2, speedSmudging: 0.5,
      brushShape: "Flat", splittingThreshold: 0.5,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 16,
  },
  {
    id: "wet-oil-detail",
    name: "Oil Detail",
    group: "Oil",
    tip: { type: "computed", hardness: 0.75 },
    size: 8,
    spacing: 0.04,
    roundness: 1.0,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.6, paintThickness: 0.4, wetness: 0.5,
      mixingStrength: 0.3, bristleCount: 128, bristleSpread: 0.08,
      paintDepletionRate: 0.12, canvasTextureStrength: 0.15,
      mediumType: "Oil", viscosity: 0.75, bristleStiffness: 0.65,
      brushForm: 0.3, colorNoise: 0.08, speedSmudging: 0.2,
      brushShape: "Round", splittingThreshold: 0.35,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 17,
  },
  {
    id: "wet-palette-knife",
    name: "Palette Knife",
    group: "Oil",
    tip: { type: "computed", hardness: 1.0 },
    size: 40,
    spacing: 0.04,
    roundness: 0.15,
    angle: 30,
    wetMedia: {
      enabled: true, paintLoad: 0.05, paintThickness: 0.2, wetness: 0.95,
      mixingStrength: 0.95, bristleCount: 4, bristleSpread: 0.0,
      paintDepletionRate: 0.01, canvasTextureStrength: 0.05,
      mediumType: "Oil", viscosity: 0.3, bristleStiffness: 1.0,
      brushForm: 0.0, colorNoise: 0.0, speedSmudging: 0.8,
      brushShape: "Flat", splittingThreshold: 1.0,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 18,
  },
  // -- Acrylic presets --
  {
    id: "wet-acrylic-round",
    name: "Acrylic Round",
    group: "Acrylic",
    tip: { type: "computed", hardness: 0.55 },
    size: 22,
    spacing: 0.04,
    roundness: 1.0,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.75, paintThickness: 0.45, wetness: 0.55,
      mixingStrength: 0.55, bristleCount: 256, bristleSpread: 0.2,
      paintDepletionRate: 0.1, canvasTextureStrength: 0.3,
      mediumType: "Acrylic", viscosity: 0.5, bristleStiffness: 0.5,
      brushForm: 0.5, colorNoise: 0.1, speedSmudging: 0.3,
      brushShape: "Round", splittingThreshold: 0.3,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 20,
  },
  {
    id: "wet-acrylic-flat",
    name: "Acrylic Flat",
    group: "Acrylic",
    tip: { type: "computed", hardness: 0.7 },
    size: 28,
    spacing: 0.04,
    roundness: 0.4,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.8, paintThickness: 0.5, wetness: 0.5,
      mixingStrength: 0.5, bristleCount: 320, bristleSpread: 0.18,
      paintDepletionRate: 0.1, canvasTextureStrength: 0.3,
      mediumType: "Acrylic", viscosity: 0.55, bristleStiffness: 0.55,
      brushForm: 0.35, colorNoise: 0.1, speedSmudging: 0.3,
      brushShape: "Flat", splittingThreshold: 0.3,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 21,
  },
  {
    id: "wet-acrylic-heavy-body",
    name: "Acrylic Heavy Body",
    group: "Acrylic",
    tip: { type: "computed", hardness: 0.85 },
    size: 22,
    spacing: 0.04,
    roundness: 0.75,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.95, paintThickness: 0.8, wetness: 0.35,
      mixingStrength: 0.3, bristleCount: 256, bristleSpread: 0.15,
      paintDepletionRate: 0.06, canvasTextureStrength: 0.25,
      mediumType: "Acrylic", viscosity: 0.85, bristleStiffness: 0.65,
      brushForm: 0.4, colorNoise: 0.1, speedSmudging: 0.2,
      brushShape: "Round", splittingThreshold: 0.2,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 22,
  },
  {
    id: "wet-acrylic-fluid",
    name: "Acrylic Fluid",
    group: "Acrylic",
    tip: { type: "computed", hardness: 0.35 },
    size: 30,
    spacing: 0.04,
    roundness: 1.0,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.5, paintThickness: 0.2, wetness: 0.8,
      mixingStrength: 0.75, bristleCount: 192, bristleSpread: 0.15,
      paintDepletionRate: 0.15, canvasTextureStrength: 0.35,
      mediumType: "Acrylic", viscosity: 0.2, bristleStiffness: 0.35,
      brushForm: 0.5, colorNoise: 0.08, speedSmudging: 0.4,
      brushShape: "Round", splittingThreshold: 0.4,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 23,
  },
  {
    id: "wet-acrylic-dry-brush",
    name: "Acrylic Dry Brush",
    group: "Acrylic",
    tip: { type: "computed", hardness: 0.8 },
    size: 32,
    spacing: 0.05,
    roundness: 0.5,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.2, paintThickness: 0.1, wetness: 0.08,
      mixingStrength: 0.1, bristleCount: 192, bristleSpread: 0.5,
      paintDepletionRate: 0.35, canvasTextureStrength: 0.5,
      mediumType: "Acrylic", viscosity: 0.5, bristleStiffness: 0.3,
      brushForm: 0.7, colorNoise: 0.18, speedSmudging: 0.5,
      brushShape: "Flat", splittingThreshold: 0.45,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 24,
  },
  {
    id: "wet-acrylic-blending",
    name: "Acrylic Blending",
    group: "Acrylic",
    tip: { type: "computed", hardness: 0.2 },
    size: 30,
    spacing: 0.04,
    roundness: 1.0,
    angle: 0,
    wetMedia: {
      enabled: true, paintLoad: 0.0, paintThickness: 0.0, wetness: 0.9,
      mixingStrength: 0.95, bristleCount: 256, bristleSpread: 0.12,
      paintDepletionRate: 0.0, canvasTextureStrength: 0.1,
      mediumType: "Acrylic", viscosity: 0.3, bristleStiffness: 0.25,
      brushForm: 0.5, colorNoise: 0.0, speedSmudging: 0.6,
      brushShape: "Round", splittingThreshold: 1.0,
    },
    shapeDynamics: WET_MEDIA_SHAPE_DYNAMICS,
    sort_order: 25,
  },
];
