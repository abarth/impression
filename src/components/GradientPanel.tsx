import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Gradient } from "../gradient";
import { rasterizeGradient } from "../gradient";
import type { ImportResult } from "../hooks/useGradientPresets";
import { ImportErrorDialog } from "./ImportErrorDialog";

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
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), 256, 1);
    ctx.putImageData(imageData, 0, 0);
  }, [gradient]);

  return (
    <button
      className={`w-full h-5 rounded-md overflow-hidden transition-all duration-150 ease-out cursor-pointer shrink-0 ${
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
  onImportGrd?: (file: File) => Promise<ImportResult>;
}

export function GradientPanel({
  groups,
  activeGradientId,
  onSelect,
  onImportGrd,
}: GradientPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const groupNames = Object.keys(groups);
  if (groupNames.length === 0 && !onImportGrd) return null;

  const activeName = Object.values(groups)
    .flat()
    .find((g) => g.id === activeGradientId)?.name;

  return (
    <div className="flex flex-col border-t border-graphite-850">
      <button
        className="flex items-center gap-1.5 px-4 pt-4 pb-2 cursor-pointer hover:bg-graphite-850/50 transition-all duration-150"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={2} className="text-cream-muted shrink-0" />
        ) : (
          <ChevronDown size={12} strokeWidth={2} className="text-cream-muted shrink-0" />
        )}
        <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
          Gradients
        </h3>
        {activeName && (
          <span className="text-[10px] text-cream-muted/60 truncate ml-auto">
            {activeName}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-3 px-4 pb-3">
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {groupNames.map((group) => (
              <div key={group} className="flex flex-col gap-1.5">
                {groupNames.length > 1 && (
                  <span className="text-[10px] text-cream-muted tracking-wide sticky top-0 bg-graphite-900 py-0.5">
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
          </div>
          {onImportGrd && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".grd"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const result = await onImportGrd(file);
                    if (!result.success) {
                      setImportError(result.error ?? "Import failed.");
                    }
                  }
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
      )}
      <ImportErrorDialog
        open={importError !== null}
        onClose={() => setImportError(null)}
        title="Gradient Import Failed"
        message={importError ?? ""}
      />
    </div>
  );
}
