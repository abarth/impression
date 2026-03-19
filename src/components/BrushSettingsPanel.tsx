import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { SliderControl } from "./SliderControl";
import type { BrushSettings, DynamicParam, DynamicControl } from "../hooks/useBrushSettings";

interface BrushSettingsPanelProps {
  settings: BrushSettings;
  toolLabel?: string;
  onUpdate: <K extends keyof BrushSettings>(
    key: K,
    value: BrushSettings[K],
  ) => void;
}

const CONTROL_LABELS: Record<DynamicControl, string> = {
  0: "Off",
  1: "Pen Pressure",
  2: "Random",
};

function DynamicParamControl({
  label,
  param,
  onChange,
  showMinimum,
}: {
  label: string;
  param: DynamicParam;
  onChange: (p: DynamicParam) => void;
  showMinimum?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center gap-2">
        <span className="text-[12px] text-cream-dim shrink-0">{label}</span>
        <select
          value={param.control}
          onChange={(e) =>
            onChange({ ...param, control: Number(e.target.value) as DynamicControl })
          }
          className="text-[11px] bg-graphite-850 text-cream-dim border border-graphite-800 rounded px-1.5 py-0.5 outline-none focus:border-graphite-600 transition-colors duration-150"
        >
          <option value={0}>{CONTROL_LABELS[0]}</option>
          <option value={1}>{CONTROL_LABELS[1]}</option>
          <option value={2}>{CONTROL_LABELS[2]}</option>
        </select>
      </div>
      {param.control !== 0 && (
        <>
          <SliderControl
            label="Jitter"
            value={param.jitter}
            min={0}
            max={1.0}
            step={0.01}
            displayValue={`${Math.round(param.jitter * 100)}%`}
            onChange={(v) => onChange({ ...param, jitter: v })}
          />
          {showMinimum !== false && (
            <SliderControl
              label="Minimum"
              value={param.minimum}
              min={0}
              max={1.0}
              step={0.01}
              displayValue={`${Math.round(param.minimum * 100)}%`}
              onChange={(v) => onChange({ ...param, minimum: v })}
            />
          )}
        </>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] font-medium text-cream-muted tracking-wide uppercase py-1 hover:text-cream-dim transition-colors duration-150"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {title}
      </button>
      {open && <div className="flex flex-col gap-3 pt-2 pl-1">{children}</div>}
    </div>
  );
}

export function BrushSettingsPanel({
  settings,
  toolLabel = "Brush",
  onUpdate,
}: BrushSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-5">
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
          label="Hardness"
          value={settings.hardness}
          min={0}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.hardness * 100)}%`}
          onChange={(v) => onUpdate("hardness", v)}
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
          label="Roundness"
          value={settings.roundness}
          min={0.01}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.roundness * 100)}%`}
          onChange={(v) => onUpdate("roundness", v)}
        />
        <SliderControl
          label="Angle"
          value={settings.angle}
          min={0}
          max={360}
          step={1}
          displayValue={`${Math.round(settings.angle)}°`}
          onChange={(v) => onUpdate("angle", v)}
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
        <SliderControl
          label="Smoothing"
          value={settings.smoothing}
          min={0}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.smoothing * 100)}%`}
          onChange={(v) => onUpdate("smoothing", v)}
        />
      </div>

      <CollapsibleSection title="Shape Dynamics">
        <DynamicParamControl
          label="Size"
          param={settings.shapeDynamics.size}
          onChange={(p) =>
            onUpdate("shapeDynamics", { ...settings.shapeDynamics, size: p })
          }
        />
        <DynamicParamControl
          label="Angle"
          param={settings.shapeDynamics.angle}
          onChange={(p) =>
            onUpdate("shapeDynamics", { ...settings.shapeDynamics, angle: p })
          }
          showMinimum={false}
        />
        <DynamicParamControl
          label="Roundness"
          param={settings.shapeDynamics.roundness}
          onChange={(p) =>
            onUpdate("shapeDynamics", { ...settings.shapeDynamics, roundness: p })
          }
        />
      </CollapsibleSection>

      <CollapsibleSection title="Transfer Dynamics">
        <DynamicParamControl
          label="Opacity"
          param={settings.transferDynamics.opacity}
          onChange={(p) =>
            onUpdate("transferDynamics", {
              ...settings.transferDynamics,
              opacity: p,
            })
          }
        />
        <DynamicParamControl
          label="Flow"
          param={settings.transferDynamics.flow}
          onChange={(p) =>
            onUpdate("transferDynamics", {
              ...settings.transferDynamics,
              flow: p,
            })
          }
        />
      </CollapsibleSection>
    </div>
  );
}
