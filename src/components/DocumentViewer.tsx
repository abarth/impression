import { useRef, useCallback, useState, useEffect } from "react";
import { useEngine, type EngineInitOptions } from "../hooks/useEngine";
import { useViewTransform } from "../hooks/useViewTransform";
import { useTool } from "../hooks/useTool";
import { Storage } from "../storage"
import { useBrushSettings, buildSerializableSettings, TOOL_BLEND_MODES, type ToolWithSettings } from "../hooks/useBrushSettings";
import { useColorState, hexToRgb } from "../hooks/useColorState";
import { useLayerManager } from "../hooks/useLayerManager";
import { useSelection } from "../hooks/useSelection";
import { useBrushPresets } from "../hooks/useBrushPresets";
import { useGradientPresets } from "../hooks/useGradientPresets";
import { rasterizeGradient } from "../gradient";
import { CanvasViewport } from "../components/CanvasViewport";
import { MenuBar } from "../components/MenuBar";
import { ToolPicker } from "../components/ToolPicker";
import { BrushPicker } from "../components/BrushPicker";
import { GradientPanel } from "../components/GradientPanel";
import { ToolSettingsPanel } from "../components/ToolSettingsPanel";
import { BrushSettingsPanel } from "../components/BrushSettingsPanel";
import { ColorDisplay } from "../components/ColorDisplay";
import { LayerPanel } from "../components/LayerPanel";

interface DocumentViewerProps {
  name: string;
  engineOptions: EngineInitOptions;
  onClose?: () => void;
  onNewDocument?: (name: string, width: number, height: number, ppi: number) => void;
}

export function DocumentViewer({
  name,
  engineOptions,
  onClose,
  onNewDocument,
}: DocumentViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { engine, error: gpuError } = useEngine(canvasRef, engineOptions);
  const { transform, pan, zoom, fitToViewport } = useViewTransform();
  const { activeTool, selectTool } = useTool();
  const { settings, updateSetting, applyPreset, toolLabel, getSettingsRef } = useBrushSettings(engine, activeTool);
  const { colors, setForeground, setBackground, swapColors, getColorsRef } =
    useColorState();
  const { layers, activeIndex, canvasColor, canvasVisible, addLayer, addGradientMapLayer, addWetMediaLayer, removeLayer, selectLayer, setLayerOpacity, setLayerBlendMode, renameLayer, moveLayer, toggleLayerVisible, setCanvasColor, toggleCanvasVisible, setGradientMapGradient } =
    useLayerManager(engine);
  const storage = engineOptions.storage;
  const { groups: presetGroups, activePresetId, activePreset, isImageTip, selectPreset, importAbr, toggleTipType, toggleDualBrushType } = useBrushPresets({
    engine,
    storage,
    activeTool,
    onApplyPreset: applyPreset,
  });
  const { groups: gradientGroups, activeGradientId, selectGradient, importGrd } = useGradientPresets({ storage });
  /** Build the full serializable brush settings blob for stroke start. */
  const getStrokeSettings = useCallback(() => {
    const { settings: s, tool } = getSettingsRef();
    const c = getColorsRef();
    const [r, g, b] = hexToRgb(c.foreground);
    const blendMode = TOOL_BLEND_MODES[tool as ToolWithSettings] ?? 0;
    return buildSerializableSettings(s, blendMode, r, g, b);
  }, [getSettingsRef, getColorsRef]);

  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });

  // Poll undo/redo state (cheap WASM call) to keep buttons in sync
  useEffect(() => {
    if (!engine) return;
    const refresh = () => setUndoState({ canUndo: engine.canUndo(), canRedo: engine.canRedo() });
    refresh();
    const id = setInterval(refresh, 250);
    return () => clearInterval(id);
  }, [engine]);

  const handleUndo = useCallback(() => {
    if (!engine) return;
    engine.undo();
    setUndoState({ canUndo: engine.canUndo(), canRedo: engine.canRedo() });
  }, [engine]);

  const handleRedo = useCallback(() => {
    if (!engine) return;
    engine.redo();
    setUndoState({ canUndo: engine.canUndo(), canRedo: engine.canRedo() });
  }, [engine]);

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [name]);

  const handleSelectAll = useCallback(() => {
    engine?.selectAll();
  }, [engine]);

  const handleDeselect = useCallback(() => {
    engine?.deselect();
  }, [engine]);

  const handleClear = useCallback(() => {
    engine?.clearActiveLayer(activeIndex);
  }, [engine, activeIndex]);

  const handleDefaultColors = useCallback(() => {
    setForeground("#000000");
    setBackground("#ffffff");
  }, [setForeground, setBackground]);

  const handleFitToScreen = useCallback(() => {
    if (!engine) return;
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const w = engine.width();
    const h = engine.height();
    const vw = canvasEl.clientWidth;
    const vh = canvasEl.clientHeight;
    fitToViewport(w, h, vw, vh);
  }, [engine, fitToViewport]);

  const handleZoomIn = useCallback(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    zoom(-1, canvasEl.clientWidth / 2, canvasEl.clientHeight / 2);
  }, [zoom]);

  const handleZoomOut = useCallback(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    zoom(1, canvasEl.clientWidth / 2, canvasEl.clientHeight / 2);
  }, [zoom]);

  const handleDeleteLayer = useCallback(() => {
    if (layers.length > 1) removeLayer(activeIndex);
  }, [layers.length, activeIndex, removeLayer]);

  useSelection(engine, activeIndex, {
    onExport: handleExport,
    onSwapColors: swapColors,
    onDefaultColors: handleDefaultColors,
    onFitToScreen: handleFitToScreen,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onNewLayer: addLayer,
  });

  // Embed gradient into document resources so the document is self-contained
  const embedGradient = useCallback(
    (gradientId: string) => {
      if (!engine) return;
      const allGradients = Object.values(gradientGroups).flat();
      const gradient = allGradients.find((g) => g.id === gradientId);
      if (gradient) {
        engine.embedResource("gradient", gradientId, gradient);
      }
    },
    [engine, gradientGroups],
  );

  // Upload rasterized gradient data to a gradient map layer.
  // Falls back to document_resources if the gradient preset was deleted globally.
  const uploadGradientToLayer = useCallback(
    async (layerIndex: number, gradientId: string) => {
      if (!engine) return;
      const allGradients = Object.values(gradientGroups).flat();
      let gradient = allGradients.find((g) => g.id === gradientId);
      if (!gradient && storage && engineOptions.documentMeta) {
        const res = await storage.getDocumentResource(
          engineOptions.documentMeta.id,
          "gradient",
          gradientId,
        );
        if (res) gradient = res.data as typeof gradient;
      }
      if (gradient) {
        const data = rasterizeGradient(gradient, colors.foreground, colors.background);
        engine.uploadGradientData(layerIndex, data);
      }
    },
    [engine, gradientGroups, colors.foreground, colors.background, storage, engineOptions.documentMeta],
  );

  // Re-upload gradient data when foreground/background colors change
  useEffect(() => {
    if (!engine) return;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer.kind === "gradient-map" && layer.gradientId) {
        uploadGradientToLayer(i, layer.gradientId);
      }
    }
  }, [engine, colors.foreground, colors.background, layers, uploadGradientToLayer]);

  // When the active gradient changes, update the active layer if it's a gradient map
  const handleGradientSelect = useCallback(
    (gradientId: string) => {
      selectGradient(gradientId);
      if (engine && layers[activeIndex]?.kind === "gradient-map") {
        setGradientMapGradient(activeIndex, gradientId);
        uploadGradientToLayer(activeIndex, gradientId);
        embedGradient(gradientId);
      }
    },
    [engine, activeIndex, layers, selectGradient, setGradientMapGradient, uploadGradientToLayer, embedGradient],
  );

  // When adding a gradient map, use the active gradient
  const handleAddGradientMap = useCallback(() => {
    const gid = activeGradientId ?? "default-bw";
    const idx = addGradientMapLayer(gid);
    if (idx !== undefined) {
      uploadGradientToLayer(idx, gid);
      embedGradient(gid);
    }
  }, [activeGradientId, addGradientMapLayer, uploadGradientToLayer, embedGradient]);

  // Handle gradient change from LayerPanel gradient picker
  const handleLayerGradientChange = useCallback(
    (layerIndex: number, gradientId: string) => {
      setGradientMapGradient(layerIndex, gradientId);
      uploadGradientToLayer(layerIndex, gradientId);
      embedGradient(gradientId);
    },
    [setGradientMapGradient, uploadGradientToLayer, embedGradient],
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-graphite-950">
      {/* Menu bar */}
      <MenuBar
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        onExport={handleExport}
        onClose={onClose}
        onSelectAll={handleSelectAll}
        onDeselect={handleDeselect}
        onClear={handleClear}
        onNewLayer={addLayer}
        onDeleteLayer={handleDeleteLayer}
        canDeleteLayer={layers.length > 1}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onSwapColors={swapColors}
        onDefaultColors={handleDefaultColors}
        onNewDocument={onNewDocument}
        onOpenDocument={onClose}
      />

      <div className="flex flex-1 min-h-0">
        {/* Tool picker */}
        <ToolPicker
          activeTool={activeTool}
          onToolChange={selectTool}
        />

        {/* Canvas area */}
        {gpuError ? (
          <div className="flex-1 flex items-center justify-center bg-graphite-950">
            <div className="max-w-sm text-center px-6">
              <p className="text-cream text-[14px] font-medium mb-2">Unable to initialize WebGPU</p>
              <p className="text-cream-muted text-[12px]">{gpuError}</p>
              <p className="text-cream-muted text-[11px] mt-3">
                Please use Chrome 113+, Edge 113+, or Safari 18+.
              </p>
            </div>
          </div>
        ) : <CanvasViewport
          canvasRef={canvasRef}
          engine={engine}
          activeTool={activeTool}
          brushSize={settings.size}
          smoothing={settings.smoothing}
          transform={transform}
          activeLayerKind={layers[activeIndex]?.kind}
          pan={pan}
          zoom={zoom}
          onColorPick={setForeground}
          fitToViewport={fitToViewport}
          getStrokeSettings={getStrokeSettings}
        />}

        {/* Right panel */}
        <div className="flex flex-col w-56 bg-graphite-900 border-l border-graphite-850 overflow-y-auto">
          <ToolSettingsPanel settings={settings} toolLabel={toolLabel} onUpdate={updateSetting} />
          <BrushPicker groups={presetGroups} activePresetId={activePresetId} onSelect={selectPreset} onImportAbr={importAbr} />
          <BrushSettingsPanel
            settings={settings}
            onUpdate={updateSetting}
            isImageTip={isImageTip}
            storage={storage}
            activePreset={activePreset}
            onToggleTipType={toggleTipType}
            onToggleDualBrushType={toggleDualBrushType}
          />
          <ColorDisplay
            foreground={colors.foreground}
            background={colors.background}
            onForegroundChange={setForeground}
            onBackgroundChange={setBackground}
            onSwap={swapColors}
          />
          <GradientPanel
            groups={gradientGroups}
            activeGradientId={activeGradientId}
            onSelect={handleGradientSelect}
            onImportGrd={importGrd}
          />
          <LayerPanel
            layers={layers}
            activeIndex={activeIndex}
            canvasColor={canvasColor}
            canvasVisible={canvasVisible}
            gradientGroups={gradientGroups}
            onAdd={addLayer}
            onAddGradientMap={handleAddGradientMap}
            onAddWetMediaLayer={addWetMediaLayer}
            onRemove={removeLayer}
            onSelect={selectLayer}
            onOpacityChange={setLayerOpacity}
            onBlendModeChange={setLayerBlendMode}
            onRename={renameLayer}
            onMoveLayer={moveLayer}
            onToggleLayerVisible={toggleLayerVisible}
            onCanvasColorChange={setCanvasColor}
            onToggleCanvasVisible={toggleCanvasVisible}
            onGradientMapGradientChange={handleLayerGradientChange}
          />
        </div>
      </div>
    </div>
  );
}
