import { useEffect, useRef, useState, type RefObject } from "react";
import { initGPU, type GPUContext } from "../gpu";
import { Engine } from "../engine";
import { composite } from "../compositor";
import init, { ImpressionCanvas } from "../wasm/impression_core";

export function useEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): Engine | null {
  const [engine, setEngine] = useState<Engine | null>(null);
  const gpuRef = useRef<GPUContext | null>(null);
  const initStarted = useRef(false);

  useEffect(() => {
    if (!canvasRef.current || initStarted.current) return;
    initStarted.current = true;

    const canvas = canvasRef.current;

    (async () => {
      const wasmModule = await init();
      const gpu = await initGPU(canvas);
      gpuRef.current = gpu;

      const impressionCanvas = new ImpressionCanvas(
        canvas.width,
        canvas.height,
      );
      const eng = new Engine(impressionCanvas, gpu, wasmModule.memory);

      // Add initial layer
      eng.addLayer();

      // Set defaults
      eng.setBrushSize(20);
      eng.setBrushSpacing(0.15);
      eng.setBrushColor(0, 0, 0);
      eng.setBrushOpacity(1.0);
      eng.setBrushFlow(0.8);

      setEngine(eng);

      // Render loop
      let running = true;
      function render(time: number) {
        if (!running) return;
        composite(gpu, {
          backgroundColor: eng.getBackgroundColor(),
          layerCount: eng.getLayerCount(),
          getLayerBlendMode: (i) => eng.getLayerBlendMode(i),
          time,
        });
        requestAnimationFrame(render);
      }
      requestAnimationFrame(render);

      return () => {
        running = false;
      };
    })();
  }, [canvasRef]);

  return engine;
}
