import { useState, useCallback, useEffect, useRef } from "react";
import type { Gradient } from "../gradient";
import type { Storage } from "../storage";
import { parseGrdFile, convertParsedGradients } from "../grdParser";

interface UseGradientPresetsOptions {
  storage: Storage | null;
}

export function useGradientPresets({ storage }: UseGradientPresetsOptions) {
  const [gradients, setGradients] = useState<Gradient[]>([]);
  const [activeGradientId, setActiveGradientId] = useState<string | null>(null);

  const storageRef = useRef(storage);
  storageRef.current = storage;

  // Load gradients from IndexedDB on mount
  useEffect(() => {
    if (!storage) return;
    storage.listGradients().then((list) => {
      list.sort((a, b) => a.sort_order - b.sort_order);
      setGradients(list);
      // Default to first gradient if none selected
      if (list.length > 0 && !activeGradientId) {
        setActiveGradientId(list[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  // Group gradients by group name
  const groups = gradients.reduce<Record<string, Gradient[]>>((acc, g) => {
    if (!acc[g.group]) acc[g.group] = [];
    acc[g.group].push(g);
    return acc;
  }, {});

  const selectGradient = useCallback((id: string) => {
    setActiveGradientId(id);
  }, []);

  const saveGradient = useCallback(async (gradient: Gradient) => {
    const s = storageRef.current;
    if (!s) return;
    await s.saveGradient(gradient);
    const list = await s.listGradients();
    list.sort((a, b) => a.sort_order - b.sort_order);
    setGradients(list);
  }, []);

  const deleteGradient = useCallback(async (id: string) => {
    const s = storageRef.current;
    if (!s) return;
    await s.deleteGradient(id);
    const list = await s.listGradients();
    list.sort((a, b) => a.sort_order - b.sort_order);
    setGradients(list);
    if (activeGradientId === id) {
      setActiveGradientId(list.length > 0 ? list[0].id : null);
    }
  }, [activeGradientId]);

  const importGrd = useCallback(async (file: File) => {
    const s = storageRef.current;
    if (!s) return;

    const buffer = await file.arrayBuffer();
    const parsed = parseGrdFile(buffer);
    if (parsed.length === 0) return;

    const existingGradients = await s.listGradients();
    const maxOrder = existingGradients.reduce(
      (max, g) => Math.max(max, g.sort_order),
      -1,
    );

    const groupName = `Imported - ${file.name}`;
    const newGradients = convertParsedGradients(
      parsed,
      groupName,
      maxOrder + 1,
    );

    for (const gradient of newGradients) {
      await s.saveGradient(gradient);
    }

    const list = await s.listGradients();
    list.sort((a, b) => a.sort_order - b.sort_order);
    setGradients(list);
  }, []);

  const activeGradient = gradients.find((g) => g.id === activeGradientId) ?? null;

  return {
    gradients,
    groups,
    activeGradientId,
    activeGradient,
    selectGradient,
    saveGradient,
    deleteGradient,
    importGrd,
  };
}
