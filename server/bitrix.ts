/**
 * Клиент REST-вебхука Bitrix24.
 *
 * Используется единственный метод — `crm.lead.add`. Вызов идёт POST-запросом
 * с JSON-телом `{ fields, params }`; токен живёт в URL вебхука и не логируется.
 */

import { config, maskSecrets } from "./config.ts";
import type { LeadFields } from "./lead.ts";

/**
 * Ошибка вызова Bitrix24 REST (сеть, HTTP или error в теле ответа).
 *
 * Поля присваиваются явно, а не через parameter properties: так весь код
 * `server/` остаётся «стираемым» TypeScript и запускается штатным Node
 * (≥ 22.18) без сборки и без tsx — удобно для systemd на проде.
 */
export class BitrixError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = "BITRIX_ERROR", retryable = false) {
    super(message);
    this.name = "BitrixError";
    this.code = code;
    this.retryable = retryable;
  }
}

interface BitrixResponse {
  result?: unknown;
  error?: string;
  error_description?: string;
}

/** Один вызов метода REST с таймаутом. */
async function callMethod(method: string, params: unknown): Promise<unknown> {
  const url = config.bitrix.method(method);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(config.bitrix.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BitrixError(
      `Сеть недоступна при вызове ${maskSecrets(url)}: ${reason}`,
      "NETWORK_ERROR",
      true,
    );
  }

  const text = await response.text();
  let body: BitrixResponse = {};
  if (text) {
    try {
      body = JSON.parse(text) as BitrixResponse;
    } catch {
      throw new BitrixError(
        `Bitrix24 вернул не-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`,
        "BAD_RESPONSE",
        response.status >= 500,
      );
    }
  }

  if (body.error) {
    throw new BitrixError(
      `${body.error}: ${body.error_description ?? "без описания"}`,
      body.error,
      // Троттлинг и внутренние сбои портала имеет смысл повторить.
      ["QUERY_LIMIT_EXCEEDED", "OPERATION_TIME_LIMIT", "INTERNAL_SERVER_ERROR"].includes(
        body.error,
      ),
    );
  }

  if (!response.ok) {
    throw new BitrixError(
      `Bitrix24 ответил HTTP ${response.status}`,
      "HTTP_ERROR",
      response.status >= 500 || response.status === 429,
    );
  }

  return body.result;
}

/** Пауза между повторными попытками. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Создаёт лид и возвращает его ID.
 *
 * Ретраим только временные ошибки (сеть, троттлинг, 5xx): повтор на ошибке
 * валидации создал бы дубль. Отдельно обрабатываем поле IM (Telegram) —
 * на порталах, где мессенджер-поле недоступно, лид пересоздаётся без него,
 * контакт при этом остаётся в COMMENTS.
 */
export async function createLead(fields: LeadFields): Promise<number> {
  const attempt = async (payloadFields: LeadFields): Promise<number> => {
    let lastError: BitrixError | undefined;

    for (let i = 0; i < 3; i += 1) {
      try {
        const result = await callMethod("crm.lead.add", {
          fields: payloadFields,
          params: { REGISTER_SONET_EVENT: "Y" },
        });
        const id = Number(result);
        if (!Number.isFinite(id) || id <= 0) {
          throw new BitrixError(
            `Неожиданный ответ crm.lead.add: ${JSON.stringify(result)}`,
            "BAD_RESULT",
          );
        }
        return id;
      } catch (error) {
        lastError = error instanceof BitrixError
          ? error
          : new BitrixError(String(error));
        if (!lastError.retryable || i === 2) break;
        await delay(500 * 2 ** i);
      }
    }

    throw lastError ?? new BitrixError("Неизвестная ошибка crm.lead.add");
  };

  try {
    return await attempt(fields);
  } catch (error) {
    const isImProblem =
      error instanceof BitrixError &&
      "IM" in fields &&
      /IM|мессендж|messenger/i.test(error.message);

    if (!isImProblem) throw error;

    const { IM: _im, ...withoutIm } = fields;
    console.warn("[lead] портал не принял поле IM, повторяем без него");
    return attempt(withoutIm);
  }
}
