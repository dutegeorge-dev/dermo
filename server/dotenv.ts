/**
 * Загрузка `.env` без зависимостей.
 *
 * Нужна и обработчику заявок, и сборке 11ty: `SITE_URL`, `LEAD_API_URL`,
 * ID счётчиков и т.п. попадают в HTML на этапе сборки, поэтому eleventy.config
 * обязан прочитать `.env` раньше, чем шаблоны обратятся к `site.ts`. Иначе
 * значения молча уезжают в дефолты — а в случае `LEAD_API_URL` это означает
 * вшитый в страницы `http://localhost:3000/...` вместо адреса на своём домене.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Корень репозитория (этот файл лежит в server/). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Читает `KEY=value` из файла в `process.env`.
 * Понимает кавычки, комментарии и префикс `export`. Уже заданные переменные
 * окружения приоритетнее файла — это позволяет переопределять их в systemd,
 * CI и одноразовыми запусками вида `LEAD_PORT=3001 npm run server`.
 *
 * @param file путь к .env; по умолчанию — `.env` в корне проекта.
 */
export function loadDotEnv(file: string = path.join(ROOT, ".env")): void {
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    // Снимаем обрамляющие кавычки; в двойных раскрываем \n.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      // Без кавычек — обрезаем хвостовой комментарий.
      value = value.replace(/\s+#.*$/, "").trim();
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}
