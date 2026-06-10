# Шрифт Onest (self-hosted)

Подсеты woff2 шрифта **Onest** (latin / latin-ext / cyrillic / cyrillic-ext),
веса 300/400/500/600. Подключаются через `@font-face` в
`src/assets/css/tailwind.css` (`font-display: swap`) и копируются в
`/assets/fonts/` при сборке (passthrough в `eleventy.config.ts`).

- Источник файлов: пакет [`@fontsource/onest`](https://www.npmjs.com/package/@fontsource/onest)
  (subset-woff2, идентичны Google Fonts).
- Лицензия: **SIL Open Font License 1.1** (OFL). Допускает self-hosting и
  использование в коммерческих проектах.
- Обновление: перекачать одноимённые файлы из CDN Fontsource и заменить здесь.

Self-hosting выбран намеренно (скорость, приватность) — без сторонних
шрифтовых CDN на рантайме.
