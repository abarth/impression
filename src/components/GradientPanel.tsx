import { useRef, useEffect, useCallback } from "react";
import type { Gradient } from "../gradient";
import { rasterizeGradient } from "../gradient";

interface GradientThumbnailProps {
  gradient: Gradient;
  isActive: boolean;
  onSelect: () => void;
}

function GradientThumbnail({ gradient, isActive, onSelect }: GradientThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = rasterizeGradient(gradient);
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer), 256, 1);
    ctx.putImageData(imageData, 0, 0);
  }, [gradient]);

  return (
    <button
      className={`w-full h-5 rounded-md overflow-hidden transition-all duration-150 ease-out cursor-pointer ${
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

interface GradientPanelProps {
  groups: Record<string, Gradient[]>;
  activeGradientId: string | null;
  onSelect: (id: string) => void;
  onImportGrd?: (file: File) => void;
}

export function GradientPanel({
  groups,
  activeGradientId,
  onSelect,
  onImportGrd,
}: GradientPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupNames = Object.keys(groups);
  if (groupNames.length === 0 && !onImportGrd) return null;

  const activeName = Object.values(groups)
    .flat()
    .find((g) => g.id === activeGradientId)?.name;

  return (
    <div className="flex flex-col gap-3 px-4 pt-4 pb-3 border-t border-graphite-850">
      <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
        {activeName ?? "Gradients"}
      </h3>
      {groupNames.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          {groupNames.length > 1 && (
            <span className="text-[10px] text-cream-muted tracking-wide">
              {group}
            </span>
          )}
          <div className="flex flex-col gap-1">
            {groups[group].map((gradient) => (
              <GradientThumbnail
                key={gradient.id}
                gradient={gradient}
                isActive={gradient.id === activeGradientId}
                onSelect={() => onSelect(gradient.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {onImportGrd && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".grd"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportGrd(file);
              e.target.value = "";
            }}
          />
          <button
            className="text-[11px] text-cream-muted hover:text-cream transition-colors duration-150 text-left cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            Import GRD...
          </button>
        </>
      )}
    </div>
  );
}
