import { useRef } from "react";
import { useEngine } from "./hooks/useEngine";
import { useViewTransform } from "./hooks/useViewTransform";
import { useTool } from "./hooks/useTool";
import { useBrushSettings } from "./hooks/useBrushSettings";
import { useColorState } from "./hooks/useColorState";
import { useLayerManager } from "./hooks/useLayerManager";
import { CanvasViewport } from "./components/CanvasViewport";
import { Toolbar } from "./components/Toolbar";
import { BrushSettingsPanel } from "./components/BrushSettingsPanel";
import { ColorDisplay } from "./components/ColorDisplay";
import { LayerPanel } from "./components/LayerPanel";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useEngine(canvasRef);
  const { transform, pan, zoom } = useViewTransform();
  const { activeTool, selectTool } = useTool();
  const { settings, updateSetting } = useBrushSettings(engine);
  const { colors, setForeground, setBackground, swapColors } =
    useColorState(engine);
  const { layers, activeIndex, addLayer, removeLayer, selectLayer } =
    useLayerManager(engine);

  return (
    <div className="flex h-screen w-screen bg-graphite-950">
      {/* Left toolbar */}
      <Toolbar activeTool={activeTool} onToolChange={selectTool} />

      {/* Canvas area */}
      <CanvasViewport
        canvasRef={canvasRef}
        engine={engine}
        activeTool={activeTool}
        transform={transform}
        pan={pan}
        zoom={zoom}
        onColorPick={setForeground}
      />

      {/* Right panel */}
      <div className="flex flex-col w-56 bg-graphite-900 border-l border-graphite-850 overflow-y-auto">
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
          onAdd={addLayer}
          onRemove={removeLayer}
          onSelect={selectLayer}
        />
      </div>
    </div>
  );
}
