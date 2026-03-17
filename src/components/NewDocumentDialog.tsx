import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";

interface NewDocumentDialogProps {
  onCreateDocument: (name: string, width: number, height: number, ppi: number) => void;
}

const PRESETS: { label: string; width: number; height: number }[] = [
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "1080 × 1080", width: 1080, height: 1080 },
  { label: "1280 × 720", width: 1280, height: 720 },
  { label: "800 × 600", width: 800, height: 600 },
];

export function NewDocumentDialog({ onCreateDocument }: NewDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Untitled");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [ppi, setPpi] = useState(72);

  function handleCreate() {
    if (width > 0 && height > 0) {
      onCreateDocument(name || "Untitled", width, height, ppi);
      setOpen(false);
      // Reset for next time
      setName("Untitled");
      setWidth(1920);
      setHeight(1080);
      setPpi(72);
    }
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setWidth(preset.width);
    setHeight(preset.height);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl
            bg-graphite-800 text-cream hover:bg-graphite-750
            shadow-soft transition-all duration-150 cursor-pointer"
        >
          <Plus size={16} strokeWidth={2} />
          <span className="text-[13px]">New Document</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            w-[380px] bg-graphite-900 rounded-2xl shadow-panel
            border border-graphite-750 p-6 focus:outline-none"
        >
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-[15px] font-medium text-cream">
              New Document
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded-lg text-cream-muted hover:text-cream
                hover:bg-graphite-800 transition-all duration-150 cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-graphite-850 text-cream text-[13px] px-3 py-2
                  rounded-lg border border-graphite-750 outline-none
                  focus:border-warm-accent transition-all duration-150"
              />
            </label>

            <div className="flex gap-3">
              <label className="flex flex-col gap-1.5 flex-1">
                <span className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
                  Width
                </span>
                <input
                  type="number"
                  value={width}
                  min={1}
                  max={8192}
                  onChange={e => setWidth(Number(e.target.value))}
                  className="w-full bg-graphite-850 text-cream text-[13px] px-3 py-2
                    rounded-lg border border-graphite-750 outline-none
                    focus:border-warm-accent transition-all duration-150"
                />
              </label>
              <label className="flex flex-col gap-1.5 flex-1">
                <span className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
                  Height
                </span>
                <input
                  type="number"
                  value={height}
                  min={1}
                  max={8192}
                  onChange={e => setHeight(Number(e.target.value))}
                  className="w-full bg-graphite-850 text-cream text-[13px] px-3 py-2
                    rounded-lg border border-graphite-750 outline-none
                    focus:border-warm-accent transition-all duration-150"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
                PPI
              </span>
              <input
                type="number"
                value={ppi}
                min={1}
                max={1200}
                onChange={e => setPpi(Number(e.target.value))}
                className="w-full bg-graphite-850 text-cream text-[13px] px-3 py-2
                  rounded-lg border border-graphite-750 outline-none
                  focus:border-warm-accent transition-all duration-150"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-cream-muted tracking-wide uppercase">
                Presets
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] transition-all duration-150 cursor-pointer
                      ${width === preset.width && height === preset.height
                        ? "bg-graphite-750 text-cream shadow-soft"
                        : "bg-graphite-850 text-cream-dim hover:bg-graphite-800 hover:text-cream"
                      }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={width <= 0 || height <= 0}
              className="mt-1 px-4 py-2.5 rounded-xl bg-warm-accent text-graphite-950
                font-medium text-[13px] hover:brightness-110
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-150 cursor-pointer"
            >
              Create
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
