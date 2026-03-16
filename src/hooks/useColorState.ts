import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";

export interface ColorState {
  foreground: string; // hex color
  background: string; // hex color
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export function useColorState(engine: Engine | null) {
  const [colors, setColors] = useState<ColorState>({
    foreground: "#000000",
    background: "#ffffff",
  });
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const syncToEngine = useCallback((c: ColorState) => {
    const eng = engineRef.current;
    if (!eng) return;
    const [r, g, b] = hexToRgb(c.foreground);
    eng.setBrushColor(r, g, b);
    const [br, bg, bb] = hexToRgb(c.background);
    eng.setBackgroundColor(br, bg, bb);
  }, []);

  useEffect(() => {
    if (engine) syncToEngine(colors);
  }, [engine]);

  const setForeground = useCallback(
    (hex: string) => {
      setColors((prev) => {
        const next = { ...prev, foreground: hex };
        syncToEngine(next);
        return next;
      });
    },
    [syncToEngine],
  );

  const setBackground = useCallback(
    (hex: string) => {
      setColors((prev) => {
        const next = { ...prev, background: hex };
        syncToEngine(next);
        return next;
      });
    },
    [syncToEngine],
  );

  const swapColors = useCallback(() => {
    setColors((prev) => {
      const next = {
        foreground: prev.background,
        background: prev.foreground,
      };
      syncToEngine(next);
      return next;
    });
  }, [syncToEngine]);

  return { colors, setForeground, setBackground, swapColors };
}

export { hexToRgb };
