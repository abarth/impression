import { useEffect } from "react";
import type { Engine } from "../engine";

interface UseSelectionOptions {
  onExport?: () => void;
  onSwapColors?: () => void;
  onDefaultColors?: () => void;
  onFitToScreen?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onNewLayer?: () => void;
}

export function useSelection(engine: Engine | null, activeLayer: number = 0, options: UseSelectionOptions = {}) {
  const { onExport, onSwapColors, onDefaultColors, onFitToScreen, onZoomIn, onZoomOut, onNewLayer } = options;

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
      const key = e.key.toLowerCase();

      // --- Modifier shortcuts ---

      if (isMod && e.shiftKey && key === "e") {
        e.preventDefault();
        onExport?.();
      } else if (isMod && e.shiftKey && key === "n") {
        e.preventDefault();
        onNewLayer?.();
      } else if (isMod && e.shiftKey && key === "z") {
        e.preventDefault();
        engine?.redo();
      } else if (isMod && key === "z") {
        e.preventDefault();
        engine?.undo();
      } else if (isMod && key === "a") {
        e.preventDefault();
        engine?.selectAll();
      } else if (isMod && key === "d") {
        e.preventDefault();
        engine?.deselect();
      } else if (isMod && (key === "0")) {
        e.preventDefault();
        onFitToScreen?.();
      } else if (isMod && (key === "=" || key === "+")) {
        e.preventDefault();
        onZoomIn?.();
      } else if (isMod && key === "-") {
        e.preventDefault();
        onZoomOut?.();

      // --- Non-modifier shortcuts ---

      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!engine) return;
        e.preventDefault();
        engine.clearActiveLayer(activeLayer);
      } else if (key === "x" && !isMod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onSwapColors?.();
      } else if (key === "d" && !isMod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onDefaultColors?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [engine, activeLayer, onExport, onSwapColors, onDefaultColors, onFitToScreen, onZoomIn, onZoomOut, onNewLayer]);
}
