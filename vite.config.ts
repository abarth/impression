import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/impression/",
  plugins: [react(), wasm(), topLevelAwait(), tailwindcss()],
  build: {
    target: "esnext",
  },
});
