/**
 * Fastify-приложение раздела /crm/: API под /crm/api/ и SPA под /crm/.
 * Сборка вынесена из index.ts, чтобы тесты могли поднимать его без сети.
 */

import fs from "node:fs";
import path from "node:path";

import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { config } from "./config.ts";
import { HttpError } from "./lib/http.ts";
import { loadSession, safeEqual } from "./lib/session.ts";
import { auditRoutes } from "./routes/audit.ts";
import { authRoutes } from "./routes/auth.ts";
import { callRoutes } from "./routes/calls.ts";
import { fileRoutes } from "./routes/files.ts";
import { kbRoutes } from "./routes/kb.ts";
import { searchRoutes } from "./routes/search.ts";
import { userRoutes } from "./routes/users.ts";

const API_PREFIX = `${config.basePath}/api`;

/** Маршруты API, доступные без входа. */
const PUBLIC_API = new Set([`${API_PREFIX}/auth/login`, `${API_PREFIX}/health`]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Изменяющий запрос пришёл с нашего сайта? Сравниваем Origin с разрешёнными и с Host. */
function originAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    // Браузеры шлют Origin на все POST/PUT/PATCH/DELETE с fetch. Без него —
    // это не браузер (curl, тесты): защищаться от CSRF там не от чего.
    return true;
  }
  const normalized = origin.replace(/\/$/, "");
  if (config.allowedOrigins.includes(normalized)) return true;
  try {
    return new URL(normalized).host === request.headers.host;
  } catch {
    return false;
  }
}

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorateRequest("user", null);
  app.decorateRequest("sessionInfo", null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

  // Раздел не индексируется — на любой ответ, включая ошибки и статику.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-robots-tag", "noindex, nofollow");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    reply.header("x-frame-options", "SAMEORIGIN");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .status(error.statusCode)
        .send({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply
        .status(413)
        .send({ error: `Файл больше ${Math.round(config.maxUploadBytes / 1024 / 1024)} МБ` });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: "Некорректный запрос" });
    }
    request.log.error(error);
    return reply.status(500).send({ error: "Внутренняя ошибка сервера" });
  });

  // ── API ──────────────────────────────────────────────────────────────────
  await app.register(
    async (api) => {
      api.addHook("onRequest", async (request, reply) => {
        reply.header("cache-control", "no-store");
        await loadSession(request, reply);

        const url = request.routeOptions.url ?? request.url.split("?")[0];
        if (!PUBLIC_API.has(url) && !request.user) {
          throw new HttpError(401, "Требуется вход");
        }

        if (!SAFE_METHODS.has(request.method)) {
          if (!originAllowed(request)) throw new HttpError(403, "Запрос с чужого сайта отклонён");
          if (request.sessionInfo) {
            const token = request.headers["x-csrf-token"];
            if (typeof token !== "string" || !safeEqual(token, request.sessionInfo.csrfToken)) {
              throw new HttpError(403, "Сессия устарела, обновите страницу");
            }
          }
        }
      });

      api.get("/health", async () => ({ ok: true }));

      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(userRoutes, { prefix: "/users" });
      await api.register(kbRoutes, { prefix: "/kb" });
      await api.register(fileRoutes);
      await api.register(callRoutes, { prefix: "/calls" });
      await api.register(searchRoutes, { prefix: "/search" });
      await api.register(auditRoutes, { prefix: "/audit" });
    },
    { prefix: API_PREFIX },
  );

  // ── SPA ──────────────────────────────────────────────────────────────────
  const indexFile = path.join(config.webDist, "index.html");
  const hasWeb = fs.existsSync(indexFile);

  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: `${config.basePath}/`,
      index: false,
      wildcard: true,
      setHeaders(reply, filePath) {
        // Файлы в assets/ содержат хэш в имени — их можно кэшировать надолго.
        reply.header(
          "cache-control",
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
  }

  app.get(config.basePath, async (_request, reply) => reply.redirect(`${config.basePath}/`, 301));

  const sendIndex = (reply: FastifyReply) =>
    reply.header("cache-control", "no-store").type("text/html; charset=utf-8").send(fs.createReadStream(indexFile));

  if (hasWeb) app.get(`${config.basePath}/`, async (_request, reply) => sendIndex(reply));

  app.setNotFoundHandler(async (request, reply) => {
    const url = request.url.split("?")[0];
    if (url.startsWith(`${API_PREFIX}/`) || url === API_PREFIX) {
      return reply.status(404).send({ error: "Не найдено" });
    }
    // Любой другой путь под /crm/ — маршрут SPA: отдаём index.html.
    if (request.method === "GET" && url.startsWith(`${config.basePath}/`) && hasWeb && !path.extname(url)) {
      return sendIndex(reply);
    }
    return reply.status(404).type("text/plain; charset=utf-8").send("Не найдено");
  });

  return app;
}
