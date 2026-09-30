/** Клиент API v4 amoCRM для создания сделки, контакта и примечания. */

import { config, maskSecrets } from "./config.ts";
import type { AmoLeadData } from "./lead.ts";

export class AmoCrmError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = "AMOCRM_ERROR", retryable = false) {
    super(message);
    this.name = "AmoCrmError";
    this.code = code;
    this.retryable = retryable;
  }
}

interface AmoProblem {
  title?: string;
  detail?: string;
  status?: number;
  validation_errors?: unknown;
}

interface ComplexLeadResponse {
  _embedded?: { leads?: Array<{ id?: number; request_id?: string }> };
}

async function callApi(path: string, body: unknown): Promise<unknown> {
  const url = `${config.amocrm.baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.amocrm.accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.amocrm.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AmoCrmError(`Сеть недоступна при вызове ${url}: ${maskSecrets(reason)}`, "NETWORK_ERROR", true);
  }

  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new AmoCrmError(
        `amoCRM вернула не-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`,
        "BAD_RESPONSE",
        response.status >= 500,
      );
    }
  }

  if (!response.ok) {
    const problem = parsed as AmoProblem;
    const details = problem.detail || problem.title || JSON.stringify(problem.validation_errors ?? parsed);
    throw new AmoCrmError(
      `amoCRM ответила HTTP ${response.status}: ${details}`,
      `HTTP_${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  }
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Повторяет только временные ошибки amoCRM. */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: AmoCrmError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof AmoCrmError ? error : new AmoCrmError(String(error));
      if (!lastError.retryable || attempt === 2) break;
      await delay(500 * 2 ** attempt);
    }
  }
  throw lastError ?? new AmoCrmError("Неизвестная ошибка amoCRM");
}

/** Создаёт сделку со связанным контактом и возвращает ID сделки. */
export async function createLead(data: AmoLeadData): Promise<number> {
  const response = await withRetry(() => callApi("/api/v4/leads/complex", [data.lead])) as ComplexLeadResponse;
  const id = Number(response._embedded?.leads?.[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AmoCrmError(`Неожиданный ответ leads/complex: ${JSON.stringify(response)}`, "BAD_RESULT");
  }

  // Сделка уже создана: сбой примечания не должен заставлять браузер повторить
  // заявку и создать дубль. Ошибку фиксируем, а заявку считаем принятой.
  try {
    await withRetry(() => callApi(`/api/v4/leads/${id}/notes`, [
      { note_type: "common", params: { text: data.note } },
    ]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lead] сделка #${id} создана, но примечание не добавлено: ${maskSecrets(message)}`);
  }

  return id;
}
