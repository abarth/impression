import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import type { LayerInfo } from "../hooks/useLayerManager";

interface LayerPanelProps {
  layers: LayerInfo[];
  activeIndex: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
  onOpacityChange: (index: number, opacity: number) => void;
}

export function LayerPanel({
  layers,
  activeIndex,
  onAdd,
  onRemove,
  onSelect,
  onOpacityChange,
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
      )}

      <div className="flex flex-col gap-0.5">
        {[...layers].reverse().map((layer, reversedIdx) => {
          const index = layers.length - 1 - reversedIdx;
          const isActive = index === activeIndex;
          return (
            <button
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
                className={
                  isActive ? "text-cream-muted" : "text-graphite-600"
                }
              >
                {layer.visible ? (
                  <Eye size={14} strokeWidth={1.75} />
                ) : (
                  <EyeOff size={14} strokeWidth={1.75} />
                )}
              </span>
              <span className="flex-1 truncate">{layer.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
