/**
 * Конфигурация бэкенд-обработчика заявок.
 *
 * Все секреты берутся из окружения (.env в корне проекта, он в .gitignore).
 * В репозитории хранится только .env.example с плейсхолдерами.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./dotenv.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv();

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

/** Скрывает секреты (токен вебхука Bitrix24, токен бота) в логах и ошибках. */
export function maskSecrets(value: string): string {
  return value
    .replace(/(\/rest\/[^/]+\/)[^/]+/g, "$1***")
    .replace(/(\/bot)\d+:[\w-]+/g, "$1***");
}

const webhookRaw = process.env.BITRIX_WEBHOOK_URL?.trim() ?? "";

// Без вебхука обработчик всё равно поднимается: иначе `npm run dev` падал бы
// у разработчика без доступа к CRM. Заявки в этом режиме не принимаются —
// эндпоинт честно отвечает 503, а на старте выводится предупреждение.
const webhookBase = webhookRaw ? normalizeWebhookBase(webhookRaw) : "";

const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";

/** Чаты для уведомлений: один ID или несколько через запятую. */
const telegramChatIds = (process.env.TELEGRAM_CHAT_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

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
  /** Путь эндпоинта курсов ЦБ (нужен калькулятору доставки). */
  ratesPath: process.env.RATES_PATH?.trim() || "/api/rates",

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

  telegram: {
    /** Токен бота (@BotFather). Пусто — уведомления отключены. */
    token: telegramToken,
    /** Чаты, куда дублируется заявка (свой ID узнаётся у @userinfobot). */
    chatIds: telegramChatIds,
    /** Уведомления включаются, только когда заданы и токен, и чат. */
    enabled: Boolean(telegramToken) && telegramChatIds.length > 0,
    /** Таймаут запроса к Bot API, мс. */
    timeoutMs: envNumber("TELEGRAM_TIMEOUT_MS", 10_000),
  },

  rates: {
    /** Основной источник курсов ЦБ — готовый JSON. */
    jsonUrl: process.env.RATES_JSON_URL?.trim() || "https://www.cbr-xml-daily.ru/daily_json.js",
    /** Резервный источник — официальный XML ЦБ РФ. */
    xmlUrl: process.env.RATES_XML_URL?.trim() || "https://www.cbr.ru/scripts/XML_daily.asp",
    /** Сколько держим курс в памяти. ЦБ публикует его раз в сутки — 6 часов с запасом. */
    ttlMs: envNumber("RATES_TTL_MS", 6 * 60 * 60 * 1000),
    /** Таймаут запроса к ЦБ, мс. */
    timeoutMs: envNumber("RATES_TIMEOUT_MS", 8000),
    /** Файл последних известных курсов: переживает перезапуск службы. */
    cacheFile: path.resolve(
      ROOT,
      process.env.RATES_CACHE_FILE?.trim() || "logs/rates-cache.json",
    ),
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
