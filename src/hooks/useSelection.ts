import { useEffect } from "react";
import type { Engine } from "../engine";

export function useSelection(engine: Engine | null, activeLayer: number = 0) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!engine) return;

      // Ignore when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        engine.redo();
      } else if (isMod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        engine.undo();
      } else if (isMod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        engine.selectAll();
      } else if (isMod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        engine.deselect();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        engine.clearActiveLayer(activeLayer);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [engine, activeLayer]);
}
