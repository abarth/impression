import { initGPU } from "./gpu";
import { Engine } from "./engine";
import { setupInput } from "./input";
import { composite } from "./compositor";
import init, { ImpressionCanvas } from "./wasm/impression_core";

async function main() {
  // Initialize WASM
  const wasmModule = await init();

  // Set up fullscreen canvas
  const canvasEl = document.getElementById("canvas") as HTMLCanvasElement;
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;

  // Initialize WebGPU
  const gpu = await initGPU(canvasEl);

  // Create the painting canvas in WASM
  const impressionCanvas = new ImpressionCanvas(canvasEl.width, canvasEl.height);

  // Create engine (bridge between WASM and WebGPU)
  const engine = new Engine(impressionCanvas, gpu, wasmModule.memory);

  // Add initial layer
  engine.addLayer();

  // Set up default brush
  engine.setBrushSize(20);
  engine.setBrushSpacing(0.15);
  engine.setBrushColor(0, 0, 0);
  engine.setBrushOpacity(1.0);
  engine.setBrushFlow(0.8);

  // Set up pointer input
  setupInput(canvasEl, engine);

  // Handle window resize
  window.addEventListener("resize", () => {
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
  });

  // Render loop
  function render() {
    // Always composite (cheap when nothing changed since GPU just redraws the same frame)
    composite(gpu, {
      backgroundColor: engine.getBackgroundColor(),
      layerCount: engine.getLayerCount(),
    });
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

main().catch((err) => {
  document.body.innerHTML = `<pre style="color: red; padding: 20px;">${err.message}\n\nWebGPU requires a compatible browser (Chrome 113+, Edge 113+, Safari 18+).</pre>`;
  console.error(err);
});
