/**
 * Конфигурация сервиса /crm/.
 *
 * Значения берутся из окружения и из crm/.env (он в .gitignore; образец —
 * crm/.env.example). Уже заданные переменные окружения приоритетнее файла —
 * так их можно переопределить в systemd или одноразовым запуском.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Корень пакета crm/. */
export const CRM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Читает `KEY=value` из файла в process.env (кавычки, комментарии, export). */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(CRM_ROOT, ".env"));

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  isProduction,
  databaseUrl: process.env.DATABASE_URL?.trim() ?? "",
  host: process.env.CRM_HOST?.trim() || "127.0.0.1",
  port: envNumber("CRM_PORT", 3100),
  /** Базовый путь раздела: всё — и SPA, и API — живёт под ним. */
  basePath: "/crm",
  /** Разрешённые Origin для изменяющих запросов (через запятую). */
  allowedOrigins: (process.env.CRM_ORIGIN ?? "https://tlkbars.ru")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
  uploadDir: path.resolve(CRM_ROOT, process.env.CRM_UPLOAD_DIR?.trim() || "uploads"),
  maxUploadBytes: envNumber("CRM_MAX_UPLOAD_MB", 25) * 1024 * 1024,
  session: {
    cookieName: "bars_crm_session",
    ttlMs: envNumber("CRM_SESSION_DAYS", 30) * 24 * 60 * 60 * 1000,
    secure: envBool("CRM_COOKIE_SECURE", true),
  },
  /** Сервис стоит за nginx на этой же машине (X-Forwarded-For от 127.0.0.1). */
  trustProxy: envBool("CRM_TRUST_PROXY", true),
  /** Собранный фронтенд (vite build). */
  webDist: path.join(CRM_ROOT, "web", "dist"),
  loginLimit: {
    /** Неудачных попыток на один логин за окно. */
    perLogin: envNumber("CRM_LOGIN_LIMIT_PER_LOGIN", 5),
    /** Попыток (любых) с одного IP за окно. */
    perIp: envNumber("CRM_LOGIN_LIMIT_PER_IP", 20),
    windowMs: envNumber("CRM_LOGIN_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  },
};

export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error("Не задан DATABASE_URL (см. crm/.env.example)");
  }
  return config.databaseUrl;
}
