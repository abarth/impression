import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Trash2, Eye, EyeOff, GripVertical, Blend } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { OklchColorPicker } from "./OklchColorPicker";
import type { LayerInfo } from "../hooks/useLayerManager";
import type { Gradient } from "../gradient";
import { rasterizeGradient } from "../gradient";
import { BLEND_MODE_GROUPS } from "../blendModes";

function GradientPickerThumbnail({ gradient, isActive, onSelect }: {
  gradient: Gradient;
  isActive: boolean;
  onSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = rasterizeGradient(gradient);
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), 256, 1);
    ctx.putImageData(imageData, 0, 0);
  }, [gradient]);

  return (
    <button
      className={`w-full h-4 rounded shrink-0 overflow-hidden transition-all duration-150 cursor-pointer ${
        isActive
          ? "ring-1 ring-cream-muted ring-offset-1 ring-offset-graphite-900"
          : "hover:ring-1 hover:ring-graphite-600"
      }`}
      onClick={onSelect}
      title={gradient.name}
    >
      <canvas
        ref={canvasRef}
        width={256}
        height={1}
        className="w-full h-full"
        style={{ imageRendering: "auto" }}
      />
    </button>
  );
}

function GradientPickerInlinePreview({ gradient }: { gradient: Gradient }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = rasterizeGradient(gradient);
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), 256, 1);
    ctx.putImageData(imageData, 0, 0);
  }, [gradient]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={1}
      className="w-full h-full"
      style={{ imageRendering: "auto" }}
    />
  );
}

interface LayerPanelProps {
  layers: LayerInfo[];
  activeIndex: number;
  canvasColor: string;
  canvasVisible: boolean;
  gradientGroups?: Record<string, Gradient[]>;
  onAdd: () => void;
  onAddGradientMap: () => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
  onOpacityChange: (index: number, opacity: number) => void;
  onBlendModeChange: (index: number, mode: number) => void;
  onRename: (index: number, name: string) => void;
  onMoveLayer: (fromIndex: number, toIndex: number) => void;
  onToggleLayerVisible: (index: number) => void;
  onCanvasColorChange: (hex: string) => void;
  onToggleCanvasVisible: () => void;
  onGradientMapGradientChange?: (layerIndex: number, gradientId: string) => void;
}

export function LayerPanel({
  layers,
  activeIndex,
  canvasColor,
  canvasVisible,
  onAdd,
  onAddGradientMap,
  onRemove,
  onSelect,
  onOpacityChange,
  onBlendModeChange,
  onRename,
  onMoveLayer,
  onToggleLayerVisible,
  onCanvasColorChange,
  onToggleCanvasVisible,
  gradientGroups,
  onGradientMapGradientChange,
}: LayerPanelProps) {
  const activeLayer = layers[activeIndex];
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      setDragIndex(index);
      dragNodeRef.current = e.currentTarget;
      e.dataTransfer.effectAllowed = "move";
      // Use a timeout so the drag image captures the element before we add styling
      requestAnimationFrame(() => {
        if (dragNodeRef.current) {
          dragNodeRef.current.style.opacity = "0.4";
        }
      });
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = "";
    }
    setDragIndex(null);
    setDropTarget(null);
    dragNodeRef.current = null;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIndex !== null && index !== dragIndex) {
        setDropTarget(index);
      }
    },
    [dragIndex],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== index) {
        onMoveLayer(dragIndex, index);
      }
      setDragIndex(null);
      setDropTarget(null);
    },
    [dragIndex, onMoveLayer],
  );
  return (
    <div className="flex flex-col gap-2 px-4 py-4 flex-1 border-t border-graphite-850">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
          Layers
        </h3>
        <div className="flex gap-0.5">
          <button
            onClick={onAdd}
            title="New layer"
            className="p-1.5 rounded-lg text-cream-muted hover:text-cream
              hover:bg-graphite-800 transition-all duration-150 cursor-pointer"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                title="Add adjustment layer"
                className="p-1.5 rounded-lg text-cream-muted hover:text-cream
                  hover:bg-graphite-800 transition-all duration-150 cursor-pointer"
              >
                <Blend size={14} strokeWidth={2} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="left"
                sideOffset={8}
                className="z-50 rounded-xl bg-graphite-900 border border-graphite-750
                  p-1 shadow-panel min-w-[160px]"
              >
                <button
                  onClick={onAddGradientMap}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-[12px] text-cream-dim
                    hover:bg-graphite-800 hover:text-cream transition-all duration-150 cursor-pointer
                    flex items-center gap-2"
                >
                  <Blend size={12} strokeWidth={1.75} />
                  Gradient Map
                </button>
                <Popover.Arrow className="fill-graphite-750" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
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
              title={`${Math.round(activeLayer.opacity * 100)}%`}
              className="flex-1 accent-cream-muted h-1.5 min-w-0"
            />
          </div>
          {activeLayer.kind === "gradient-map" && gradientGroups && onGradientMapGradientChange && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-cream-muted whitespace-nowrap">
                Gradient
              </label>
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button className="flex-1 h-5 rounded-md overflow-hidden cursor-pointer ring-1 ring-graphite-750 hover:ring-cream-muted transition-all duration-150">
                    {(() => {
                      const allGradients = Object.values(gradientGroups).flat();
                      const active = allGradients.find((g) => g.id === activeLayer.gradientId);
                      if (!active) return <span className="text-[10px] text-cream-muted px-2">Select...</span>;
                      return <GradientPickerInlinePreview gradient={active} />;
                    })()}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="left"
                    sideOffset={12}
                    className="z-50 rounded-xl bg-graphite-900 border border-graphite-750
                      p-3 shadow-panel w-52"
                  >
                    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                      {Object.entries(gradientGroups).map(([group, gradients]) => (
                        <div key={group} className="flex flex-col gap-1">
                          {Object.keys(gradientGroups).length > 1 && (
                            <span className="text-[10px] text-cream-muted tracking-wide sticky top-0 bg-graphite-900 py-0.5">
                              {group}
                            </span>
                          )}
                          {gradients.map((gradient) => (
                            <Popover.Close key={gradient.id} asChild>
                              <div>
                                <GradientPickerThumbnail
                                  gradient={gradient}
                                  isActive={gradient.id === activeLayer.gradientId}
                                  onSelect={() => onGradientMapGradientChange(activeIndex, gradient.id)}
                                />
                              </div>
                            </Popover.Close>
                          ))}
                        </div>
                      ))}
                    </div>
                    <Popover.Arrow className="fill-graphite-750" />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {[...layers].reverse().map((layer, reversedIdx) => {
          const index = layers.length - 1 - reversedIdx;
          const isActive = index === activeIndex;
          return (
            <div
              key={layer.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-1.5 px-1 py-2 rounded-lg
                text-left text-[12px] transition-all duration-150 cursor-pointer
                ${
                  isActive
                    ? "bg-graphite-800 text-cream shadow-soft"
                    : "text-cream-dim hover:bg-graphite-850"
                }
                ${dropTarget === index && dragIndex !== null ? "ring-1 ring-cream-muted" : ""}`}
            >
              <span className="text-graphite-600 cursor-grab active:cursor-grabbing shrink-0">
                <GripVertical size={12} strokeWidth={1.5} />
              </span>
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
              {editingIndex === index ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editName.trim()) onRename(index, editName.trim());
                      setEditingIndex(null);
                    }
                    if (e.key === "Escape") setEditingIndex(null);
                    e.stopPropagation();
                  }}
                  onBlur={() => {
                    if (editName.trim()) onRename(index, editName.trim());
                    setEditingIndex(null);
                  }}
                  autoFocus
                  className="flex-1 bg-graphite-850 text-cream text-[12px] px-1.5 py-0
                    rounded border border-graphite-700 outline-none
                    focus:border-warm-accent min-w-0"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex items-center gap-1 flex-1 min-w-0">
                  {layer.kind !== "raster" && (
                    <Blend size={11} strokeWidth={1.75} className="shrink-0 text-cream-muted" />
                  )}
                  <span
                    className="flex-1 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingIndex(index);
                      setEditName(layer.name);
                    }}
                  >
                    {layer.name}
                  </span>
                </span>
              )}
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
              <OklchColorPicker color={canvasColor} onChange={onCanvasColorChange} />
              <Popover.Arrow className="fill-graphite-750" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        </div>
      </div>
    </div>
  );
}
