import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";

export interface BrushSettings {
  size: number;
  spacing: number;
  flow: number;
  opacity: number;
}

const DEFAULT_SETTINGS: BrushSettings = {
  size: 20,
  spacing: 0.15,
  flow: 0.8,
  opacity: 1.0,
};

export function useBrushSettings(engine: Engine | null) {
  const [settings, setSettings] = useState<BrushSettings>(DEFAULT_SETTINGS);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const syncToEngine = useCallback((s: BrushSettings) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setBrushSize(s.size);
    eng.setBrushSpacing(s.spacing);
    eng.setBrushFlow(s.flow);
    eng.setBrushOpacity(s.opacity);
  }, []);

  // Sync defaults when engine becomes available
  useEffect(() => {
    if (engine) syncToEngine(settings);
  }, [engine]);

  const updateSetting = useCallback(
    <K extends keyof BrushSettings>(key: K, value: BrushSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        syncToEngine(next);
        return next;
      });
    },
    [syncToEngine],
  );

  return { settings, updateSetting };
}
