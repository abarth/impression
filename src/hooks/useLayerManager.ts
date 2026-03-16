import { useState, useCallback, useRef } from "react";
import type { Engine } from "../engine";

export interface LayerInfo {
  id: number; // unique ID for React keys
  name: string;
  visible: boolean;
}

let nextLayerId = 0;

export function useLayerManager(engine: Engine | null) {
  const [layers, setLayers] = useState<LayerInfo[]>(() => {
    const id = nextLayerId++;
    return [{ id, name: "Layer 1", visible: true }];
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const addLayer = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.addLayer();
    const id = nextLayerId++;
    setLayers((prev) => {
      const newLayer: LayerInfo = {
        id,
        name: `Layer ${prev.length + 1}`,
        visible: true,
      };
      return [...prev, newLayer];
    });
    setActiveIndex((prev) => {
      const newIndex = prev + 1;
      eng.setActiveLayer(newIndex);
      return newIndex;
    });
  }, []);

  const removeLayer = useCallback(
    (index: number) => {
      const eng = engineRef.current;
      if (!eng) return;
      setLayers((prev) => {
        if (prev.length <= 1) return prev; // keep at least one layer
        const removed = eng.removeLayer(index);
        if (!removed) return prev;
        const next = prev.filter((_, i) => i !== index);
        return next;
      });
      setActiveIndex((prev) => {
        const count = eng.getLayerCount();
        if (prev >= count) return Math.max(0, count - 1);
        return prev;
      });
    },
    [],
  );

  const selectLayer = useCallback(
    (index: number) => {
      const eng = engineRef.current;
      if (eng) eng.setActiveLayer(index);
      setActiveIndex(index);
    },
    [],
  );

  return { layers, activeIndex, addLayer, removeLayer, selectLayer };
}
