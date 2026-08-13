/**
 * Конфигурация бэкенд-обработчика заявок.
 *
 * Все секреты берутся из окружения (.env в корне проекта, он в .gitignore).
 * В репозитории хранится только .env.example с плейсхолдерами.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Минималистичный парсер .env (без зависимостей).
 * Понимает `KEY=value`, кавычки, комментарии и префикс `export`.
 * Уже заданные переменные окружения не перезаписываются.
 */
function loadDotEnv(file: string): void {
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

loadDotEnv(path.join(ROOT, ".env"));

/** Читает число из окружения с фолбэком на значение по умолчанию. */
function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Нормализует вебхук Bitrix24 до базового вида
 * `https://<портал>/rest/<user_id>/<token>/`.
 *
 * Принимает как базовый URL, так и полную ссылку на метод с query-строкой —
 * ту самую, что Bitrix24 показывает в карточке входящего вебхука
 * (`.../rest/1/<token>/crm.lead.add.json?FIELDS[TITLE]=...`).
 */
function normalizeWebhookBase(raw: string): string {
  const url = new URL(raw.trim());
  const match = /^\/rest\/[^/]+\/[^/]+\//.exec(
    url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`,
  );

  if (!match) {
    throw new Error(
      "BITRIX_WEBHOOK_URL не похож на вебхук Bitrix24: ожидается путь вида /rest/<user_id>/<token>/",
    );
  }

  return `${url.origin}${match[0]}`;
}

/** Скрывает токен вебхука в логах и текстах ошибок. */
export function maskWebhook(value: string): string {
  return value.replace(/(\/rest\/[^/]+\/)[^/]+/g, "$1***");
}

const webhookRaw = process.env.BITRIX_WEBHOOK_URL?.trim() ?? "";

// Без вебхука обработчик всё равно поднимается: иначе `npm run dev` падал бы
// у разработчика без доступа к CRM. Заявки в этом режиме не принимаются —
// эндпоинт честно отвечает 503, а на старте выводится предупреждение.
const webhookBase = webhookRaw ? normalizeWebhookBase(webhookRaw) : "";

/** Источники, которым разрешён CORS-доступ к обработчику. */
function parseOrigins(): string[] {
  const fromEnv = (process.env.LEAD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  const siteUrl = process.env.SITE_URL?.trim().replace(/\/$/, "");

  return [
    ...new Set([
      ...fromEnv,
      ...(siteUrl ? [siteUrl] : []),
      // Локальная разработка: 11ty serve (8080) и http-server превью.
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://localhost:3000",
    ]),
  ];
}

export const config = {
  /** Порт HTTP-обработчика. */
  port: envNumber("LEAD_PORT", 3000),
  /** Интерфейс прослушивания (0.0.0.0 — доступен извне контейнера). */
  host: process.env.LEAD_HOST?.trim() || "0.0.0.0",
  /** Путь эндпоинта приёма заявок. */
  path: process.env.LEAD_PATH?.trim() || "/api/lead",

  bitrix: {
    /** Задан ли вебхук: без него заявки в CRM не уходят. */
    configured: Boolean(webhookBase),
    /** Базовый URL вебхука со слешем на конце. */
    base: webhookBase,
    /** Полный URL метода REST: `crm.lead.add` → `<base>crm.lead.add.json`. */
    method(name: string): string {
      return `${webhookBase}${name}.json`;
    },
    /** Источник лида (справочник CRM_STATUS SOURCE). */
    sourceId: process.env.BITRIX_SOURCE_ID?.trim() || "WEB",
    /** ID ответственного за лид (пусто — назначит Bitrix24 по своим правилам). */
    assignedById: process.env.BITRIX_ASSIGNED_BY_ID?.trim() || "",
    /** Таймаут запроса к Bitrix24, мс. */
    timeoutMs: envNumber("BITRIX_TIMEOUT_MS", 10_000),
  },

  cors: {
    allowedOrigins: parseOrigins(),
    /** true — отвечать на любой Origin (только для отладки). */
    allowAll: process.env.LEAD_ALLOW_ALL_ORIGINS === "true",
  },

  rateLimit: {
    /** Сколько заявок с одного IP разрешено за окно. */
    max: envNumber("LEAD_RATE_LIMIT", 10),
    /** Длина окна, мс. */
    windowMs: envNumber("LEAD_RATE_WINDOW_MS", 60_000),
  },

  /** Куда складывать заявки, которые не удалось отдать в CRM. */
  failedLeadsFile: path.resolve(
    ROOT,
    process.env.LEAD_FAILED_LOG?.trim() || "logs/leads-failed.jsonl",
  ),

  /** Максимальный размер тела запроса, байт. */
  maxBodyBytes: envNumber("LEAD_MAX_BODY_BYTES", 16 * 1024),
} as const;
