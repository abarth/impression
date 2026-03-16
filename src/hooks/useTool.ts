import { useState, useCallback, useEffect, useRef } from "react";

export type Tool = "brush" | "pan" | "zoom" | "eyedropper";

const KEY_TO_TOOL: Record<string, Tool> = {
  b: "brush",
  h: "pan",
  z: "zoom",
  i: "eyedropper",
};

/** Context-dependent temporary tool overrides for modifier keys.
 *  Maps (modifier key, current tool) → temporary tool. */
const MODIFIER_TEMP_TOOLS: Record<string, Partial<Record<Tool, Tool>>> = {
  Alt: {
    brush: "eyedropper",
    pan: "zoom",
  },
};

/** Simple temporary tool keys (not context-dependent). */
const TEMP_TOOL_KEYS: Record<string, Tool> = {
  " ": "pan",
};

export function useTool() {
  const [activeTool, setActiveTool] = useState<Tool>("brush");
  const previousTool = useRef<Tool | null>(null);
  const tempKeyHeld = useRef<string | null>(null);

  const selectTool = useCallback((tool: Tool) => {
    previousTool.current = null;
    tempKeyHeld.current = null;
    setActiveTool(tool);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Ignore repeated keydown events from key being held
      if (e.repeat) return;

      // Context-dependent modifier keys (Alt/Option)
      const modifierMap = MODIFIER_TEMP_TOOLS[e.key];
      if (modifierMap && !tempKeyHeld.current) {
        setActiveTool((current) => {
          const targetTool = modifierMap[current];
          if (targetTool && current !== targetTool) {
            e.preventDefault();
            tempKeyHeld.current = e.key;
            previousTool.current = current;
            return targetTool;
          }
          return current;
        });
        return;
      }

      // Simple temporary tool activation (hold key)
      if (TEMP_TOOL_KEYS[e.key] && !tempKeyHeld.current) {
        e.preventDefault();
        tempKeyHeld.current = e.key;
        setActiveTool((current) => {
          const targetTool = TEMP_TOOL_KEYS[e.key];
          if (current !== targetTool) {
            previousTool.current = current;
          }
          return targetTool;
        });
        return;
      }

      // Permanent tool switch (press key)
      const key = e.key.toLowerCase();
      const tool = KEY_TO_TOOL[key];
      if (tool) {
        e.preventDefault();
        previousTool.current = null;
        tempKeyHeld.current = null;
        setActiveTool(tool);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Release temporary tool
      if (tempKeyHeld.current === e.key && previousTool.current !== null) {
        setActiveTool(previousTool.current);
        previousTool.current = null;
        tempKeyHeld.current = null;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return { activeTool, selectTool };
}
