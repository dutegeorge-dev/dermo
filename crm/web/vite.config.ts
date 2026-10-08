import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  base: "/crm/",
  plugins: [react()],
  // PostCSS задаём здесь явно: иначе Vite подхватит postcss.config.js сайта из корня репозитория.
  css: {
    postcss: { plugins: [tailwindcss({ config: path.join(webRoot, "tailwind.config.ts") }), autoprefixer()] },
  },
  build: {
    outDir: path.join(webRoot, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    // Шрифты Onest берём из ассетов сайта (src/assets/fonts), без копий.
    fs: { allow: [path.resolve(webRoot, "../..")] },
    proxy: { "/crm/api": "http://127.0.0.1:3100" },
  },
});
