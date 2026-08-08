import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  // Admin auth uses localStorage — SSR would render login layout then
  // hydrate into the shell and break the grid (sidebar only / content below fold).
  ssr: false,
  // ปิด DevTools ชั่วคราว ลด file watchers (กัน EMFILE บน macOS)
  devtools: { enabled: false },
  css: [
    "~/assets/css/tokens.css",
    "~/assets/css/admin.css",
    "~/assets/css/admin-extra.css",
  ],
  build: {
    transpile: ["@ap-pos/shared", "xlsx"],
  },
  vite: {
    resolve: {
      // ใช้ source TS โดยตรง — กัน Vite โหลด dist CommonJS แล้ว named export หาย
      alias: {
        "@ap-pos/shared": fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
      },
    },
    server: {
      watch: {
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/.output/**",
          "**/uploads/**",
          "**/apps/api/**",
          "**/apps/pos/**",
          "**/scripts/**",
          "**/*.tsbuildinfo",
        ],
      },
    },
  },
  ignore: [
    "**/uploads/**",
    "**/.venv*/**",
    "**/apps/api/**",
    "**/apps/pos/**",
  ],
  app: {
    head: {
      title: "AP POS Admin",
      htmlAttrs: { lang: "th" },
      link: [
        {
          rel: "icon",
          type: "image/png",
          href: "/favicon.png?v=2",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&display=swap",
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "http://127.0.0.1:3000",
      appName: process.env.NUXT_PUBLIC_APP_NAME || "AP POS Admin",
      appShortName: process.env.NUXT_PUBLIC_APP_SHORT_NAME || "AP",
    },
  },
});
