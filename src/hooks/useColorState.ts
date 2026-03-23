import { useState, useCallback, useRef } from "react";
import { hexToRgb } from "../colorUtils";

export interface ColorState {
  foreground: string; // hex color
  background: string; // hex color
}

export function useColorState() {
  const [colors, setColors] = useState<ColorState>({
    foreground: "#000000",
    background: "#ffffff",
  });
  const colorsRef = useRef(colors);

  const setForeground = useCallback((hex: string) => {
    const next = { ...colorsRef.current, foreground: hex };
    colorsRef.current = next;
    setColors(next);
  }, []);

  const setBackground = useCallback((hex: string) => {
    const next = { ...colorsRef.current, background: hex };
    colorsRef.current = next;
    setColors(next);
  }, []);

  const swapColors = useCallback(() => {
    const prev = colorsRef.current;
    const next = {
      foreground: prev.background,
      background: prev.foreground,
    };
    colorsRef.current = next;
    setColors(next);
  }, []);

  /** Get current colors via ref (for use in event handlers without stale closures). */
  const getColorsRef = useCallback(() => colorsRef.current, []);

  return { colors, setForeground, setBackground, swapColors, getColorsRef };
}

export { hexToRgb };
