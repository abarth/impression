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

  return { transform, setTransform, pan, zoom, resetView };
}
