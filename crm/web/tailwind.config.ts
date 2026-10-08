import path from "node:path";
import { fileURLToPath } from "node:url";

import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default {
  content: [path.join(webRoot, "index.html"), path.join(webRoot, "src/**/*.{ts,tsx}")],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Onest", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Один акцентный синий — фирменный ультрамарин сайта.
        accent: {
          DEFAULT: "#1E3FD0",
          hover: "#15269C",
          soft: "#EEF2FD",
          // для тёмной темы
          bright: "#7C9BFF",
        },
      },
    },
  },
  plugins: [typography],
} satisfies Config;
