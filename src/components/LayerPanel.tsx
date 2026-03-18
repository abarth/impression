import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { HexColorPicker } from "react-colorful";
import type { LayerInfo } from "../hooks/useLayerManager";
import { BLEND_MODE_GROUPS } from "../blendModes";

interface LayerPanelProps {
  layers: LayerInfo[];
  activeIndex: number;
  canvasColor: string;
  canvasVisible: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
  onOpacityChange: (index: number, opacity: number) => void;
  onBlendModeChange: (index: number, mode: number) => void;
  onToggleLayerVisible: (index: number) => void;
  onCanvasColorChange: (hex: string) => void;
  onToggleCanvasVisible: () => void;
}

export function LayerPanel({
  layers,
  activeIndex,
  canvasColor,
  canvasVisible,
  onAdd,
  onRemove,
  onSelect,
  onOpacityChange,
  onBlendModeChange,
  onToggleLayerVisible,
  onCanvasColorChange,
  onToggleCanvasVisible,
}: LayerPanelProps) {
  const activeLayer = layers[activeIndex];
  return (
    <div className="flex flex-col gap-2 px-4 py-4 flex-1 border-t border-graphite-850">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
          Layers
        </h3>
        <div className="flex gap-0.5">
          <button
            onClick={onAdd}
            title="Add layer"
            className="p-1.5 rounded-lg text-cream-muted hover:text-cream
              hover:bg-graphite-800 transition-all duration-150 cursor-pointer"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
          <button
            onClick={() => onRemove(activeIndex)}
            disabled={layers.length <= 1}
            title="Remove layer"
            className="p-1.5 rounded-lg text-cream-muted hover:text-cream
              hover:bg-graphite-800 transition-all duration-150
              disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {activeLayer && (
        <div className="flex flex-col gap-1.5">
          <select
            value={activeLayer.blendMode}
            onChange={(e) =>
              onBlendModeChange(activeIndex, Number(e.target.value))
            }
            className="w-full bg-graphite-850 text-cream-dim text-[11px] px-2 py-1.5
              rounded-lg border border-graphite-750 outline-none cursor-pointer
              transition-all duration-150 hover:border-cream-muted"
          >
            {BLEND_MODE_GROUPS.map(({ group, modes }) => (
              <optgroup key={group} label={group}>
                {modes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-cream-muted whitespace-nowrap">
              Opacity
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(activeLayer.opacity * 100)}
              onChange={(e) =>
                onOpacityChange(activeIndex, Number(e.target.value) / 100)
              }
              className="flex-1 accent-cream-muted h-1.5"
            />
            <span className="text-[11px] text-cream-dim w-8 text-right">
              {Math.round(activeLayer.opacity * 100)}%
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {[...layers].reverse().map((layer, reversedIdx) => {
          const index = layers.length - 1 - reversedIdx;
          const isActive = index === activeIndex;
          return (
            <div
              key={layer.id}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg
                text-left text-[12px] transition-all duration-150 cursor-pointer
                ${
                  isActive
                    ? "bg-graphite-800 text-cream shadow-soft"
                    : "text-cream-dim hover:bg-graphite-850"
                }`}
            >
              <span
                className={`cursor-pointer hover:text-cream-muted transition-all duration-150 ${
                  isActive ? "text-cream-muted" : "text-graphite-600"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLayerVisible(index);
                }}
              >
                {layer.visible ? (
                  <Eye size={14} strokeWidth={1.75} />
                ) : (
                  <EyeOff size={14} strokeWidth={1.75} />
                )}
              </span>
              <span className="flex-1 truncate">{layer.name}</span>
            </div>
          );
        })}

        {/* Canvas entry — always at bottom */}
        <div
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg
            text-[12px] text-cream-dim"
        >
          <span
            className="text-graphite-600 cursor-pointer hover:text-cream-muted transition-all duration-150"
            onClick={onToggleCanvasVisible}
          >
            {canvasVisible ? (
              <Eye size={14} strokeWidth={1.75} />
            ) : (
              <EyeOff size={14} strokeWidth={1.75} />
            )}
          </span>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                className="flex items-center gap-2.5 flex-1 cursor-pointer
                  hover:text-cream transition-all duration-150"
              >
                <span
                  className="w-3.5 h-3.5 rounded-[4px] border border-graphite-600 shrink-0"
                  style={{ backgroundColor: canvasColor }}
                />
                <span className="flex-1 truncate text-left">Canvas</span>
              </button>
            </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="left"
              sideOffset={12}
              className="z-50 rounded-xl bg-graphite-900 border border-graphite-750
                p-3.5 shadow-panel"
            >
              <HexColorPicker color={canvasColor} onChange={onCanvasColorChange} />
              <Popover.Arrow className="fill-graphite-750" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        </div>
      </div>
    </div>
  );
}
