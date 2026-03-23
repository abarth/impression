import type { Engine } from "./engine";
import type { SerializableBrushSettings } from "./hooks/useBrushSettings";

/** Get pressure from a pointer event, defaulting to 1.0 for non-pen devices. */
function getPressure(e: PointerEvent): number {
  return e.pointerType === "pen" ? e.pressure : 1.0;
}

export function setupInput(
  canvas: HTMLCanvasElement,
  engine: Engine,
  getSettings: () => SerializableBrushSettings,
): void {
  let activeLayer = 0;

  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    activeLayer = engine.getActiveLayer();
    engine.strokeBegin(activeLayer, e.offsetX, e.offsetY, getPressure(e), getSettings());
  });

  canvas.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.buttons === 0) return;

    // Use coalesced events for smoother input when available
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ce of events) {
      engine.strokeMove(activeLayer, ce.offsetX, ce.offsetY, getPressure(ce));
    }
  });

  canvas.addEventListener("pointerup", (_e: PointerEvent) => {
    engine.strokeEnd();
  });
}
