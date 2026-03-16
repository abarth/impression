import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    environment: "happy-dom",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
