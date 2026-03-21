import { useState, useCallback, useRef, useEffect } from "react";
import type { Engine } from "../engine";
import { hexToRgb } from "./useColorState";

export type LayerKind = "raster" | "gradient-map";

export interface LayerInfo {
  id: number; // unique ID for React keys
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: number;
  kind: LayerKind;
  gradientId?: string;
}

let nextLayerId = 0;

/** Map engine layer-kind number to our LayerKind type. */
function engineKindToLayerKind(kind: number): LayerKind {
  switch (kind) {
    case 1: return "gradient-map";
    default: return "raster";
  }
}

export function useLayerManager(engine: Engine | null) {
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canvasColor, setCanvasColorState] = useState("#ffffff");
  const [canvasVisible, setCanvasVisible] = useState(true);
  const layersRef = useRef(layers);
  const activeIndexRef = useRef(activeIndex);
  const canvasVisibleRef = useRef(canvasVisible);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  /** Read all layer metadata from the engine and rebuild React state. */
  const syncLayersFromEngine = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const count = eng.getLayerCount();
    const synced: LayerInfo[] = [];
    for (let i = 0; i < count; i++) {
      const kindNum = eng.getLayerKind(i);
      const kind = engineKindToLayerKind(kindNum);
      const info: LayerInfo = {
        id: nextLayerId++,
        name: eng.getLayerName(i),
        visible: eng.getLayerVisible(i),
        opacity: eng.getLayerOpacity(i),
        blendMode: eng.getLayerBlendMode(i),
        kind,
      };
      if (kind === "gradient-map") {
        info.gradientId = eng.getGradientMapGradientId(i);
      }
      synced.push(info);
    }
    layersRef.current = synced;
    setLayers(synced);
    // Clamp active index to valid range
    const clamped = Math.min(activeIndexRef.current, Math.max(0, count - 1));
    activeIndexRef.current = clamped;
    setActiveIndex(clamped);
  }, []);

  // Sync layer state from engine when the engine becomes available
  // (covers both new documents and loaded documents).
  useEffect(() => {
    if (engine) {
      syncLayersFromEngine();
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
      kind: "raster",
    };
    const nextLayers = [...prev, newLayer];
    layersRef.current = nextLayers;
    setLayers(nextLayers);
    const nextActive = activeIndexRef.current + 1;
    activeIndexRef.current = nextActive;
    setActiveIndex(nextActive);
    eng.setActiveLayer(nextActive);
  }, []);

  const addGradientMapLayer = useCallback((gradientId: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.addGradientMapLayer(gradientId);
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
      kind: "gradient-map",
      gradientId,
    };
    const nextLayers = [...prev, newLayer];
    layersRef.current = nextLayers;
    setLayers(nextLayers);
    const nextActive = newIndex;
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

  const moveLayer = useCallback(
    (fromIndex: number, toIndex: number) => {
      const eng = engineRef.current;
      if (!eng) return;
      const prev = layersRef.current;
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || fromIndex >= prev.length) return;
      if (toIndex < 0 || toIndex >= prev.length) return;
      eng.moveLayer(fromIndex, toIndex);
      // Sync layer state from engine rather than manual splice (issue #101)
      syncLayersFromEngine();
      // Update active index to follow the moved layer or adjust for shift
      const prevActive = activeIndexRef.current;
      let nextActive: number;
      if (prevActive === fromIndex) {
        nextActive = toIndex;
      } else if (fromIndex < prevActive && toIndex >= prevActive) {
        nextActive = prevActive - 1;
      } else if (fromIndex > prevActive && toIndex <= prevActive) {
        nextActive = prevActive + 1;
      } else {
        nextActive = prevActive;
      }
      activeIndexRef.current = nextActive;
      setActiveIndex(nextActive);
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

  const setGradientMapGradient = useCallback(
    (layerIndex: number, gradientId: string) => {
      const eng = engineRef.current;
      if (eng) eng.setGradientMapGradient(layerIndex, gradientId);
      const nextLayers = layersRef.current.map((l, i) =>
        i === layerIndex ? { ...l, gradientId } : l,
      );
      layersRef.current = nextLayers;
      setLayers(nextLayers);
    },
    [],
  );

  return { layers, activeIndex, canvasColor, canvasVisible, addLayer, addGradientMapLayer, removeLayer, selectLayer, setLayerOpacity, setLayerBlendMode, renameLayer, moveLayer, toggleLayerVisible, setCanvasColor, toggleCanvasVisible, setGradientMapGradient, syncLayersFromEngine };
}
