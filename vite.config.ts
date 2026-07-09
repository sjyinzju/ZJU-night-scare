import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages 部署基路径（仓库名）
  // 如果 fork 后改了仓库名，这里也要改
  base: "/ZJU-night-scare/",
  server: {
    port: 5173,
    strictPort: false,
  },
});
