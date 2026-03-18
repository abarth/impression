import * as Popover from "@radix-ui/react-popover";
import { OklchColorPicker } from "./OklchColorPicker";
import { RefreshCw } from "lucide-react";

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
  className = "",
}: {
  color: string;
  label: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label={label}
          title={label}
          className={`rounded-[10px] shadow-soft border-2 border-graphite-750
            hover:border-cream-muted hover:scale-105
            transition-all duration-150 ease-out cursor-pointer ${className}`}
          style={{ backgroundColor: color }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          sideOffset={12}
          className="z-50 rounded-xl bg-graphite-900 border border-graphite-750
            p-3.5 shadow-panel"
        >
          <OklchColorPicker color={color} onChange={onChange} />
          <Popover.Arrow className="fill-graphite-750" />
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
    <div className="flex flex-col gap-3 px-4 py-4 border-t border-graphite-850">
      <h3 className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
        Color
      </h3>

      {/* Overlapping swatches — FG in front, BG behind */}
      <div className="flex items-end gap-3">
        <div className="relative w-16 h-14">
          {/* Background swatch — positioned behind */}
          <ColorSwatch
            color={background}
            label="Background color"
            onChange={onBackgroundChange}
            className="absolute bottom-0 right-0 w-9 h-9"
          />
          {/* Foreground swatch — larger, in front */}
          <ColorSwatch
            color={foreground}
            label="Foreground color"
            onChange={onForegroundChange}
            className="absolute top-0 left-0 w-11 h-11 z-10"
          />
        </div>

        <button
          onClick={onSwap}
          title="Swap colors"
          className="p-1.5 rounded-lg text-cream-muted hover:text-cream
            hover:bg-graphite-800 transition-all duration-150 cursor-pointer"
        >
          <RefreshCw size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
