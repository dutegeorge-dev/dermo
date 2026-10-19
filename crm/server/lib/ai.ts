/**
 * Клиент Claude для разбора документов и чата. Ключ и адрес шлюза — в crm/.env
 * (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN или ANTHROPIC_API_KEY); без них ИИ выключен.
 */

import Anthropic from "@anthropic-ai/sdk";

import { config } from "../config.ts";
import { HttpError } from "./http.ts";

let client: Anthropic | null = null;

export function aiEnabled(): boolean {
  return Boolean(config.ai.apiKey || config.ai.authToken);
}

export function aiClient(): Anthropic {
  if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён: задайте ключ в crm/.env (см. .env.example)");
  client ??= new Anthropic({
    baseURL: config.ai.baseUrl,
    apiKey: config.ai.apiKey ?? null,
    authToken: config.ai.authToken ?? null,
    timeout: 3 * 60 * 1000,
    maxRetries: 2,
  });
  return client;
}

/**
 * Общие параметры запроса. Серверный запасной вариант на случай отказа (fallbacks) есть
 * только у Opus / Sonnet / Fable — у дешёвой Haiku его нет.
 */
export function aiBase(): { model: string; betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: "default" } {
  const model = config.ai.model;
  if (!/opus|sonnet|fable/.test(model)) return { model };
  return { model, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

export type AiUsage = { input: number; cacheRead: number; output: number };

export function usageOf(response: Anthropic.Beta.BetaMessage): AiUsage {
  const u = response.usage;
  return { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
}

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return { input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, output: a.output + b.output };
}

/** Понятное сообщение вместо технической ошибки API. */
export function aiError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  // Шлюз отвечает 403 {"code":"INSUFFICIENT_BALANCE"} (или 402), когда кончились баланс / лимит — это не ключ.
  if (error instanceof Anthropic.APIError && (error.status === 402 || /INSUFFICIENT_BALANCE|insufficient|balance|quota/i.test(JSON.stringify(error.error ?? "") + error.message))) {
    return new HttpError(402, "ИИ: на шлюзе закончился баланс / лимит токенов — пополните его в личном кабинете claude-gateway.ru");
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, "ИИ: ключ не принят — проверьте ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY");
  }
  if (error instanceof Anthropic.RateLimitError) return new HttpError(429, "ИИ перегружен или исчерпан лимит — повторите через минуту");
  if (error instanceof Anthropic.APIConnectionError) return new HttpError(502, "ИИ: нет связи с сервисом, повторите позже");
  if (error instanceof Anthropic.BadRequestError) return new HttpError(502, `ИИ отклонил запрос: ${error.message}`);
  if (error instanceof Anthropic.APIError) return new HttpError(502, `ИИ: ошибка сервиса (${error.status ?? "?"})`);
  return new HttpError(502, "ИИ: не удалось получить ответ");
}
