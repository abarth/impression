import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Settings2 } from "lucide-react";
import { SliderControl } from "./SliderControl";
import type { BrushSettings, DynamicParam, DynamicControl, ScatterSettings, DualBrushSettings, TextureSettings } from "../hooks/useBrushSettings";
import {
  DUAL_BRUSH_MODE_MULTIPLY,
  DUAL_BRUSH_MODE_DARKEN,
  DUAL_BRUSH_MODE_LIGHTEN,
  DUAL_BRUSH_MODE_SUBTRACT,
  DUAL_BRUSH_MODE_LINEAR_DODGE,
  DUAL_BRUSH_MODE_SCREEN,
} from "../hooks/useBrushSettings";

interface BrushSettingsPanelProps {
  settings: BrushSettings;
  toolLabel?: string;
  isImageTip?: boolean;
  onUpdate: <K extends keyof BrushSettings>(
    key: K,
    value: BrushSettings[K],
  ) => void;
}

const CONTROL_LABELS: Record<number, string> = {
  0: "Off",
  1: "Pen Pressure",
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
        </select>
      </div>
      <SliderControl
        label="Jitter"
        value={param.jitter}
        min={0}
        max={1.0}
        step={0.01}
        displayValue={`${Math.round(param.jitter * 100)}%`}
        onChange={(v) => onChange({ ...param, jitter: v })}
      />
      {showMinimum !== false && param.control === 1 && (
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
    </div>
  );
}

// -- Brush Settings Popover (Photoshop-style F5 panel) --

type Category = "tip" | "shapeDynamics" | "transfer" | "scattering" | "dualBrush" | "texture";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "tip", label: "Brush Tip Shape" },
  { id: "shapeDynamics", label: "Shape Dynamics" },
  { id: "transfer", label: "Transfer" },
  { id: "scattering", label: "Scattering" },
  { id: "dualBrush", label: "Dual Brush" },
  { id: "texture", label: "Texture" },
];

function BrushTipPane({ settings, isImageTip, onUpdate }: BrushSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-3.5">
      {!isImageTip && (
        <SliderControl
          label="Hardness"
          value={settings.hardness}
          min={0}
          max={1.0}
          step={0.01}
          displayValue={`${Math.round(settings.hardness * 100)}%`}
          onChange={(v) => onUpdate("hardness", v)}
        />
      )}
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
        label="Smoothing"
        value={settings.smoothing}
        min={0}
        max={1.0}
        step={0.01}
        displayValue={`${Math.round(settings.smoothing * 100)}%`}
        onChange={(v) => onUpdate("smoothing", v)}
      />
      <div className="flex gap-2">
        <button
          onClick={() => onUpdate("flipX", !settings.flipX)}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border transition-colors duration-150
            ${settings.flipX
              ? "bg-graphite-800 border-graphite-700 text-cream"
              : "bg-graphite-850 border-graphite-800 text-cream-muted hover:bg-graphite-800"
            }`}
        >
          Flip X
        </button>
        <button
          onClick={() => onUpdate("flipY", !settings.flipY)}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border transition-colors duration-150
            ${settings.flipY
              ? "bg-graphite-800 border-graphite-700 text-cream"
              : "bg-graphite-850 border-graphite-800 text-cream-muted hover:bg-graphite-800"
            }`}
        >
          Flip Y
        </button>
      </div>
    </div>
  );
}

function ShapeDynamicsPane({ settings, onUpdate }: BrushSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}

function TransferPane({ settings, onUpdate }: BrushSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <DynamicParamControl
        label="Opacity"
        param={settings.transferDynamics.opacity}
        onChange={(p) =>
          onUpdate("transferDynamics", { ...settings.transferDynamics, opacity: p })
        }
      />
      <DynamicParamControl
        label="Flow"
        param={settings.transferDynamics.flow}
        onChange={(p) =>
          onUpdate("transferDynamics", { ...settings.transferDynamics, flow: p })
        }
      />
    </div>
  );
}

function ScatteringPane({ settings, onUpdate }: BrushSettingsPanelProps) {
  const sc = settings.scatterSettings;
  const update = (partial: Partial<ScatterSettings>) =>
    onUpdate("scatterSettings", { ...sc, ...partial });
  return (
    <div className="flex flex-col gap-3.5">
      <SliderControl
        label="Scatter"
        value={sc.scatter}
        min={0}
        max={10.0}
        step={0.01}
        displayValue={`${Math.round(sc.scatter * 100)}%`}
        onChange={(v) => update({ scatter: v })}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => update({ bothAxes: !sc.bothAxes })}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border transition-colors duration-150
            ${sc.bothAxes
              ? "bg-graphite-800 border-graphite-700 text-cream"
              : "bg-graphite-850 border-graphite-800 text-cream-muted hover:bg-graphite-800"
            }`}
        >
          Both Axes
        </button>
      </div>
      <SliderControl
        label="Count"
        value={sc.count}
        min={1}
        max={16}
        step={1}
        displayValue={`${sc.count}`}
        onChange={(v) => update({ count: Math.round(v) })}
      />
      <SliderControl
        label="Count Jitter"
        value={sc.countJitter}
        min={0}
        max={1.0}
        step={0.01}
        displayValue={`${Math.round(sc.countJitter * 100)}%`}
        onChange={(v) => update({ countJitter: v })}
      />
    </div>
  );
}

function DualBrushPane({ settings, onUpdate }: BrushSettingsPanelProps) {
  const db = settings.dualBrush;
  const update = (partial: Partial<DualBrushSettings>) =>
    onUpdate("dualBrush", { ...db, ...partial });
  return (
    <div className="flex flex-col gap-3.5">
      <button
        onClick={() => update({ enabled: !db.enabled })}
        className={`px-2 py-1.5 text-[11px] rounded border transition-colors duration-150
          ${db.enabled
            ? "bg-graphite-800 border-graphite-700 text-cream"
            : "bg-graphite-850 border-graphite-800 text-cream-muted hover:bg-graphite-800"
          }`}
      >
        {db.enabled ? "Dual Brush On" : "Dual Brush Off"}
      </button>
      {db.enabled && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-cream-muted uppercase tracking-wider shrink-0">Mode</span>
            <select
              value={db.mode}
              onChange={(e) => update({ mode: Number(e.target.value) })}
              className="flex-1 bg-graphite-850 border border-graphite-800 text-cream text-[11px] rounded px-1.5 py-1 outline-none focus:border-graphite-700 transition-colors duration-150"
            >
              <option value={DUAL_BRUSH_MODE_MULTIPLY}>Multiply</option>
              <option value={DUAL_BRUSH_MODE_DARKEN}>Darken</option>
              <option value={DUAL_BRUSH_MODE_LIGHTEN}>Lighten</option>
              <option value={DUAL_BRUSH_MODE_SUBTRACT}>Subtract</option>
              <option value={DUAL_BRUSH_MODE_LINEAR_DODGE}>Linear Dodge</option>
              <option value={DUAL_BRUSH_MODE_SCREEN}>Screen</option>
            </select>
          </div>
          <SliderControl
            label="Size"
            value={db.size}
            min={1}
            max={100}
            step={1}
            displayValue={`${Math.round(db.size)}px`}
            onChange={(v) => update({ size: v })}
          />
          <SliderControl
            label="Spacing"
            value={db.spacing}
            min={0.01}
            max={2.0}
            step={0.01}
            displayValue={`${Math.round(db.spacing * 100)}%`}
            onChange={(v) => update({ spacing: v })}
          />
          <SliderControl
            label="Hardness"
            value={db.hardness}
            min={0}
            max={1.0}
            step={0.01}
            displayValue={`${Math.round(db.hardness * 100)}%`}
            onChange={(v) => update({ hardness: v })}
          />
        </>
      )}
    </div>
  );
}

function TexturePane({ settings, onUpdate }: BrushSettingsPanelProps) {
  const tx = settings.texture;
  const update = (partial: Partial<TextureSettings>) =>
    onUpdate("texture", { ...tx, ...partial });
  return (
    <div className="flex flex-col gap-3.5">
      <button
        onClick={() => update({ enabled: !tx.enabled })}
        className={`px-2 py-1.5 text-[11px] rounded border transition-colors duration-150
          ${tx.enabled
            ? "bg-graphite-800 border-graphite-700 text-cream"
            : "bg-graphite-850 border-graphite-800 text-cream-muted hover:bg-graphite-800"
          }`}
      >
        {tx.enabled ? "Texture On" : "Texture Off"}
      </button>
      {tx.enabled && (
        <>
          <SliderControl
            label="Scale"
            value={tx.scale}
            min={1}
            max={1000}
            step={1}
            displayValue={`${Math.round(tx.scale)}%`}
            onChange={(v) => update({ scale: v })}
          />
          <SliderControl
            label="Depth"
            value={tx.depth}
            min={0}
            max={1.0}
            step={0.01}
            displayValue={`${Math.round(tx.depth * 100)}%`}
            onChange={(v) => update({ depth: v })}
          />
          <button
            onClick={() => update({ textureEachTip: !tx.textureEachTip })}
            className={`px-2 py-1.5 text-[11px] rounded border transition-colors duration-150
              ${tx.textureEachTip
                ? "bg-graphite-800 border-graphite-700 text-cream"
                : "bg-graphite-850 border-graphite-800 text-cream-muted hover:bg-graphite-800"
              }`}
          >
            Texture Each Tip
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Brush properties popover — Photoshop-style brush settings panel.
 * Left sidebar with category navigation, right pane with controls.
 */
export function BrushSettingsPanel({
  settings,
  isImageTip,
  onUpdate,
}: BrushSettingsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("tip");

  return (
    <div className="px-4 pb-3">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            className="flex items-center gap-1.5 text-[11px] font-medium text-cream-muted tracking-wide uppercase
              hover:text-cream-dim transition-colors duration-150"
          >
            <Settings2 size={13} />
            Brush Settings
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="left"
            sideOffset={8}
            align="start"
            className="flex bg-graphite-900 rounded-xl shadow-soft border border-graphite-850
              w-[380px] h-[320px] overflow-hidden z-50
              data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            {/* Category nav */}
            <div className="flex flex-col w-[130px] shrink-0 border-r border-graphite-850 py-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`text-left text-[11px] px-3 py-1.5 transition-colors duration-100
                    ${activeCategory === cat.id
                      ? "bg-graphite-800 text-cream"
                      : "text-cream-muted hover:text-cream-dim hover:bg-graphite-850"
                    }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Detail pane */}
            <div className="flex-1 overflow-y-auto p-4">
              <h4 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase mb-4">
                {CATEGORIES.find((c) => c.id === activeCategory)?.label}
              </h4>
              {activeCategory === "tip" && (
                <BrushTipPane settings={settings} isImageTip={isImageTip} onUpdate={onUpdate} />
              )}
              {activeCategory === "shapeDynamics" && (
                <ShapeDynamicsPane settings={settings} onUpdate={onUpdate} />
              )}
              {activeCategory === "transfer" && (
                <TransferPane settings={settings} onUpdate={onUpdate} />
              )}
              {activeCategory === "scattering" && (
                <ScatteringPane settings={settings} onUpdate={onUpdate} />
              )}
              {activeCategory === "dualBrush" && (
                <DualBrushPane settings={settings} onUpdate={onUpdate} />
              )}
              {activeCategory === "texture" && (
                <TexturePane settings={settings} onUpdate={onUpdate} />
              )}
            </div>

            <Popover.Arrow className="fill-graphite-850" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
