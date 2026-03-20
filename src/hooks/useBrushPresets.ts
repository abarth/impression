import { useState, useCallback, useEffect, useRef } from "react";
import type { BrushPreset } from "../brushPresets";
import type { BrushSettings } from "./useBrushSettings";
import type { Engine } from "../engine";
import type { Storage } from "../storage";
import type { Tool } from "./useTool";
import { parseAbrFile } from "../abrParser";

type ToolWithSettings = "brush" | "eraser";

function isToolWithSettings(tool: Tool): tool is ToolWithSettings {
  return tool === "brush" || tool === "eraser";
}

interface UseBrushPresetsOptions {
  engine: Engine | null;
  storage: Storage | null;
  activeTool: Tool;
  onApplyPreset: (partial: Partial<BrushSettings>) => void;
}

export function useBrushPresets({
  engine,
  storage,
  activeTool,
  onApplyPreset,
}: UseBrushPresetsOptions) {
  const [presets, setPresets] = useState<BrushPreset[]>([]);
  const [activePresetIds, setActivePresetIds] = useState<
    Record<ToolWithSettings, string | null>
  >({ brush: null, eraser: null });

  const storageRef = useRef(storage);
  storageRef.current = storage;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  /** Track which tip IDs have been registered with the engine to avoid redundant loads. */
  const registeredTipsRef = useRef(new Set<string>());

  // Load presets from IndexedDB on mount
  useEffect(() => {
    if (!storage) return;
    storage.listPresets().then((list) => {
      list.sort((a, b) => a.sort_order - b.sort_order);
      setPresets(list);
    });
  }, [storage]);

  const currentTool: ToolWithSettings = isToolWithSettings(activeTool)
    ? activeTool
    : "brush";
  const activePresetId = activePresetIds[currentTool];

  /** Load and activate a brush tip image for the given preset. */
  const activateTip = useCallback(async (preset: BrushPreset) => {
    const eng = engineRef.current;
    if (!eng) return;

    if (preset.tip.type === "image") {
      const tipId = preset.tip.tipId;
      // Register the tip if not already done
      if (!registeredTipsRef.current.has(tipId)) {
        const s = storageRef.current;
        if (!s) return;
        const tip = await s.getTip(tipId);
        if (!tip) return;
        eng.registerBrushTip(tipId, tip.pixels, tip.width, tip.height);
        registeredTipsRef.current.add(tipId);
      }
      eng.setBrushTip(tipId);
    } else {
      eng.clearBrushTip();
    }
  }, []);

  // Re-activate the current tool's brush tip when switching tools
  const prevToolRef = useRef(currentTool);
  useEffect(() => {
    if (prevToolRef.current === currentTool) return;
    prevToolRef.current = currentTool;
    const presetId = activePresetIds[currentTool];
    if (!presetId) {
      // No preset selected for this tool — ensure computed tip
      engineRef.current?.clearBrushTip();
      return;
    }
    const preset = presets.find((p) => p.id === presetId);
    if (preset) activateTip(preset);
  }, [currentTool, activePresetIds, presets, activateTip]);

  const selectPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;

      const tool = isToolWithSettings(activeTool) ? activeTool : "brush";
      setActivePresetIds((prev) => ({ ...prev, [tool]: id }));

      const partial: Partial<BrushSettings> = {
        size: preset.size,
        spacing: preset.spacing,
        roundness: preset.roundness,
        angle: preset.angle,
      };
      if (preset.tip.type === "computed") {
        partial.hardness = preset.tip.hardness;
      }
      if (preset.flow !== undefined) partial.flow = preset.flow;
      if (preset.opacity !== undefined) partial.opacity = preset.opacity;
      if (preset.shapeDynamics) partial.shapeDynamics = preset.shapeDynamics;
      if (preset.transferDynamics) partial.transferDynamics = preset.transferDynamics;
      if (preset.scatterSettings) partial.scatterSettings = preset.scatterSettings;
      if (preset.dualBrush) partial.dualBrush = preset.dualBrush;
      if (preset.texture) partial.texture = preset.texture;

      onApplyPreset(partial);
      activateTip(preset);
    },
    [presets, activeTool, onApplyPreset, activateTip],
  );

  const savePreset = useCallback(
    async (preset: BrushPreset) => {
      const s = storageRef.current;
      if (!s) return;
      await s.savePreset(preset);
      const list = await s.listPresets();
      list.sort((a, b) => a.sort_order - b.sort_order);
      setPresets(list);
    },
    [],
  );

  const deletePreset = useCallback(
    async (id: string) => {
      const s = storageRef.current;
      if (!s) return;
      await s.deletePreset(id);
      const list = await s.listPresets();
      list.sort((a, b) => a.sort_order - b.sort_order);
      setPresets(list);
    },
    [],
  );

  // Group presets for display
  const groups = presets.reduce<Record<string, BrushPreset[]>>(
    (acc, preset) => {
      if (!acc[preset.group]) acc[preset.group] = [];
      acc[preset.group].push(preset);
      return acc;
    },
    {},
  );

  const importAbr = useCallback(
    async (file: File) => {
      const s = storageRef.current;
      if (!s) return;

      const buffer = await file.arrayBuffer();
      const parsed = parseAbrFile(buffer);
      if (parsed.length === 0) return;

      const groupName = `Imported - ${file.name}`;
      const existingPresets = await s.listPresets();
      let maxOrder = existingPresets.reduce(
        (max, p) => Math.max(max, p.sort_order),
        -1,
      );

      for (const brush of parsed) {
        const presetId = crypto.randomUUID();
        maxOrder += 1;
        const p = brush.params;

        let tip: BrushPreset["tip"];
        if (brush.imageData && brush.width && brush.height) {
          const tipId = crypto.randomUUID();
          await s.saveTip({
            id: tipId,
            pixels: brush.imageData,
            width: brush.width,
            height: brush.height,
          });
          tip = { type: "image", tipId };
        } else {
          tip = { type: "computed", hardness: p?.hardness ?? 1.0 };
        }

        const preset: BrushPreset = {
          id: presetId,
          name: brush.name,
          group: groupName,
          tip,
          size: p?.diameter ?? (brush.width && brush.height ? Math.max(brush.width, brush.height) : 20),
          spacing: p?.spacing ?? 0.25,
          roundness: p?.roundness ?? 1.0,
          angle: p?.angle ?? 0,
          sort_order: maxOrder,
        };
        if (p?.opacity !== undefined) preset.opacity = p.opacity;
        if (p?.flow !== undefined) preset.flow = p.flow;
        if (p?.shapeDynamics) preset.shapeDynamics = p.shapeDynamics;
        if (p?.transferDynamics) preset.transferDynamics = p.transferDynamics;
        await s.savePreset(preset);
      }

      const list = await s.listPresets();
      list.sort((a, b) => a.sort_order - b.sort_order);
      setPresets(list);
    },
    [],
  );

  const activePreset = activePresetId ? presets.find((p) => p.id === activePresetId) : undefined;
  const isImageTip = activePreset?.tip.type === "image";

  return {
    presets,
    groups,
    activePresetId,
    isImageTip,
    selectPreset,
    savePreset,
    deletePreset,
    importAbr,
  };
}
