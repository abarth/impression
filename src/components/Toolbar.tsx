import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Paintbrush, Eraser, Hand, ZoomIn, Pipette, Square, Lasso, ChevronLeft, Undo2, Redo2, Download } from "lucide-react";
import type { Tool } from "../hooks/useTool";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  documentName?: string;
  onBack?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onExport?: () => void;
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
  { value: "eraser", icon: Eraser, label: "Eraser", shortcut: "E" },
  { value: "eyedropper", icon: Pipette, label: "Eyedropper", shortcut: "I" },
  { value: "pan", icon: Hand, label: "Pan", shortcut: "H" },
  { value: "zoom", icon: ZoomIn, label: "Zoom", shortcut: "Z" },
];

export function Toolbar({ activeTool, onToolChange, documentName, onBack, onUndo, onRedo, canUndo = false, canRedo = false, onExport }: ToolbarProps) {
  return (
    <div className="flex flex-col w-13 bg-graphite-900 border-r border-graphite-850 py-3">
      {onBack && (
        <button
          onClick={onBack}
          title={documentName ?? "Back to paintings"}
          className="flex items-center justify-center w-10 h-10 mx-auto mb-2 rounded-[10px]
            text-cream-muted hover:text-cream hover:bg-graphite-800
            transition-all duration-150 cursor-pointer"
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
      )}
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

      {/* Actions */}
      <div className="flex flex-col items-center gap-1 px-1.5 mt-auto">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
          className="flex items-center justify-center w-10 h-10 rounded-[10px]
            text-cream-muted hover:text-cream hover:bg-graphite-800
            disabled:opacity-30 disabled:pointer-events-none
            transition-all duration-150 cursor-pointer"
        >
          <Undo2 size={18} strokeWidth={1.75} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
          className="flex items-center justify-center w-10 h-10 rounded-[10px]
            text-cream-muted hover:text-cream hover:bg-graphite-800
            disabled:opacity-30 disabled:pointer-events-none
            transition-all duration-150 cursor-pointer"
        >
          <Redo2 size={18} strokeWidth={1.75} />
        </button>
        <button
          onClick={onExport}
          title="Export as PNG"
          className="flex items-center justify-center w-10 h-10 rounded-[10px]
            text-cream-muted hover:text-cream hover:bg-graphite-800
            transition-all duration-150 cursor-pointer"
        >
          <Download size={18} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
