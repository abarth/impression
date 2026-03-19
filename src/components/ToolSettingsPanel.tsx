import { SliderControl } from "./SliderControl";
import type { BrushSettings } from "../hooks/useBrushSettings";

interface ToolSettingsPanelProps {
  settings: BrushSettings;
  toolLabel?: string;
  onUpdate: <K extends keyof BrushSettings>(
    key: K,
    value: BrushSettings[K],
  ) => void;
}

/**
 * Tool settings: Size, Opacity, Flow — the controls users adjust frequently.
 */
export function ToolSettingsPanel({
  settings,
  toolLabel = "Brush",
  onUpdate,
}: ToolSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-4">
      <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
        {toolLabel}
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
          label="Opacity"
          value={settings.opacity}
          min={0.01}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.opacity * 100)}%`}
          onChange={(v) => onUpdate("opacity", v)}
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
      </div>
    </div>
  );
}
