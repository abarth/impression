import { useState, useCallback } from "react";

export type Tool = "brush" | "pan" | "zoom";

export function useTool() {
  const [activeTool, setActiveTool] = useState<Tool>("brush");

  const selectTool = useCallback((tool: Tool) => {
    setActiveTool(tool);
  }, []);

  return { activeTool, selectTool };
}
