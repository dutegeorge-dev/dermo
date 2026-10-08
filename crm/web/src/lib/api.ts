/** Клиент API /crm/api: JSON, CSRF-токен, единая обработка ошибок. */

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // "/crm"
const API = `${BASE}/api`;

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? null;
}

/** Вызывается, когда сессия истекла посреди работы. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(path: string, options: { method?: Method; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и повторите.");
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/me") onUnauthorized?.();
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Ошибка ${res.status}`);
  }
  return data as T;
}

export const fileUrl = (id: string) => `${API}/files/${id}`;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Что-то пошло не так";
}
