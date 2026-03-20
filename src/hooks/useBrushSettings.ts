import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";
import type { Tool } from "./useTool";

/** Control source for a dynamic brush parameter. */
export type DynamicControl = 0 | 1 | 2; // 0=Off, 1=PenPressure, 2=Random

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

export interface DualBrushSettings {
  enabled: boolean;
  useComputed: boolean;
  hardness: number;
  size: number;
  spacing: number;
}

export interface TextureSettings {
  enabled: boolean;
  scale: number;
  depth: number;
  textureEachTip: boolean;
}

export interface BrushSettings {
  size: number;
  spacing: number;
  flow: number;
  opacity: number;
  hardness: number;
  roundness: number;
  angle: number;
  smoothing: number;
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
  useComputed: true,
  hardness: 1.0,
  size: 20,
  spacing: 0.25,
};

const DEFAULT_TEXTURE: TextureSettings = {
  enabled: false,
  scale: 100,
  depth: 1.0,
  textureEachTip: false,
};

const DEFAULT_BRUSH: BrushSettings = {
  size: 20,
  spacing: 0.15,
  flow: 0.8,
  opacity: 1.0,
  hardness: 1.0,
  roundness: 1.0,
  angle: 0,
  smoothing: 0,
  flipX: false,
  flipY: false,
  shapeDynamics: DEFAULT_SHAPE_DYNAMICS,
  transferDynamics: DEFAULT_TRANSFER_DYNAMICS,
  scatterSettings: DEFAULT_SCATTER,
  dualBrush: DEFAULT_DUAL_BRUSH,
  texture: DEFAULT_TEXTURE,
};

const DEFAULT_ERASER: BrushSettings = {
  size: 30,
  spacing: 0.15,
  flow: 1.0,
  opacity: 1.0,
  hardness: 1.0,
  roundness: 1.0,
  angle: 0,
  smoothing: 0,
  flipX: false,
  flipY: false,
  shapeDynamics: DEFAULT_SHAPE_DYNAMICS,
  transferDynamics: DEFAULT_TRANSFER_DYNAMICS,
  scatterSettings: DEFAULT_SCATTER,
  dualBrush: DEFAULT_DUAL_BRUSH,
  texture: DEFAULT_TEXTURE,
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

  const syncToEngine = useCallback((s: BrushSettings, tool: ToolWithSettings) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setBrushSize(s.size);
    eng.setBrushSpacing(s.spacing);
    eng.setBrushFlow(s.flow);
    eng.setBrushOpacity(s.opacity);
    eng.setBrushHardness(s.hardness);
    eng.setBrushRoundness(s.roundness);
    eng.setBrushAngle(s.angle);
    eng.setBrushFlipX(s.flipX);
    eng.setBrushFlipY(s.flipY);
    eng.setBrushBlendMode(TOOL_BLEND_MODES[tool]);
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
    eng.setDualBrush(db.enabled, db.useComputed, db.hardness, db.size, db.spacing);
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

  const applyPreset = useCallback(
    (partial: Partial<BrushSettings>) => {
      const tool = isToolWithSettings(activeToolRef.current) ? activeToolRef.current : "brush";
      const prev = perToolRef.current;
      const next = { ...prev, [tool]: { ...prev[tool], ...partial } };
      perToolRef.current = next;
      setPerTool(next);
      syncToEngine(next[tool], tool);
    },
    [syncToEngine],
  );

  return { settings, updateSetting, applyPreset, toolLabel: currentTool };
}
