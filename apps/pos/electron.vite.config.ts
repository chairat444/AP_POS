import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@ap-pos/shared": resolve("../../packages/shared/src/index.ts"),
      },
    },
    plugins: [vue()],
    // bake API URL ตอน build — ตั้ง VITE_API_BASE ก่อน dist
    define: {
      "import.meta.env.VITE_API_BASE": JSON.stringify(
        process.env.VITE_API_BASE || "http://localhost:3000",
      ),
    },
  },
});
