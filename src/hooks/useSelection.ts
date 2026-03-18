import { useEffect } from "react";
import type { Engine } from "../engine";

interface UseSelectionOptions {
  onExport?: () => void;
}

export function useSelection(engine: Engine | null, activeLayer: number = 0, options: UseSelectionOptions = {}) {
  const { onExport } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        onExport?.();
      } else if (isMod && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        engine?.redo();
      } else if (isMod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        engine?.undo();
      } else if (isMod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        engine?.selectAll();
      } else if (isMod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        engine?.deselect();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!engine) return;
        e.preventDefault();
        engine.clearActiveLayer(activeLayer);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [engine, activeLayer, onExport]);
}
