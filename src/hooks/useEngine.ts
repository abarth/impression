import { useEffect, useRef, useState, type RefObject } from "react";
import { initGPU, type GPUContext } from "../gpu";
import { Engine } from "../engine";
import { composite } from "../compositor";
import init, { ImpressionCanvas } from "../wasm/impression_core";
import type { Storage, DocumentMeta } from "../storage";

export interface DocumentSize {
  width: number;
  height: number;
}

export interface EngineInitOptions {
  documentSize: DocumentSize;
  chunks?: Uint8Array[];
  storage?: Storage | null;
  documentMeta?: DocumentMeta | null;
}

export function useEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options?: EngineInitOptions | null,
): Engine | null {
  const [engine, setEngine] = useState<Engine | null>(null);
  const gpuRef = useRef<GPUContext | null>(null);
  const initStarted = useRef(false);

  useEffect(() => {
    if (!canvasRef.current || initStarted.current || !options) return;
    initStarted.current = true;

    const canvas = canvasRef.current;
    const { documentSize, chunks, storage, documentMeta } = options;
    canvas.width = documentSize.width;
    canvas.height = documentSize.height;

    (async () => {
      const wasmModule = await init();
      const gpu = await initGPU(canvas);
      gpuRef.current = gpu;

      const impressionCanvas = new ImpressionCanvas(
        documentSize.width,
        documentSize.height,
      );
      const eng = new Engine(impressionCanvas, gpu, wasmModule.memory);

      if (chunks && chunks.length > 0) {
        // Load saved operations from storage
        for (const chunk of chunks) {
          eng.loadChunk(chunk);
        }
      } else {
        // New document: add initial layer and set defaults
        eng.addLayer();
        eng.setBrushSize(20);
        eng.setBrushSpacing(0.15);
        eng.setBrushColor(0, 0, 0);
        eng.setBrushOpacity(1.0);
        eng.setBrushFlow(0.8);
      }

      // Enable persistence so future strokes are saved
      if (storage && documentMeta) {
        eng.enablePersistence({
          storage,
          documentMeta,
          startChunkIndex: chunks?.length ?? 0,
        });
      }

      setEngine(eng);

      // Render loop
      let running = true;
      function render(time: number) {
        if (!running) return;
        composite(gpu, {
          backgroundColor: eng.getBackgroundColor(),
          canvasVisible: eng.getCanvasVisible(),
          layerCount: eng.getLayerCount(),
          getLayerVisible: (i) => eng.getLayerVisible(i),
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
  }, [canvasRef, options]);

  return engine;
}
