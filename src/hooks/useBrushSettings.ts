import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";
import type { Tool } from "./useTool";

export interface BrushSettings {
  size: number;
  spacing: number;
  flow: number;
  opacity: number;
  hardness: number;
  roundness: number;
  angle: number;
}

/** Blend mode constants matching Rust BlendMode enum values. */
export const BLEND_MODE_NORMAL = 0;
export const BLEND_MODE_DST_OUT = 108;

const DEFAULT_BRUSH: BrushSettings = {
  size: 20,
  spacing: 0.15,
  flow: 0.8,
  opacity: 1.0,
  hardness: 1.0,
  roundness: 1.0,
  angle: 0,
};

const DEFAULT_ERASER: BrushSettings = {
  size: 30,
  spacing: 0.15,
  flow: 1.0,
  opacity: 1.0,
  hardness: 1.0,
  roundness: 1.0,
  angle: 0,
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
    eng.setBrushBlendMode(TOOL_BLEND_MODES[tool]);
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
