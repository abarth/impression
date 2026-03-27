import { useState, useCallback, useRef, useEffect } from "react";
import type { Tool } from "./useTool";

/** Control source for a dynamic brush parameter. */
export type DynamicControl = 0 | 1 | 2 | 3 | 4; // 0=Off, 1=PenPressure, 2=Random, 3=Direction, 4=InitialDirection

export interface DynamicParam {
  jitter: number;
  control: DynamicControl;
  minimum: number;
}

export interface ShapeDynamics {
  size: DynamicParam;
  angle: DynamicParam;
  roundness: DynamicParam;
}

export interface TransferDynamics {
  opacity: DynamicParam;
  flow: DynamicParam;
}

export interface ScatterSettings {
  scatter: number;
  bothAxes: boolean;
  count: number;
  countJitter: number;
}

/** How the secondary tip alpha combines with the primary tip alpha.
 *  Matches Rust DualBrushMode repr(u8). */
export const DUAL_BRUSH_MODE_MULTIPLY = 0;
export const DUAL_BRUSH_MODE_DARKEN = 1;
export const DUAL_BRUSH_MODE_LIGHTEN = 2;
export const DUAL_BRUSH_MODE_SUBTRACT = 3;
export const DUAL_BRUSH_MODE_LINEAR_DODGE = 4;
export const DUAL_BRUSH_MODE_SCREEN = 5;

export interface DualBrushSettings {
  enabled: boolean;
  /** Combination mode (see DUAL_BRUSH_MODE_* constants). */
  mode: number;
  useComputed: boolean;
  hardness: number;
  sizeRatio: number;
  spacing: number;
  /** Randomly flip secondary tip horizontally (50% chance per stamp). */
  flip: boolean;
  count: number;
  countJitter: number;
  scatter: number;
  bothAxes: boolean;
  /** Tip ID for a sampled dual brush tip, stored in brush_tips. */
  tipId?: string;
}

export interface TextureSettings {
  enabled: boolean;
  scale: number;
  depth: number;
  textureEachTip: boolean;
  /** Tip ID for the texture pattern image, stored in brush_tips. */
  tipId?: string;
}

export type MediumType = "Oil" | "Acrylic" | "Watercolor";

export interface WetMediaSettings {
  enabled: boolean;
  paintLoad: number;
  paintThickness: number;
  wetness: number;
  mixingStrength: number;
  bristleCount: number;
  bristleSpread: number;
  paintDepletionRate: number;
  canvasTextureStrength: number;
  mediumType: MediumType;
  viscosity: number;
  bristleStiffness: number;
}

/**
 * Complete brush engine state. Combines tool options and brush preset properties.
 *
 * In Photoshop, these are managed at two levels:
 * - **Tool options** (persist across preset changes): size, opacity, flow, smoothing
 * - **Brush preset** (replaced entirely when selecting a preset): everything else
 *
 * Our `applyPreset` follows this model: tool options are preserved unless the
 * preset explicitly overrides them, while brush preset properties reset to
 * defaults before applying the preset's values.
 */
export interface BrushSettings {
  // -- Tool options (persist across preset changes) --
  size: number;
  opacity: number;
  flow: number;
  smoothing: number; // Frontend-only (not synced to Rust engine)

  // -- Brush preset properties (reset when selecting a new preset) --
  spacing: number;
  hardness: number;
  roundness: number;
  angle: number;
  flipX: boolean;
  flipY: boolean;
  shapeDynamics: ShapeDynamics;
  transferDynamics: TransferDynamics;
  scatterSettings: ScatterSettings;
  dualBrush: DualBrushSettings;
  texture: TextureSettings;
  wetMedia: WetMediaSettings;
  activeTipId: string | null;
}

/** Blend mode constants matching Rust BlendMode enum values. */
export const BLEND_MODE_NORMAL = 0;
export const BLEND_MODE_DST_OUT = 108;

/**
 * Serializable brush settings matching the Rust `SerializableBrushSettings` struct.
 * Sent as a single blob to the WASM engine at stroke start.
 */
export interface SerializableBrushSettings {
  size: number;
  spacing: number;
  color_r: number;
  color_g: number;
  color_b: number;
  opacity: number;
  flow: number;
  blend_mode: number;
  hardness: number;
  roundness: number;
  angle: number;
  shape_dynamics: ShapeDynamics;
  transfer_dynamics: TransferDynamics;
  flip_x: boolean;
  flip_y: boolean;
  scatter: {
    scatter: number;
    both_axes: boolean;
    count: number;
    count_jitter: number;
  };
  dual_brush: {
    enabled: boolean;
    mode: number;
    hardness: number;
    size_ratio: number;
    spacing: number;
    flip: boolean;
    scatter: {
      scatter: number;
      both_axes: boolean;
      count: number;
      count_jitter: number;
    };
  };
  texture: {
    enabled: boolean;
    scale: number;
    depth: number;
    texture_each_tip: boolean;
  };
  active_tip_id: string | null;
  secondary_tip_id: string | null;
  texture_tip_id: string | null;
  brush_model: "Stamp" | "WetMedia";
  wet_media: {
    paint_load: number;
    paint_thickness: number;
    wetness: number;
    mixing_strength: number;
    bristle_count: number;
    bristle_spread: number;
    paint_depletion_rate: number;
    canvas_texture_strength: number;
    medium_type: MediumType;
    viscosity: number;
    bristle_stiffness: number;
  };
}

/** Convert TS BrushSettings + color + blend mode into the format the Rust engine expects. */
export function buildSerializableSettings(
  s: BrushSettings,
  blendMode: number,
  colorR: number,
  colorG: number,
  colorB: number,
): SerializableBrushSettings {
  const db = s.dualBrush;
  return {
    size: s.size,
    spacing: s.spacing,
    color_r: colorR,
    color_g: colorG,
    color_b: colorB,
    opacity: s.opacity,
    flow: s.flow,
    blend_mode: blendMode,
    hardness: s.hardness,
    roundness: s.roundness,
    angle: s.angle,
    shape_dynamics: s.shapeDynamics,
    transfer_dynamics: s.transferDynamics,
    flip_x: s.flipX,
    flip_y: s.flipY,
    scatter: {
      scatter: s.scatterSettings.scatter,
      both_axes: s.scatterSettings.bothAxes,
      count: s.scatterSettings.count,
      count_jitter: s.scatterSettings.countJitter,
    },
    dual_brush: {
      enabled: db.enabled,
      mode: db.mode,
      hardness: db.hardness,
      size_ratio: db.sizeRatio,
      spacing: db.spacing,
      flip: db.flip,
      scatter: {
        scatter: db.scatter,
        both_axes: db.bothAxes,
        count: db.count,
        count_jitter: db.countJitter,
      },
    },
    texture: {
      enabled: s.texture.enabled,
      scale: s.texture.scale,
      depth: s.texture.depth,
      texture_each_tip: s.texture.textureEachTip,
    },
    active_tip_id: s.activeTipId,
    secondary_tip_id: (db.enabled && !db.useComputed && db.tipId) ? db.tipId : null,
    texture_tip_id: s.texture.tipId ?? null,
    brush_model: s.wetMedia.enabled ? "WetMedia" : "Stamp",
    wet_media: {
      paint_load: s.wetMedia.paintLoad,
      paint_thickness: s.wetMedia.paintThickness,
      wetness: s.wetMedia.wetness,
      mixing_strength: s.wetMedia.mixingStrength,
      bristle_count: s.wetMedia.bristleCount,
      bristle_spread: s.wetMedia.bristleSpread,
      paint_depletion_rate: s.wetMedia.paintDepletionRate,
      canvas_texture_strength: s.wetMedia.canvasTextureStrength,
      medium_type: s.wetMedia.mediumType,
      viscosity: s.wetMedia.viscosity,
      bristle_stiffness: s.wetMedia.bristleStiffness,
    },
  };
}

const DEFAULT_DYNAMIC_PARAM: DynamicParam = { jitter: 0, control: 0, minimum: 0 };

const DEFAULT_SHAPE_DYNAMICS: ShapeDynamics = {
  size: { ...DEFAULT_DYNAMIC_PARAM },
  angle: { ...DEFAULT_DYNAMIC_PARAM },
  roundness: { ...DEFAULT_DYNAMIC_PARAM },
};

const DEFAULT_TRANSFER_DYNAMICS: TransferDynamics = {
  opacity: { ...DEFAULT_DYNAMIC_PARAM },
  flow: { ...DEFAULT_DYNAMIC_PARAM },
};

const DEFAULT_SCATTER: ScatterSettings = {
  scatter: 0,
  bothAxes: false,
  count: 1,
  countJitter: 0,
};

const DEFAULT_DUAL_BRUSH: DualBrushSettings = {
  enabled: false,
  mode: DUAL_BRUSH_MODE_MULTIPLY,
  useComputed: true,
  hardness: 1.0,
  sizeRatio: 1.0,
  spacing: 0.25,
  flip: false,
  count: 1,
  countJitter: 0,
  scatter: 0,
  bothAxes: false,
};

const DEFAULT_TEXTURE: TextureSettings = {
  enabled: false,
  scale: 100,
  depth: 1.0,
  textureEachTip: false,
};

export const DEFAULT_WET_MEDIA: WetMediaSettings = {
  enabled: false,
  paintLoad: 0.8,
  paintThickness: 0.5,
  wetness: 0.7,
  mixingStrength: 0.5,
  bristleCount: 64,
  bristleSpread: 0.3,
  paintDepletionRate: 0.1,
  canvasTextureStrength: 0.3,
  mediumType: "Oil",
  viscosity: 0.7,
  bristleStiffness: 0.5,
};

/** Per-medium physics defaults used by the GPU simulation. */
export interface MediumPhysics {
  viscosity: number;
  dryingRate: number;
  diffusionRate: number;
  advectionDissipation: number;
}

const MEDIUM_PHYSICS: Record<MediumType, MediumPhysics> = {
  Oil: { viscosity: 0.85, dryingRate: 0.001, diffusionRate: 0.05, advectionDissipation: 0.99 },
  Acrylic: { viscosity: 0.5, dryingRate: 0.005, diffusionRate: 0.15, advectionDissipation: 0.97 },
  Watercolor: { viscosity: 0.2, dryingRate: 0.003, diffusionRate: 0.4, advectionDissipation: 0.95 },
};

export function getMediumPhysics(medium: MediumType): MediumPhysics {
  return MEDIUM_PHYSICS[medium];
}

/** Default values for brush preset properties (reset on preset change). */
const DEFAULT_PRESET_PROPERTIES: Omit<BrushSettings, "size" | "opacity" | "flow" | "smoothing"> = {
  spacing: 0.25,
  hardness: 1.0,
  roundness: 1.0,
  angle: 0,
  flipX: false,
  flipY: false,
  shapeDynamics: DEFAULT_SHAPE_DYNAMICS,
  transferDynamics: DEFAULT_TRANSFER_DYNAMICS,
  scatterSettings: DEFAULT_SCATTER,
  dualBrush: DEFAULT_DUAL_BRUSH,
  texture: DEFAULT_TEXTURE,
  wetMedia: DEFAULT_WET_MEDIA,
  activeTipId: null,
};

const DEFAULT_BRUSH: BrushSettings = {
  size: 20,
  opacity: 1.0,
  flow: 0.8,
  smoothing: 0,
  ...DEFAULT_PRESET_PROPERTIES,
  spacing: 0.15,
};

const DEFAULT_ERASER: BrushSettings = {
  size: 30,
  opacity: 1.0,
  flow: 1.0,
  smoothing: 0,
  ...DEFAULT_PRESET_PROPERTIES,
  spacing: 0.15,
};

/** Tools that have their own brush settings. */
export type ToolWithSettings = "brush" | "eraser";

function isToolWithSettings(tool: Tool): tool is ToolWithSettings {
  return tool === "brush" || tool === "eraser";
}

export const TOOL_BLEND_MODES: Record<ToolWithSettings, number> = {
  brush: BLEND_MODE_NORMAL,
  eraser: BLEND_MODE_DST_OUT,
};

export function useBrushSettings(_engine: Engine | null, activeTool: Tool) {
  const [perTool, setPerTool] = useState<Record<ToolWithSettings, BrushSettings>>({
    brush: DEFAULT_BRUSH,
    eraser: DEFAULT_ERASER,
  });
  const perToolRef = useRef(perTool);
  const activeToolRef = useRef(activeTool);

  // Track tool changes (no engine sync needed)
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const currentTool: ToolWithSettings = isToolWithSettings(activeTool) ? activeTool : "brush";
  const settings = perTool[currentTool];

  const updateSetting = useCallback(
    <K extends keyof BrushSettings>(key: K, value: BrushSettings[K]) => {
      const tool = isToolWithSettings(activeToolRef.current) ? activeToolRef.current : "brush";
      const prev = perToolRef.current;
      const next = { ...prev, [tool]: { ...prev[tool], [key]: value } };
      perToolRef.current = next;
      setPerTool(next);
    },
    [],
  );

  // Keyboard shortcuts: [ to decrease size, ] to increase size
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const tool = isToolWithSettings(activeToolRef.current)
          ? activeToolRef.current
          : "brush";
        const prev = perToolRef.current;
        const current = prev[tool].size;
        const step = current >= 20 ? Math.round(current * 0.1) : 1;
        const newSize =
          e.key === "["
            ? Math.max(1, current - step)
            : Math.min(100, current + step);
        if (newSize !== current) {
          const next = { ...prev, [tool]: { ...prev[tool], size: newSize } };
          perToolRef.current = next;
          setPerTool(next);
        }
      }

      // Number keys: set opacity (1=10%, 2=20%, ..., 9=90%, 0=100%)
      // Shift+number: set flow instead
      const digit = e.key >= "0" && e.key <= "9" ? parseInt(e.key) : -1;
      if (digit >= 0 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const value = digit === 0 ? 1.0 : digit * 0.1;
        const setting = e.shiftKey ? "flow" : "opacity";
        const tool = isToolWithSettings(activeToolRef.current)
          ? activeToolRef.current
          : "brush";
        const prev = perToolRef.current;
        const next = { ...prev, [tool]: { ...prev[tool], [setting]: value } };
        perToolRef.current = next;
        setPerTool(next);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /** Apply a brush preset. Follows Photoshop semantics:
   *  - Tool options (size, opacity, flow, smoothing) are preserved unless
   *    the preset explicitly overrides them
   *  - Brush preset properties (spacing, hardness, dynamics, etc.) reset to
   *    defaults, then the preset's values are applied on top */
  const applyPreset = useCallback(
    (partial: Partial<BrushSettings>) => {
      const tool = isToolWithSettings(activeToolRef.current) ? activeToolRef.current : "brush";
      const prev = perToolRef.current;
      const prevSettings = prev[tool];
      const merged: BrushSettings = {
        // Preserve current tool options
        size: prevSettings.size,
        opacity: prevSettings.opacity,
        flow: prevSettings.flow,
        smoothing: prevSettings.smoothing,
        // Reset brush preset properties to defaults
        ...DEFAULT_PRESET_PROPERTIES,
        // Apply preset overrides (may include tool options like size for ABR imports)
        ...partial,
      };
      const next = { ...prev, [tool]: merged };
      perToolRef.current = next;
      setPerTool(next);
    },
    [],
  );

  /** Get a ref to current settings + tool for use at stroke start. */
  const getSettingsRef = useCallback(() => {
    const tool = isToolWithSettings(activeToolRef.current) ? activeToolRef.current : "brush";
    return { settings: perToolRef.current[tool], tool };
  }, []);

  return { settings, updateSetting, applyPreset, toolLabel: currentTool, getSettingsRef };
}

// Re-export Engine type for consumers (avoids circular import in some cases)
import type { Engine } from "../engine";
