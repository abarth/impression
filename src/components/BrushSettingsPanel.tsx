import { SliderControl } from "./SliderControl";
import type { BrushSettings } from "../hooks/useBrushSettings";

interface BrushSettingsPanelProps {
  settings: BrushSettings;
  onUpdate: <K extends keyof BrushSettings>(
    key: K,
    value: BrushSettings[K],
  ) => void;
}

export function BrushSettingsPanel({
  settings,
  onUpdate,
}: BrushSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
        Brush
      </h3>
      <div className="flex flex-col gap-3.5">
        <SliderControl
          label="Size"
          value={settings.size}
          min={1}
          max={200}
          step={1}
          displayValue={`${Math.round(settings.size)} px`}
          onChange={(v) => onUpdate("size", v)}
        />
        <SliderControl
          label="Spacing"
          value={settings.spacing}
          min={0.01}
          max={2.0}
          step={0.01}
          displayValue={`${Math.round(settings.spacing * 100)}%`}
          onChange={(v) => onUpdate("spacing", v)}
        />
        <SliderControl
          label="Flow"
          value={settings.flow}
          min={0.01}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.flow * 100)}%`}
          onChange={(v) => onUpdate("flow", v)}
        />
        <SliderControl
          label="Opacity"
          value={settings.opacity}
          min={0.01}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.opacity * 100)}%`}
          onChange={(v) => onUpdate("opacity", v)}
        />
      </div>
    </div>
  );
}
