import type { Engine } from "./engine";

export function setupInput(canvas: HTMLCanvasElement, engine: Engine): void {
  let activeLayer = 0;

  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    activeLayer = engine.getActiveLayer();
    engine.strokeBegin(activeLayer, e.offsetX, e.offsetY, e.pressure || 0.5);
  });

  canvas.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.buttons === 0) return;

    // Use coalesced events for smoother input when available
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ce of events) {
      engine.strokeMove(activeLayer, ce.offsetX, ce.offsetY, ce.pressure || 0.5);
    }
  });

  canvas.addEventListener("pointerup", (_e: PointerEvent) => {
    engine.strokeEnd();
  });
}
