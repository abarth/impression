import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "child_process";
import path from "path";

function wasmPackWatch(): Plugin {
  const crateDir = path.resolve(__dirname, "crates/impression-core");
  const srcDir = path.join(crateDir, "src");

  function rebuild() {
    try {
      execSync("npm run build:wasm", { stdio: "inherit" });
    } catch {
      // Build errors are printed to stderr by wasm-pack; don't crash the dev server
    }
  }

  return {
    name: "wasm-pack-watch",
    buildStart() {
      rebuild();
    },
    configureServer(server) {
      server.watcher.add(srcDir);
      server.watcher.on("change", (file) => {
        if (file.startsWith(srcDir) && file.endsWith(".rs")) {
          console.log(`\n[wasm-pack] Rust source changed: ${path.relative(crateDir, file)}`);
          rebuild();
        }
      });
    },
  };
}

export default defineConfig({
  base: "/impression/",
  plugins: [wasmPackWatch(), react(), wasm(), topLevelAwait(), tailwindcss()],
  server: {
    host: true,
  },
  build: {
    target: "esnext",
  },
});
