import { defineConfig } from "vite";

// CesiumJS is loaded from Cesium's own CDN in index.html (see docs/DECISIONS.md),
// so the bundle stays small and no Cesium asset-copy step is needed.
export default defineConfig({
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
} as Parameters<typeof defineConfig>[0]);
