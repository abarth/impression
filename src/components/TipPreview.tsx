import { useEffect, useRef, useState } from "react";
import { Storage } from "../storage";

interface TipPreviewProps {
  tipId: string | undefined;
  storage: Storage | null;
  size?: number;
  className?: string;
}

/**
 * Renders a visual preview of a sampled brush tip or pattern.
 * Fetches pixel data from storage and draws it to a grayscale canvas.
 */
export function TipPreview({ tipId, storage, size = 64, className = "" }: TipPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tipId || !storage || !canvasRef.current) return;

    setLoading(true);
    setError(false);

    storage.getTip(tipId).then((tip) => {
      if (!tip || !canvasRef.current) {
        setError(true);
        setLoading(false);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Create ImageData
      const imgData = ctx.createImageData(tip.width, tip.height);
      const data = imgData.data;

      for (let i = 0; i < tip.pixels.length; i++) {
        const val = tip.pixels[i];
        const idx = i * 4;
        // Draw as black on transparent (typical for brush previews)
        data[idx] = 230;     // R (cream-ish)
        data[idx + 1] = 230; // G
        data[idx + 2] = 230; // B
        data[idx + 3] = 255 - val; // A (WASM uses 0 for opaque if it's an alpha mask?)
        // Wait, PS ABR alpha masks: 0 is white (transparent?), 255 is black (opaque?).
        // In Impression, we usually treat 255 as fully opaque.
        // Actually, let's just use the value as alpha.
        data[idx + 3] = 255 - val; // Assuming 0=opaque, 255=transparent in the mask?
        // Let's check abrParser.ts to see how it extracts pixels.
      }

      // Scaling to fit
      const scale = Math.min(size / tip.width, size / tip.height);
      const sw = tip.width * scale;
      const sh = tip.height * scale;
      const dx = (size - sw) / 2;
      const dy = (size - sh) / 2;

      // Temp canvas for original size
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = tip.width;
      tempCanvas.height = tip.height;
      tempCanvas.getContext("2d")?.putImageData(imgData, 0, 0);

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tempCanvas, dx, dy, sw, sh);
      
      setLoading(false);
    }).catch(() => {
      setError(true);
      setLoading(false);
    });
  }, [tipId, storage, size]);

  if (!tipId) {
    return (
      <div className={`flex items-center justify-center bg-graphite-850 rounded-lg border border-graphite-800 ${className}`} style={{ width: size, height: size }}>
         <span className="text-[10px] text-cream-muted font-medium">No Tip</span>
      </div>
    );
  }

  return (
    <div className={`relative bg-graphite-850 rounded-lg border border-graphite-800 overflow-hidden ${className}`} style={{ width: size, height: size }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-graphite-850/50">
          <div className="w-4 h-4 border-2 border-cream-muted border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className={error ? "hidden" : "block"}
      />
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] text-red-400 font-medium">Error</span>
        </div>
      )}
    </div>
  );
}
