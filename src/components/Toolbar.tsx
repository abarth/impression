import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Paintbrush, Hand, ZoomIn } from "lucide-react";
import type { Tool } from "../hooks/useTool";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
}

const tools: { value: Tool; icon: typeof Paintbrush; label: string }[] = [
  { value: "brush", icon: Paintbrush, label: "Brush" },
  { value: "pan", icon: Hand, label: "Pan" },
  { value: "zoom", icon: ZoomIn, label: "Zoom" },
];

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <div className="flex flex-col w-11 bg-[#252525] border-r border-[#333]">
      <ToggleGroup.Root
        type="single"
        value={activeTool}
        onValueChange={(value) => {
          if (value) onToolChange(value as Tool);
        }}
        className="flex flex-col gap-0.5 p-1"
      >
        {tools.map(({ value, icon: Icon, label }) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            aria-label={label}
            title={label}
            className="flex items-center justify-center w-9 h-9 rounded
              text-[#999] hover:text-white hover:bg-[#333]
              data-[state=on]:bg-[#444] data-[state=on]:text-white
              transition-colors"
          >
            <Icon size={18} />
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
