import { defineConfig } from "vite";

// Tauri 在 build 时把前端打到 dist/，供 tauri.conf.json frontendDist 引用
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
