import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";
import { hexToRgb } from "./useColorState";

export interface LayerInfo {
  id: number; // unique ID for React keys
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: number;
}

let nextLayerId = 0;

export function useLayerManager(engine: Engine | null) {
  const [layers, setLayers] = useState<LayerInfo[]>(() => {
    const id = nextLayerId++;
    return [{ id, name: "Layer 1", visible: true, opacity: 1.0, blendMode: 0 }];
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [canvasColor, setCanvasColorState] = useState("#ffffff");
  const [canvasVisible, setCanvasVisible] = useState(true);
  const layersRef = useRef(layers);
  const activeIndexRef = useRef(activeIndex);
  const canvasVisibleRef = useRef(canvasVisible);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  // Sync canvas color to engine on init
  useEffect(() => {
    if (engine) {
      const [r, g, b] = hexToRgb(canvasColor);
      engine.setBackgroundColor(r, g, b);
    }
  }, [engine]);

  const addLayer = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.addLayer();
    const id = nextLayerId++;
    const prev = layersRef.current;
    const newIndex = prev.length;
    const name = eng.getLayerName(newIndex);
    const newLayer: LayerInfo = {
      id,
      name,
      visible: true,
      opacity: 1.0,
      blendMode: 0,
    };
    const nextLayers = [...prev, newLayer];
    layersRef.current = nextLayers;
    setLayers(nextLayers);
    const nextActive = activeIndexRef.current + 1;
    activeIndexRef.current = nextActive;
    setActiveIndex(nextActive);
    eng.setActiveLayer(nextActive);
  }, []);

  const removeLayer = useCallback(
    (index: number) => {
      const eng = engineRef.current;
      if (!eng) return;
      const prev = layersRef.current;
      if (prev.length <= 1) return; // keep at least one layer
      const removed = eng.removeLayer(index);
      if (!removed) return;
      const nextLayers = prev.filter((_, i) => i !== index);
      layersRef.current = nextLayers;
      setLayers(nextLayers);
      const count = eng.getLayerCount();
      const prevActive = activeIndexRef.current;
      const nextActive = prevActive >= count ? Math.max(0, count - 1) : prevActive;
      activeIndexRef.current = nextActive;
      setActiveIndex(nextActive);
    },
    [],
  );

  const selectLayer = useCallback(
    (index: number) => {
      const eng = engineRef.current;
      if (eng) eng.setActiveLayer(index);
      activeIndexRef.current = index;
      setActiveIndex(index);
    },
    [],
  );

  const setLayerOpacity = useCallback(
    (index: number, opacity: number) => {
      const eng = engineRef.current;
      if (eng) eng.setLayerOpacity(index, opacity);
      const nextLayers = layersRef.current.map((l, i) => (i === index ? { ...l, opacity } : l));
      layersRef.current = nextLayers;
      setLayers(nextLayers);
    },
    [],
  );

  const setLayerBlendMode = useCallback(
    (index: number, mode: number) => {
      const eng = engineRef.current;
      if (eng) eng.setLayerBlendMode(index, mode);
      const nextLayers = layersRef.current.map((l, i) => (i === index ? { ...l, blendMode: mode } : l));
      layersRef.current = nextLayers;
      setLayers(nextLayers);
    },
    [],
  );

  const setCanvasColor = useCallback(
    (hex: string) => {
      setCanvasColorState(hex);
      const eng = engineRef.current;
      if (eng) {
        const [r, g, b] = hexToRgb(hex);
        eng.setBackgroundColor(r, g, b);
      }
    },
    [],
  );

  const toggleLayerVisible = useCallback(
    (index: number) => {
      const eng = engineRef.current;
      const prev = layersRef.current;
      const nextLayers = prev.map((l, i) => {
        if (i !== index) return l;
        const next = !l.visible;
        if (eng) eng.setLayerVisible(index, next);
        return { ...l, visible: next };
      });
      layersRef.current = nextLayers;
      setLayers(nextLayers);
    },
    [],
  );

  const renameLayer = useCallback(
    (index: number, name: string) => {
      const eng = engineRef.current;
      if (eng) eng.renameLayer(index, name);
      const nextLayers = layersRef.current.map((l, i) => (i === index ? { ...l, name } : l));
      layersRef.current = nextLayers;
      setLayers(nextLayers);
    },
    [],
  );

  const toggleCanvasVisible = useCallback(() => {
    const next = !canvasVisibleRef.current;
    canvasVisibleRef.current = next;
    setCanvasVisible(next);
    const eng = engineRef.current;
    if (eng) eng.setCanvasVisible(next);
  }, []);

  return { layers, activeIndex, canvasColor, canvasVisible, addLayer, removeLayer, selectLayer, setLayerOpacity, setLayerBlendMode, renameLayer, toggleLayerVisible, setCanvasColor, toggleCanvasVisible };
}
