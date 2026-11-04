/**
 * HTTP для лидогенерации: пауза между запросами со случайной добавкой, повторы с растущей паузой на 429 / 5xx /
 * обрыв связи, прокси (WB_PROXY для WB, иначе стандартные HTTPS_PROXY / NO_PROXY), ключи в логах скрыты.
 */

import { type Dispatcher, EnvHttpProxyAgent, fetch, ProxyAgent } from "undici";

/** Ключи и токены из адреса — не в лог. */
export function redact(url: string): string {
  return url.replace(/([?&](?:key|token|api_key|apikey|access_token)=)[^&#]*/gi, "$1***");
}

/** Ошибка запроса. transient — временная (сеть, 429, 5xx): задачу можно продолжить позже с того же места. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524, 529]);

export const sleep = (ms: number, stop?: () => boolean) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const end = Date.now() + ms;
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0 || stop?.()) return resolve();
      setTimeout(tick, Math.min(left, 1000));
    };
    tick();
  });

let envAgent: Dispatcher | null = null;
const proxyAgents = new Map<string, Dispatcher>();

function dispatcherFor(proxy?: string): Dispatcher {
  if (proxy) {
    let agent = proxyAgents.get(proxy);
    if (!agent) proxyAgents.set(proxy, (agent = new ProxyAgent(proxy)));
    return agent;
  }
  return (envAgent ??= new EnvHttpProxyAgent());
}

export type HttpOptions = {
  /** Имя для логов и ошибок: «WB», «DaData». */
  name: string;
  minDelayMs?: number;
  jitterMs?: number;
  /** Повторов на временные ошибки (паузы 2, 4, 8, 16… с). */
  retries?: number;
  timeoutMs?: number;
  proxy?: string;
  /** Остановить ожидание (задачу остановили). */
  stop?: () => boolean;
  log?: (msg: string) => void;
};

export type HttpResponse = { status: number; text: string; contentType: string; url: string };

/** Клиент с общим темпом: запросы через него идут не чаще minDelay + случайно до jitter. */
export class Http {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();
  count = 0;

  constructor(readonly opts: HttpOptions) {}

  private async pace(): Promise<void> {
    const delay = (this.opts.minDelayMs ?? 0) + Math.random() * (this.opts.jitterMs ?? 0);
    const wait = this.last + delay - Date.now();
    if (wait > 0) await sleep(wait, this.opts.stop);
    this.last = Date.now();
  }

  /** Запрос по очереди (не параллельно). 404/403/400 и т.п. возвращаются как есть — решает вызывающий. */
  request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number } = {}): Promise<HttpResponse> {
    const run = this.chain.then(() => this.requestNow(url, init));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async requestNow(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number }): Promise<HttpResponse> {
    const retries = this.opts.retries ?? 6;
    for (let attempt = 0; ; attempt++) {
      await this.pace();
      this.count++;
      let status = 0;
      let problem = "";
      let retryAfter = 0;
      try {
        const res = await fetch(url, {
          method: init.method ?? "GET",
          headers: init.headers,
          body: init.body,
          redirect: "follow",
          dispatcher: dispatcherFor(this.opts.proxy),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
        });
        status = res.status;
        if (!TRANSIENT_STATUS.has(status)) {
          const text = await readLimited(res, init.maxBytes ?? 8 * 1024 * 1024);
          return { status, text, contentType: res.headers.get("content-type") ?? "", url: res.url || url };
        }
        retryAfter = Number(res.headers.get("retry-after")) || 0;
        await res.body?.cancel().catch(() => undefined);
        problem = `HTTP ${status}`;
      } catch (error) {
        problem = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
      }
      if (attempt >= retries || this.opts.stop?.()) {
        throw new FetchError(`${this.opts.name}: ${problem} — ${redact(url)}`, status, true);
      }
      const pause = Math.max(retryAfter * 1000, 2000 * 2 ** attempt) + Math.random() * 1000;
      this.opts.log?.(`${this.opts.name}: ${problem}, повтор через ${Math.round(pause / 1000)} с — ${redact(url)}`);
      await sleep(pause, this.opts.stop);
    }
  }

  /** JSON: 404 → null; прочие не-2xx — ошибка (403 у WB — обычно не российский IP). */
  async json<T = unknown>(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; data: T | null }> {
    const res = await this.request(url, init);
    if (res.status === 404 || res.status === 204) return { status: res.status, data: null };
    if (res.status < 200 || res.status >= 300) {
      throw new FetchError(`${this.opts.name}: HTTP ${res.status} — ${redact(url)}${res.text ? ` — ${res.text.slice(0, 200).replace(/\s+/g, " ")}` : ""}`, res.status, false);
    }
    try {
      return { status: res.status, data: res.text ? (JSON.parse(res.text) as T) : null };
    } catch {
      throw new FetchError(`${this.opts.name}: ответ не JSON — ${redact(url)}`, res.status, false);
    }
  }
}

async function readLimited(res: Awaited<ReturnType<typeof fetch>>, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    size += chunk.length;
    if (size >= maxBytes) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}
