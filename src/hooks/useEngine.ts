import { useEffect, useRef, useState, type RefObject } from "react";
import { initGPU, destroyGPU, type GPUContext } from "../gpu";
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
  /** Pre-loaded op_log entries for this document (ordered by sequence). */
  opLogEntries?: Uint8Array[];
  storage: Storage | null;
  documentMeta?: DocumentMeta | null;
}

export interface UseEngineResult {
  engine: Engine | null;
  error: string | null;
}

export function useEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options?: EngineInitOptions | null,
): UseEngineResult {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gpuRef = useRef<GPUContext | null>(null);
  const initStarted = useRef(false);
  const renderRunning = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Reset when options become null (document closed)
  useEffect(() => {
    if (!options) {
      renderRunning.current = false;
      initStarted.current = false;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (gpuRef.current) {
        destroyGPU(gpuRef.current);
        gpuRef.current = null;
      }
      setEngine(null);
      setError(null);
    }
  }, [options]);

  useEffect(() => {
    if (!canvasRef.current || initStarted.current || !options) return;
    initStarted.current = true;

    const canvas = canvasRef.current;
    const { documentSize, opLogEntries, storage, documentMeta } = options;
    canvas.width = documentSize.width;
    canvas.height = documentSize.height;

    (async () => {
      try {
        const wasmModule = await init();
        const gpu = await initGPU(canvas);
        gpuRef.current = gpu;

        const impressionCanvas = new ImpressionCanvas(
          documentSize.width,
          documentSize.height,
        );
        const eng = new Engine(impressionCanvas, gpu, wasmModule.memory);

        if (opLogEntries && opLogEntries.length > 0) {
          // Load document-scoped brush tips so SetBrushTip operations
          // find their tips in the registry during replay
          if (storage && documentMeta) {
            const resources = await storage.getDocumentResources(documentMeta.id);
            for (const res of resources) {
              if (res.resource_type === "brush-tip") {
                const tip = res.data as { id: string; pixels: Uint8Array; width: number; height: number };
                eng.registerBrushTip(tip.id, tip.pixels, tip.width, tip.height);
              }
            }
          }

          // Also load global tips as a fallback for legacy docs or
          // tips not yet embedded
          if (storage) {
            const tips = await storage.listTips();
            for (const tip of tips) {
              eng.registerBrushTip(tip.id, tip.pixels, tip.width, tip.height);
            }
          }

          // Replay operations from storage
          for (const entry of opLogEntries) {
            eng.loadChunk(entry);
          }
        } else {
          // New document: add initial layer
          eng.addLayer();
        }

        // Enable persistence so future operations are saved
        if (storage && documentMeta) {
          eng.enablePersistence({
            storage,
            documentMeta,
            startSequence: opLogEntries?.length ?? 0,
          });
        }

        setEngine(eng);

        // Flush pending ops when the tab goes to background to prevent data loss
        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden" && eng.dirty) {
            eng.flushAll();
          }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // Warn user if there are unflushed ops when closing the tab
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          if (eng.dirty) {
            e.preventDefault();
          }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);

        // Store cleanup references
        cleanupRef.current = () => {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          window.removeEventListener("beforeunload", handleBeforeUnload);
        };

        // Render loop
        renderRunning.current = true;
        function render(time: number) {
          if (!renderRunning.current) return;
          composite(gpu, {
            backgroundColor: eng.getBackgroundColor(),
            canvasVisible: eng.getCanvasVisible(),
            layerCount: eng.getLayerCount(),
            getLayerVisible: (i) => eng.getLayerVisible(i),
            getLayerBlendMode: (i) => eng.getLayerBlendMode(i),
            getLayerKind: (i) => eng.getLayerKind(i),
            time,
          });
          requestAnimationFrame(render);
        }
        requestAnimationFrame(render);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      }
    })();
  }, [canvasRef, options]);

  return { engine, error };
}
