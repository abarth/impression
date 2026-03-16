import { useState, useCallback, useEffect, useRef } from "react";

export type Tool = "brush" | "pan" | "zoom" | "eyedropper";

/** Permanent/spring-loaded tool keys. Tap to switch permanently,
 *  hold (>200ms) to switch temporarily. */
const KEY_TO_TOOL: Record<string, Tool> = {
  b: "brush",
  h: "pan",
  z: "zoom",
  i: "eyedropper",
};

/** Modifier keys that always act as temporary overrides.
 *  Maps (modifier key, current tool) → temporary tool. */
const MODIFIER_TEMP_TOOLS: Record<string, Partial<Record<Tool, Tool>>> = {
  Alt: {
    brush: "eyedropper",
    pan: "zoom",
  },
};

/** Non-modifier keys that always act as temporary (never permanent). */
const ALWAYS_TEMP_KEYS: Record<string, Tool> = {
  " ": "pan",
};

/** Threshold in ms: if a tool key is held longer than this, the switch
 *  is temporary (spring-loaded) and reverts on release. */
const SPRING_LOADED_MS = 200;

export function useTool() {
  const [activeTool, setActiveTool] = useState<Tool>("brush");
  const previousTool = useRef<Tool | null>(null);
  const tempKeyHeld = useRef<string | null>(null);
  const toolKeyDownTime = useRef<number | null>(null);
  const toolKeyHeld = useRef<string | null>(null);

  const selectTool = useCallback((tool: Tool) => {
    previousTool.current = null;
    tempKeyHeld.current = null;
    toolKeyDownTime.current = null;
    toolKeyHeld.current = null;
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

      // Context-dependent modifier keys (Alt/Option) — always temporary
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

      // Always-temporary keys (Space → Pan)
      if (ALWAYS_TEMP_KEYS[e.key] && !tempKeyHeld.current) {
        e.preventDefault();
        tempKeyHeld.current = e.key;
        setActiveTool((current) => {
          const targetTool = ALWAYS_TEMP_KEYS[e.key];
          if (current !== targetTool) {
            previousTool.current = current;
          }
          return targetTool;
        });
        return;
      }

      // Spring-loaded tool keys (B/H/Z/I) — tap for permanent, hold for temporary
      const key = e.key.toLowerCase();
      const tool = KEY_TO_TOOL[key];
      if (tool && !tempKeyHeld.current) {
        e.preventDefault();
        toolKeyDownTime.current = Date.now();
        toolKeyHeld.current = key;
        setActiveTool((current) => {
          if (current !== tool) {
            previousTool.current = current;
          }
          return tool;
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Release always-temporary tool (modifier or space)
      if (tempKeyHeld.current === e.key && previousTool.current !== null) {
        setActiveTool(previousTool.current);
        previousTool.current = null;
        tempKeyHeld.current = null;
        return;
      }

      // Release spring-loaded tool key
      const key = e.key.toLowerCase();
      if (
        toolKeyHeld.current === key &&
        previousTool.current !== null &&
        toolKeyDownTime.current !== null
      ) {
        const held = Date.now() - toolKeyDownTime.current;
        if (held >= SPRING_LOADED_MS) {
          // Held long enough — revert (spring-loaded)
          setActiveTool(previousTool.current);
        }
        // Tapped quickly — keep the new tool (permanent switch)
        previousTool.current = null;
        toolKeyDownTime.current = null;
        toolKeyHeld.current = null;
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
