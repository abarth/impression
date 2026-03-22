import { useState, useCallback, useEffect, useRef } from "react";
import type { BrushPreset } from "../brushPresets";
import type { BrushSettings } from "./useBrushSettings";
import type { Engine } from "../engine";
import type { Storage } from "../storage";
import type { Tool } from "./useTool";
import type { ImportResult } from "./useGradientPresets";
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
  /** Register and activate a sampled tip on the engine if needed. */
  const ensureTipRegistered = useCallback(async (tipId: string, presetName: string): Promise<boolean> => {
    const eng = engineRef.current;
    if (!eng) return false;
    if (registeredTipsRef.current.has(tipId)) return true;
    const s = storageRef.current;
    if (!s) return false;
    const tip = await s.getTip(tipId);
    if (!tip) {
      console.warn(`Brush tip "${presetName}" (${tipId}) not found in storage.`);
      return false;
    }
    eng.registerBrushTip(tipId, tip.pixels, tip.width, tip.height);
    registeredTipsRef.current.add(tipId);
    eng.embedResource("brush-tip", tipId, {
      id: tipId,
      pixels: tip.pixels,
      width: tip.width,
      height: tip.height,
    });
    return true;
  }, []);

  const activateTip = useCallback(async (preset: BrushPreset) => {
    const eng = engineRef.current;
    if (!eng) return;

    // Primary tip
    if (preset.tip.type === "image") {
      const ok = await ensureTipRegistered(preset.tip.tipId, preset.name);
      if (ok) {
        eng.setBrushTip(preset.tip.tipId);
      } else {
        eng.clearBrushTip();
      }
    } else {
      eng.clearBrushTip();
    }

    // Secondary (dual brush) tip
    if (preset.dualBrush?.tipId) {
      const ok = await ensureTipRegistered(preset.dualBrush.tipId, `${preset.name} (dual)`);
      if (ok) {
        eng.setSecondaryBrushTip(preset.dualBrush.tipId);
      } else {
        eng.clearSecondaryBrushTip();
      }
    } else {
      eng.clearSecondaryBrushTip();
    }
  }, [ensureTipRegistered]);

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
      if (preset.flipX) partial.flipX = preset.flipX;
      if (preset.flipY) partial.flipY = preset.flipY;
      if (preset.smoothing !== undefined) partial.smoothing = preset.smoothing;

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
    async (file: File): Promise<ImportResult> => {
      const s = storageRef.current;
      if (!s) return { success: false, count: 0, error: "Storage not available." };

      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        return { success: false, count: 0, error: "Could not read the file." };
      }

      let parsed;
      try {
        parsed = parseAbrFile(buffer);
      } catch (e) {
        return {
          success: false,
          count: 0,
          error: `Failed to parse "${file.name}": ${e instanceof Error ? e.message : "unknown error"}.`,
        };
      }

      if (parsed.length === 0) {
        return {
          success: false,
          count: 0,
          error: `No brushes found in "${file.name}". The file may be empty or in an unsupported format.`,
        };
      }

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

        // Save dual brush tip if present
        if (brush.dualImageData && brush.dualWidth && brush.dualHeight && p?.dualBrush) {
          const dualTipId = crypto.randomUUID();
          await s.saveTip({
            id: dualTipId,
            pixels: brush.dualImageData,
            width: brush.dualWidth,
            height: brush.dualHeight,
          });
          p.dualBrush = { ...p.dualBrush, tipId: dualTipId, useComputed: false };
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
        if (p?.smoothing !== undefined) preset.smoothing = p.smoothing;
        if (p?.shapeDynamics) preset.shapeDynamics = p.shapeDynamics;
        if (p?.transferDynamics) preset.transferDynamics = p.transferDynamics;
        if (p?.dualBrush) preset.dualBrush = p.dualBrush;
        if (p?.scatterSettings) preset.scatterSettings = p.scatterSettings;
        if (p?.texture) preset.texture = p.texture;
        if (p?.flipX) preset.flipX = true;
        if (p?.flipY) preset.flipY = true;
        await s.savePreset(preset);
      }

      const list = await s.listPresets();
      list.sort((a, b) => a.sort_order - b.sort_order);
      setPresets(list);

      return { success: true, count: parsed.length };
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
