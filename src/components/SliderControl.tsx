import * as Slider from "@radix-ui/react-slider";

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  onChange: (value: number) => void;
  title?: string;
}

export function SliderControl({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  title,
}: SliderControlProps) {
  return (
    <div className="flex flex-col gap-1.5" title={title}>
      <div className="flex justify-between items-baseline">
        <span className="text-[12px] text-cream-dim">{label}</span>
        <span className="text-[11px] text-cream-muted tabular-nums">
          {displayValue ?? value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
      <Slider.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="relative flex items-center select-none touch-none h-5 cursor-pointer"
      >
        <Slider.Track className="relative grow h-[6px] rounded-full bg-graphite-850 shadow-inset">
          <Slider.Range className="absolute h-full rounded-full bg-graphite-600" />
        </Slider.Track>
        <Slider.Thumb
          className="block w-[16px] h-[16px] rounded-full bg-cream-dim
            shadow-soft hover:bg-cream hover:scale-110
            focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-accent/40
            transition-all duration-100 ease-out"
        />
      </Slider.Root>
    </div>
  );
}
