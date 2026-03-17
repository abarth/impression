import { useCallback, useState } from "react";

export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

export function useViewTransform() {
  const [transform, setTransform] = useState<ViewTransform>({
    tx: 0,
    ty: 0,
    scale: 1,
  });

  const pan = useCallback((dx: number, dy: number) => {
    setTransform((prev) => ({
      ...prev,
      tx: prev.tx + dx,
      ty: prev.ty + dy,
    }));
  }, []);

  const zoom = useCallback(
    (delta: number, centerX: number, centerY: number) => {
      setTransform((prev) => {
        const factor = delta > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.1, Math.min(10, prev.scale * factor));
        // Zoom toward the cursor position
        const newTx = centerX - (centerX - prev.tx) * (newScale / prev.scale);
        const newTy = centerY - (centerY - prev.ty) * (newScale / prev.scale);
        return { tx: newTx, ty: newTy, scale: newScale };
      });
    },
    [],
  );

  const resetView = useCallback(() => {
    setTransform({ tx: 0, ty: 0, scale: 1 });
  }, []);

  /** Center the canvas in the viewport, scaling down to fit if needed. */
  const fitToViewport = useCallback(
    (canvasW: number, canvasH: number, viewportW: number, viewportH: number) => {
      const padding = 40; // pixels of breathing room
      const availW = viewportW - padding * 2;
      const availH = viewportH - padding * 2;
      const scale = Math.min(availW / canvasW, availH / canvasH, 1.0);
      const tx = (viewportW - canvasW * scale) / 2;
      const ty = (viewportH - canvasH * scale) / 2;
      setTransform({ tx, ty, scale });
    },
    [],
  );

  return { transform, setTransform, pan, zoom, resetView, fitToViewport };
}
