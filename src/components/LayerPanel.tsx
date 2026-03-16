import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import type { LayerInfo } from "../hooks/useLayerManager";

interface LayerPanelProps {
  layers: LayerInfo[];
  activeIndex: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
}

export function LayerPanel({
  layers,
  activeIndex,
  onAdd,
  onRemove,
  onSelect,
}: LayerPanelProps) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">
          Layers
        </h3>
        <div className="flex gap-1">
          <button
            onClick={onAdd}
            title="Add layer"
            className="p-1 text-[#888] hover:text-white hover:bg-[#333] rounded transition-colors cursor-pointer"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => onRemove(activeIndex)}
            disabled={layers.length <= 1}
            title="Remove layer"
            className="p-1 text-[#888] hover:text-white hover:bg-[#333] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {[...layers].reverse().map((layer, reversedIdx) => {
          const index = layers.length - 1 - reversedIdx;
          const isActive = index === activeIndex;
          return (
            <button
              key={layer.id}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-[12px] transition-colors cursor-pointer
                ${isActive ? "bg-[#3a3a3a] text-white" : "text-[#aaa] hover:bg-[#2e2e2e]"}`}
            >
              <span className="text-[#666]">
                {layer.visible ? (
                  <Eye size={13} />
                ) : (
                  <EyeOff size={13} />
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
