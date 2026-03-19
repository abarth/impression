import { useRef } from "react";
import type { BrushPreset } from "../brushPresets";

interface BrushPickerProps {
  groups: Record<string, BrushPreset[]>;
  activePresetId: string | null;
  onSelect: (id: string) => void;
  onImportAbr?: (file: File) => void;
}

function PresetThumbnail({
  preset,
  isActive,
  onSelect,
}: {
  preset: BrushPreset;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 ease-out ${isActive
        ? "bg-graphite-700 ring-1 ring-cream-muted"
        : "bg-graphite-850 hover:bg-graphite-800"
        }`}
      onClick={onSelect}
      title={preset.name}
    >
      <div
        className="rounded-full bg-cream"
        style={{
          width: Math.max(4, Math.min(20, preset.size * 0.6)),
          height: Math.max(
            4,
            Math.min(20, preset.size * 0.6 * preset.roundness),
          ),
          opacity:
            preset.tip.type === "computed"
              ? 0.4 + preset.tip.hardness * 0.6
              : 1,
          transform:
            preset.angle !== 0 ? `rotate(${preset.angle}deg)` : undefined,
        }}
      />
    </button>
  );
}

export function BrushPicker({
  groups,
  activePresetId,
  onSelect,
  onImportAbr,
}: BrushPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupNames = Object.keys(groups);
  if (groupNames.length === 0 && !onImportAbr) return null;

  return (
    <div className="flex flex-col gap-3 px-4 pt-4 pb-3 border-t border-graphite-850">
      <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
        Brush Picker
      </h3>
      {groupNames.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          {groupNames.length > 1 && (
            <span className="text-[10px] text-cream-muted tracking-wide">
              {group}
            </span>
          )}
          <div className="flex flex-wrap gap-1.5">
            {groups[group].map((preset) => (
              <PresetThumbnail
                key={preset.id}
                preset={preset}
                isActive={preset.id === activePresetId}
                onSelect={() => onSelect(preset.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {onImportAbr && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".abr"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportAbr(file);
              e.target.value = "";
            }}
          />
          <button
            className="text-[11px] text-cream-muted hover:text-cream transition-colors duration-150 text-left"
            onClick={() => fileInputRef.current?.click()}
          >
            Import ABR...
          </button>
        </>
      )}
    </div>
  );
}
