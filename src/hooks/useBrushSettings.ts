import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";
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
}

/** Blend mode constants matching Rust BlendMode enum values. */
export const BLEND_MODE_NORMAL = 0;
export const BLEND_MODE_DST_OUT = 108;

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
type ToolWithSettings = "brush" | "eraser";

function isToolWithSettings(tool: Tool): tool is ToolWithSettings {
  return tool === "brush" || tool === "eraser";
}

const TOOL_BLEND_MODES: Record<ToolWithSettings, number> = {
  brush: BLEND_MODE_NORMAL,
  eraser: BLEND_MODE_DST_OUT,
};

export function useBrushSettings(engine: Engine | null, activeTool: Tool) {
  const [perTool, setPerTool] = useState<Record<ToolWithSettings, BrushSettings>>({
    brush: DEFAULT_BRUSH,
    eraser: DEFAULT_ERASER,
  });
  const perToolRef = useRef(perTool);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const activeToolRef = useRef(activeTool);

  /** Push all brush settings to the Rust engine. Resets to defaults first
   *  to ensure no stale state leaks between brush presets. */
  const syncToEngine = useCallback((s: BrushSettings, tool: ToolWithSettings, reset = false) => {
    const eng = engineRef.current;
    if (!eng) return;

    // Only reset when applying a full preset so stale settings don't leak.
    // Individual setting changes must NOT reset because resetBrush clears
    // the active brush tip on the engine side, causing sampled tips to be
    // lost (the tip is managed by useBrushPresets, not re-applied here).
    if (reset) {
      eng.resetBrush();
    }

    // Tool options
    eng.setBrushSize(s.size);
    eng.setBrushOpacity(s.opacity);
    eng.setBrushFlow(s.flow);
    eng.setBrushBlendMode(TOOL_BLEND_MODES[tool]);

    // Brush preset properties
    eng.setBrushSpacing(s.spacing);
    eng.setBrushHardness(s.hardness);
    eng.setBrushRoundness(s.roundness);
    eng.setBrushAngle(s.angle);
    eng.setBrushFlipX(s.flipX);
    eng.setBrushFlipY(s.flipY);
    const sd = s.shapeDynamics;
    eng.setShapeDynamics(
      sd.size.jitter, sd.size.control, sd.size.minimum,
      sd.angle.jitter, sd.angle.control,
      sd.roundness.jitter, sd.roundness.control, sd.roundness.minimum,
    );
    const td = s.transferDynamics;
    eng.setTransferDynamics(
      td.opacity.jitter, td.opacity.control, td.opacity.minimum,
      td.flow.jitter, td.flow.control, td.flow.minimum,
    );
    const sc = s.scatterSettings;
    eng.setScatter(sc.scatter, sc.bothAxes, sc.count, sc.countJitter);
    const db = s.dualBrush;
    eng.setDualBrush(
      db.enabled, db.mode, db.hardness,
      db.sizeRatio,
      db.spacing, db.count, db.countJitter, db.scatter, db.bothAxes
    );
    // Sync secondary tip: useComputed is resolved here so the Rust engine
    // simply checks whether a secondary tip is registered.
    if (db.enabled && !db.useComputed && db.tipId) {
      eng.setSecondaryBrushTip(db.tipId);
    } else {
      eng.clearSecondaryBrushTip();
    }
    const tx = s.texture;
    eng.setTexture(tx.enabled, tx.scale, tx.depth, tx.textureEachTip);
  }, []);

  // Sync when engine becomes available
  useEffect(() => {
    if (engine && isToolWithSettings(activeTool)) {
      syncToEngine(perTool[activeTool], activeTool);
    }
  }, [engine]);

  // Sync when active tool changes
  useEffect(() => {
    if (activeToolRef.current !== activeTool) {
      activeToolRef.current = activeTool;
      if (engine && isToolWithSettings(activeTool)) {
        syncToEngine(perTool[activeTool], activeTool);
      }
    }
  }, [activeTool, engine, perTool, syncToEngine]);

  const currentTool: ToolWithSettings = isToolWithSettings(activeTool) ? activeTool : "brush";
  const settings = perTool[currentTool];

  const updateSetting = useCallback(
    <K extends keyof BrushSettings>(key: K, value: BrushSettings[K]) => {
      const tool = isToolWithSettings(activeToolRef.current) ? activeToolRef.current : "brush";
      const prev = perToolRef.current;
      const next = { ...prev, [tool]: { ...prev[tool], [key]: value } };
      perToolRef.current = next;
      setPerTool(next);
      syncToEngine(next[tool], tool);
    },
    [syncToEngine],
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
          syncToEngine(next[tool], tool);
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
        syncToEngine(next[tool], tool);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [syncToEngine]);

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
      syncToEngine(next[tool], tool, true);
    },
    [syncToEngine],
  );

  return { settings, updateSetting, applyPreset, toolLabel: currentTool };
}
