import { useState, useCallback, useEffect, useRef } from "react";
import type { BrushPreset } from "../brushPresets";
import type { BrushSettings } from "./useBrushSettings";
import type { Storage } from "../storage";
import type { Tool } from "./useTool";
import { parseAbrFile } from "../abrParser";

type ToolWithSettings = "brush" | "eraser";

function isToolWithSettings(tool: Tool): tool is ToolWithSettings {
  return tool === "brush" || tool === "eraser";
}

interface UseBrushPresetsOptions {
  storage: Storage | null;
  activeTool: Tool;
  onApplyPreset: (partial: Partial<BrushSettings>) => void;
}

export function useBrushPresets({
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

      onApplyPreset(partial);
    },
    [presets, activeTool, onApplyPreset],
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
        const tipId = crypto.randomUUID();
        await s.saveTip({
          id: tipId,
          pixels: brush.imageData,
          width: brush.width,
          height: brush.height,
        });

        const presetId = crypto.randomUUID();
        maxOrder += 1;
        await s.savePreset({
          id: presetId,
          name: brush.name,
          group: groupName,
          tip: { type: "image", tipId },
          size: Math.max(brush.width, brush.height),
          spacing: 0.25,
          roundness: 1.0,
          angle: 0,
          sort_order: maxOrder,
        });
      }

      const list = await s.listPresets();
      list.sort((a, b) => a.sort_order - b.sort_order);
      setPresets(list);
    },
    [],
  );

  return {
    presets,
    groups,
    activePresetId,
    selectPreset,
    savePreset,
    deletePreset,
    importAbr,
  };
}
