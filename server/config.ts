/**
 * Конфигурация бэкенд-обработчика заявок.
 *
 * Все секреты берутся из окружения (.env в корне проекта, он в .gitignore).
 * В репозитории хранится только .env.example с плейсхолдерами.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./dotenv.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv();

/** Читает число из окружения с фолбэком на значение по умолчанию. */
function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Нормализует базовый URL аккаунта amoCRM. */
function normalizeAmoBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" || !url.hostname.endsWith(".amocrm.ru")) {
    throw new Error("AMOCRM_BASE_URL должен иметь вид https://<аккаунт>.amocrm.ru");
  }
  return url.origin;
}

/** Читает положительный числовой ID из окружения. */
function envId(key: string): number | null {
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} должен быть положительным целым числом`);
  }
  return parsed;
}

const amoBaseRaw = process.env.AMOCRM_BASE_URL?.trim() ?? "";
const amoAccessToken = process.env.AMOCRM_ACCESS_TOKEN?.trim() ?? "";
const amoPipelineId = envId("AMOCRM_PIPELINE_ID");
const amoStatusId = envId("AMOCRM_STATUS_ID");

/** Скрывает секреты amoCRM и Telegram в логах и ошибках. */
export function maskSecrets(value: string): string {
  let masked = value.replace(/(\/bot)\d+:[\w-]+/g, "$1***");
  if (amoAccessToken) masked = masked.replaceAll(amoAccessToken, "***");
  return masked.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1***");
}

const amoBaseUrl = amoBaseRaw ? normalizeAmoBaseUrl(amoBaseRaw) : "";

const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";

/** Чаты для уведомлений: один ID или несколько через запятую. */
const telegramChatIds = (process.env.TELEGRAM_CHAT_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * Учётки CMS из CMS_USERS — «логин:пароль», пары через запятую или перевод
 * строки. Пароль хранится открытым текстом (осознанный выбор ради простоты):
 * защищайте .env правами доступа на сервере. Логин обычно e-mail и «:» не
 * содержит, поэтому разбиваем по первому двоеточию — пароль может быть любым.
 */
function parseCmsUsers(): Map<string, string> {
  const raw = process.env.CMS_USERS ?? "";
  const users = new Map<string, string>();
  for (const pair of raw.split(/[,\n]/)) {
    const entry = pair.trim();
    if (!entry) continue;
    const sep = entry.indexOf(":");
    if (sep <= 0) continue;
    const login = entry.slice(0, sep).trim();
    const password = entry.slice(sep + 1);
    if (login && password) users.set(login, password);
  }
  return users;
}

const cmsUsers = parseCmsUsers();
const cmsSessionSecret = process.env.CMS_SESSION_SECRET?.trim() ?? "";

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

  amocrm: {
    /** Заданы ли все обязательные параметры интеграции. */
    configured: Boolean(amoBaseUrl && amoAccessToken && amoPipelineId && amoStatusId),
    /** Базовый URL аккаунта без завершающего слеша. */
    baseUrl: amoBaseUrl,
    /** Долгосрочный токен доступа (от 1 дня до 5 лет). */
    accessToken: amoAccessToken,
    /** Воронка, в которой создаются сделки с сайта. */
    pipelineId: amoPipelineId,
    /** Начальный этап «Новая заявка». */
    statusId: amoStatusId,
    /** Таймаут запроса к amoCRM, мс. */
    timeoutMs: envNumber("AMOCRM_TIMEOUT_MS", 10_000),
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

  cms: {
    /** Включена ли админка: нужны и учётки, и секрет для подписи сессий. */
    enabled: cmsUsers.size > 0 && Boolean(cmsSessionSecret),
    /** Заданы ли учётки (для внятного предупреждения на старте). */
    hasUsers: cmsUsers.size > 0,
    /** Задан ли секрет сессий. */
    hasSecret: Boolean(cmsSessionSecret),
    /** Логин → пароль (открытым текстом, из CMS_USERS). */
    users: cmsUsers,
    /** Секрет для HMAC-подписи cookie-сессии (CMS_SESSION_SECRET). */
    sessionSecret: cmsSessionSecret,
    /** Имя cookie сессии. */
    cookieName: process.env.CMS_COOKIE_NAME?.trim() || "bars_cms",
    /** Время жизни сессии, мс (по умолчанию 12 часов). */
    sessionTtlMs: envNumber("CMS_SESSION_TTL_MS", 12 * 60 * 60 * 1000),
    /**
     * Ставить ли на cookie флаг Secure. По умолчанию да (прод за HTTPS).
     * Для локального теста по http выставьте CMS_COOKIE_INSECURE=true.
     */
    cookieSecure: process.env.CMS_COOKIE_INSECURE !== "true",
    /** Куда проксируем протокол Decap — локальный decap-server (git-режим). */
    proxyTarget: process.env.CMS_PROXY_TARGET?.trim() || "http://127.0.0.1:8081/api/v1",
    /** Команда пересборки сайта после правок в CMS. */
    rebuildCmd: process.env.CMS_REBUILD_CMD?.trim() || "npm run build:11ty",
    /** Задержка перед пересборкой (склеивает серию сохранений), мс. */
    rebuildDebounceMs: envNumber("CMS_REBUILD_DEBOUNCE_MS", 3000),
    /** Предел тела запроса к CMS: включает base64 картинок, поэтому щедрый. */
    maxBodyBytes: envNumber("CMS_MAX_BODY_BYTES", 25 * 1024 * 1024),
  },
} as const;
