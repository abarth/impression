import * as Slider from "@radix-ui/react-slider";

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  onChange: (value: number) => void;
}

export function SliderControl({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: SliderControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-[#999]">{label}</span>
        <span className="text-[#ccc] tabular-nums">
          {displayValue ?? value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
      <Slider.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="relative flex items-center select-none touch-none h-4"
      >
        <Slider.Track className="relative grow h-1 rounded-full bg-[#333]">
          <Slider.Range className="absolute h-full rounded-full bg-[#666]" />
        </Slider.Track>
        <Slider.Thumb className="block w-3 h-3 rounded-full bg-[#ccc] hover:bg-white focus:outline-none focus:ring-1 focus:ring-[#666]" />
      </Slider.Root>
    </div>
  );
}
