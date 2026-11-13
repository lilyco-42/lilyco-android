import { defineConfig } from "vite";

// Tauri 在 build 时把前端打到 dist/，供 tauri.conf.json frontendDist 引用
export default defineConfig({
  // Tauri 在 src-tauri 目录里跑 npm run build，故这里显式把 root 指到 ui/
  root: "ui",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
