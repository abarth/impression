import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";
import { hexToRgb } from "../colorUtils";

export interface ColorState {
  foreground: string; // hex color
  background: string; // hex color
}

export function useColorState(engine: Engine | null) {
  const [colors, setColors] = useState<ColorState>({
    foreground: "#000000",
    background: "#ffffff",
  });
  const colorsRef = useRef(colors);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const syncToEngine = useCallback((c: ColorState) => {
    const eng = engineRef.current;
    if (!eng) return;
    const [r, g, b] = hexToRgb(c.foreground);
    eng.setBrushColor(r, g, b);
  }, []);

  useEffect(() => {
    if (engine) syncToEngine(colors);
  }, [engine]);

  const setForeground = useCallback(
    (hex: string) => {
      const next = { ...colorsRef.current, foreground: hex };
      colorsRef.current = next;
      setColors(next);
      syncToEngine(next);
    },
    [syncToEngine],
  );

  const setBackground = useCallback(
    (hex: string) => {
      const next = { ...colorsRef.current, background: hex };
      colorsRef.current = next;
      setColors(next);
      syncToEngine(next);
    },
    [syncToEngine],
  );

  const swapColors = useCallback(() => {
    const prev = colorsRef.current;
    const next = {
      foreground: prev.background,
      background: prev.foreground,
    };
    colorsRef.current = next;
    setColors(next);
    syncToEngine(next);
  }, [syncToEngine]);

  return { colors, setForeground, setBackground, swapColors };
}

export { hexToRgb };
