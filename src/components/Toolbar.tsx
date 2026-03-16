import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Paintbrush, Hand, ZoomIn, Pipette, Square, Lasso } from "lucide-react";
import type { Tool } from "../hooks/useTool";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
}

const tools: {
  value: Tool;
  icon: typeof Paintbrush;
  label: string;
  shortcut: string;
}[] = [
  { value: "marquee", icon: Square, label: "Marquee", shortcut: "M" },
  { value: "lasso", icon: Lasso, label: "Lasso", shortcut: "L" },
  { value: "brush", icon: Paintbrush, label: "Brush", shortcut: "B" },
  { value: "eyedropper", icon: Pipette, label: "Eyedropper", shortcut: "I" },
  { value: "pan", icon: Hand, label: "Pan", shortcut: "H" },
  { value: "zoom", icon: ZoomIn, label: "Zoom", shortcut: "Z" },
];

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <div className="flex flex-col w-13 bg-graphite-900 border-r border-graphite-850 py-3">
      <ToggleGroup.Root
        type="single"
        value={activeTool}
        onValueChange={(value) => {
          if (value) onToolChange(value as Tool);
        }}
        className="flex flex-col items-center gap-1 px-1.5"
      >
        {tools.map(({ value, icon: Icon, label, shortcut }) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            aria-label={label}
            title={`${label} (${shortcut})`}
            className="flex items-center justify-center w-10 h-10 rounded-[10px]
              text-cream-muted
              hover:text-cream-dim hover:bg-graphite-800
              data-[state=on]:bg-graphite-750 data-[state=on]:text-cream
              data-[state=on]:shadow-soft
              transition-all duration-150 ease-out cursor-pointer"
          >
            <Icon size={18} strokeWidth={1.75} />
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
