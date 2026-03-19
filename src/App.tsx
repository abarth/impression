import { useRef, useMemo, useCallback, useState, useEffect } from "react";
import { useEngine, type EngineInitOptions } from "./hooks/useEngine";
import { useViewTransform } from "./hooks/useViewTransform";
import { useTool } from "./hooks/useTool";
import { useBrushSettings } from "./hooks/useBrushSettings";
import { useColorState } from "./hooks/useColorState";
import { useLayerManager } from "./hooks/useLayerManager";
import { useSelection } from "./hooks/useSelection";
import { useDocumentManager } from "./hooks/useDocumentManager";
import { useBrushPresets } from "./hooks/useBrushPresets";
import { CanvasViewport } from "./components/CanvasViewport";
import { MenuBar } from "./components/MenuBar";
import { ToolPicker } from "./components/ToolPicker";
import { BrushPicker } from "./components/BrushPicker";
import { ToolSettingsPanel } from "./components/ToolSettingsPanel";
import { BrushSettingsPanel } from "./components/BrushSettingsPanel";
import { ColorDisplay } from "./components/ColorDisplay";
import { LayerPanel } from "./components/LayerPanel";
import { DocumentPicker } from "./components/DocumentPicker";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docManager = useDocumentManager();

  // Stabilize engine init options to avoid re-triggering on every render
  const engineOptions: EngineInitOptions | null = useMemo(() => {
    if (!docManager.currentDocument) return null;
    return {
      documentSize: {
        width: docManager.currentDocument.width,
        height: docManager.currentDocument.height,
      },
      chunks: docManager.currentChunks,
      storage: docManager.storage,
      documentMeta: docManager.currentDocument,
    };
  }, [docManager.currentDocument, docManager.currentChunks, docManager.storage]);

  const { engine, error: gpuError } = useEngine(canvasRef, engineOptions);
  const { transform, pan, zoom, fitToViewport } = useViewTransform();
  const { activeTool, selectTool } = useTool();
  const { settings, updateSetting, applyPreset, toolLabel } = useBrushSettings(engine, activeTool);
  const { colors, setForeground, setBackground, swapColors } =
    useColorState(engine);
  const { layers, activeIndex, canvasColor, canvasVisible, addLayer, removeLayer, selectLayer, setLayerOpacity, setLayerBlendMode, renameLayer, moveLayer, toggleLayerVisible, setCanvasColor, toggleCanvasVisible } =
    useLayerManager(engine);
  const { groups: presetGroups, activePresetId, selectPreset, importAbr } = useBrushPresets({
    storage: docManager.storage,
    activeTool,
    onApplyPreset: applyPreset,
  });
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
    const name = docManager.currentDocument?.name ?? "painting";
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [docManager.currentDocument?.name]);

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

  // Show loading while storage initializes
  if (!docManager.ready) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-graphite-950">
        <span className="text-cream-muted text-[13px]">Loading...</span>
      </div>
    );
  }

  // Show document picker if no document is open
  if (!docManager.currentDocument) {
    return (
      <DocumentPicker
        documents={docManager.documents}
        onOpen={docManager.openDocument}
        onDelete={docManager.deleteDocument}
        onRename={docManager.renameDocument}
        onCreate={(name, width, height, ppi) => {
          docManager.createDocument(name, width, height, ppi);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-graphite-950">
      {/* Menu bar */}
      <MenuBar
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        onExport={handleExport}
        onClose={docManager.closeDocument}
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
          pan={pan}
          zoom={zoom}
          onColorPick={setForeground}
          fitToViewport={fitToViewport}
        />}

        {/* Right panel */}
        <div className="flex flex-col w-56 bg-graphite-900 border-l border-graphite-850 overflow-y-auto">
          <ToolSettingsPanel settings={settings} toolLabel={toolLabel} onUpdate={updateSetting} />
          <BrushPicker groups={presetGroups} activePresetId={activePresetId} onSelect={selectPreset} onImportAbr={importAbr} />
          <BrushSettingsPanel settings={settings} onUpdate={updateSetting} />
          <ColorDisplay
            foreground={colors.foreground}
            background={colors.background}
            onForegroundChange={setForeground}
            onBackgroundChange={setBackground}
            onSwap={swapColors}
          />
          <LayerPanel
            layers={layers}
            activeIndex={activeIndex}
            canvasColor={canvasColor}
            canvasVisible={canvasVisible}
            onAdd={addLayer}
            onRemove={removeLayer}
            onSelect={selectLayer}
            onOpacityChange={setLayerOpacity}
            onBlendModeChange={setLayerBlendMode}
            onRename={renameLayer}
            onMoveLayer={moveLayer}
            onToggleLayerVisible={toggleLayerVisible}
            onCanvasColorChange={setCanvasColor}
            onToggleCanvasVisible={toggleCanvasVisible}
          />
        </div>
      </div>
    </div>
  );
}
