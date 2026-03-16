import * as Popover from "@radix-ui/react-popover";
import { HexColorPicker } from "react-colorful";
import { ArrowRightLeft } from "lucide-react";

interface ColorDisplayProps {
  foreground: string;
  background: string;
  onForegroundChange: (hex: string) => void;
  onBackgroundChange: (hex: string) => void;
  onSwap: () => void;
}

function ColorSwatch({
  color,
  label,
  onChange,
}: {
  color: string;
  label: string;
  onChange: (hex: string) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label={label}
          title={label}
          className="w-8 h-8 rounded border border-[#555] hover:border-[#888] transition-colors cursor-pointer"
          style={{ backgroundColor: color }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          sideOffset={8}
          className="z-50 rounded-lg bg-[#2a2a2a] border border-[#444] p-3 shadow-xl"
        >
          <HexColorPicker color={color} onChange={onChange} />
          <Popover.Arrow className="fill-[#444]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ColorDisplay({
  foreground,
  background,
  onForegroundChange,
  onBackgroundChange,
  onSwap,
}: ColorDisplayProps) {
  return (
    <div className="flex flex-col gap-2 p-3 border-b border-[#333]">
      <h3 className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">
        Color
      </h3>
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[#777]">FG</span>
          <ColorSwatch
            color={foreground}
            label="Foreground color"
            onChange={onForegroundChange}
          />
        </div>
        <button
          onClick={onSwap}
          title="Swap colors"
          className="text-[#777] hover:text-white transition-colors cursor-pointer"
        >
          <ArrowRightLeft size={14} />
        </button>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[#777]">BG</span>
          <ColorSwatch
            color={background}
            label="Background color"
            onChange={onBackgroundChange}
          />
        </div>
      </div>
    </div>
  );
}
