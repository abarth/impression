import { useRef, useCallback, useState, useEffect } from "react";
import { useEngine, type EngineInitOptions } from "../hooks/useEngine";
import { useViewTransform } from "../hooks/useViewTransform";
import { useTool } from "../hooks/useTool";
import { Storage } from "../storage"
import { useBrushSettings } from "../hooks/useBrushSettings";
import { useColorState } from "../hooks/useColorState";
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
}

export function DocumentViewer({
  name,
  engineOptions,
  onClose,
}: DocumentViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { engine, error: gpuError } = useEngine(canvasRef, engineOptions);
  const { transform, pan, zoom, fitToViewport } = useViewTransform();
  const { activeTool, selectTool } = useTool();
  const { settings, updateSetting, applyPreset, toolLabel } = useBrushSettings(engine, activeTool);
  const { colors, setForeground, setBackground, swapColors } =
    useColorState(engine);
  const { layers, activeIndex, canvasColor, canvasVisible, addLayer, addGradientMapLayer, removeLayer, selectLayer, setLayerOpacity, setLayerBlendMode, renameLayer, moveLayer, toggleLayerVisible, setCanvasColor, toggleCanvasVisible, setGradientMapGradient, syncLayersFromEngine } =
    useLayerManager(engine);
  const storage = engineOptions.storage;
  const { groups: presetGroups, activePresetId, isImageTip, selectPreset, importAbr } = useBrushPresets({
    engine,
    storage,
    activeTool,
    onApplyPreset: applyPreset,
  });
  const { groups: gradientGroups, activeGradientId, selectGradient, importGrd } = useGradientPresets({ storage });
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
    syncLayersFromEngine();
    setUndoState({ canUndo: engine.canUndo(), canRedo: engine.canRedo() });
  }, [engine, syncLayersFromEngine]);

  const handleRedo = useCallback(() => {
    if (!engine) return;
    engine.redo();
    syncLayersFromEngine();
    setUndoState({ canUndo: engine.canUndo(), canRedo: engine.canRedo() });
  }, [engine, syncLayersFromEngine]);

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

  useSelection(engine, activeIndex, { onExport: handleExport });

  // Upload rasterized gradient data to a gradient map layer
  const uploadGradientToLayer = useCallback(
    (layerIndex: number, gradientId: string) => {
      if (!engine) return;
      const allGradients = Object.values(gradientGroups).flat();
      const gradient = allGradients.find((g) => g.id === gradientId);
      if (gradient) {
        const data = rasterizeGradient(gradient, colors.foreground, colors.background);
        engine.uploadGradientData(layerIndex, data);
      }
    },
    [engine, gradientGroups, colors.foreground, colors.background],
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
      }
    },
    [engine, activeIndex, layers, selectGradient, setGradientMapGradient, uploadGradientToLayer],
  );

  // When adding a gradient map, use the active gradient
  const handleAddGradientMap = useCallback(() => {
    const gid = activeGradientId ?? "default-bw";
    const idx = addGradientMapLayer(gid);
    if (idx !== undefined) {
      uploadGradientToLayer(idx, gid);
    }
  }, [activeGradientId, addGradientMapLayer, uploadGradientToLayer]);

  // Handle gradient change from LayerPanel gradient picker
  const handleLayerGradientChange = useCallback(
    (layerIndex: number, gradientId: string) => {
      setGradientMapGradient(layerIndex, gradientId);
      uploadGradientToLayer(layerIndex, gradientId);
    },
    [setGradientMapGradient, uploadGradientToLayer],
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
        />}

        {/* Right panel */}
        <div className="flex flex-col w-56 bg-graphite-900 border-l border-graphite-850 overflow-y-auto">
          <ToolSettingsPanel settings={settings} toolLabel={toolLabel} onUpdate={updateSetting} />
          <BrushPicker groups={presetGroups} activePresetId={activePresetId} onSelect={selectPreset} onImportAbr={importAbr} />
          <BrushSettingsPanel settings={settings} onUpdate={updateSetting} isImageTip={isImageTip} />
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
