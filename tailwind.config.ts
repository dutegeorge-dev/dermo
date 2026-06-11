import type { Config } from "tailwindcss";

/**
 * Конфиг Tailwind с плейсхолдерами дизайн-токенов бренда.
 * Конкретные значения цветов/шрифтов уточняются позже — сейчас нейтральные дефолты.
 * content покрывает все шаблоны и клиентский TS для корректного purge.
 */
const config: Config = {
  content: [
    "./src/**/*.{njk,md,html}",
    "./src/assets/ts/**/*.ts",
    // Словари i18n содержат разметку с классами (перелинковка, шаги) —
    // сканируем, чтобы классы из строк словаря не вырезались при purge.
    "./src/_data/**/*.ts",
    "./admin/**/*.html",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1200px",
      },
    },
    extend: {
      colors: {
        // Дизайн-токены бренда ТЛК БАРС. Меняются здесь — отражаются на всём сайте.
        // brand — ультрамарин: основной фон хедера и акценты.
        brand: {
          DEFAULT: "#1E3FD0",
          dark: "#15269C", // utility-полоса, hover-состояния
          light: "#3a6ea5", // оставлено для обратной совместимости
        },
        // accent — янтарь: ТОЛЬКО главные CTA («Оставить заявку», «Рассчитать»).
        accent: {
          DEFAULT: "#F5A623",
          hover: "#D98E0B",
          dark: "#D98E0B", // алиас hover для существующих утилит .btn-accent
        },
        // cyan — бирюза: мелкие акценты (иконки, подчёркивания, активные состояния).
        cyan: {
          DEFAULT: "#22B8CF",
          dark: "#1098AD",
        },
        ink: "#0F172A", // основной текст на светлом
        muted: "#64748B", // вторичный текст
        surface: "#FFFFFF", // фон мега-меню, светлые блоки
        "surface-alt": "#F1F5F9", // фон кликабельных «ворот»
        // Служебные цвета статусов (только для таблиц/состояний «есть/нет»).
        // Не часть бренд-палитры — используются точечно для ✓/✗ и подобного.
        success: {
          DEFAULT: "#16A34A",
          dark: "#15803D",
          light: "#DCFCE7",
        },
        danger: {
          DEFAULT: "#DC2626",
          dark: "#B91C1C",
          light: "#FEE2E2",
        },
      },
      fontFamily: {
        // Onest (self-hosted woff2, @font-face в tailwind.css) — дефолтный шрифт сайта.
        // font-display: block держит текст скрытым до загрузки Onest, поэтому
        // системный fallback не показывается и подгонка метрик не нужна.
        sans: ["Onest", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
