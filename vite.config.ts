import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // GitHub Pages 部署基路径（仓库名）
  // 如果 fork 后改了仓库名，这里也要改
  base: "/ZJU-night-scare/game/",
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "game/index.html"),
      },
    },
  },
});
