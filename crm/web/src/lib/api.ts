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
    /** Тело ответа с ошибкой (например, offset у 409 при загрузке кусками). */
    readonly data?: unknown,
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

/** Запрос, который отдаёт файл (Excel, ZIP): скачивает его под именем из Content-Disposition. */
export async function apiDownload(path: string, options: { method?: Method; form?: FormData } = {}): Promise<void> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers, credentials: "same-origin", body: options.form });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и повторите.");
  }
  if (!res.ok) {
    const data = res.headers.get("content-type")?.includes("application/json") ? await res.json().catch(() => null) : null;
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Ошибка ${res.status}`);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  const name = star ? decodeURIComponent(star) : (/filename="([^"]+)"/.exec(cd)?.[1] ?? "file");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Отправка файла / куска файла с прогрессом (fetch его не показывает): ответ — JSON, как у api(). */
export function apiUpload<T>(
  path: string,
  data: FormData | Blob,
  options: { method?: "POST" | "PUT"; onProgress?: (part: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? "POST", `${API}${path}`);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader("x-csrf-token", csrfToken);
    if (data instanceof Blob && !(data instanceof File)) xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.responseType = "json";
    if (options.onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && options.onProgress!(e.loaded / e.total);
    options.signal?.addEventListener("abort", () => xhr.abort());
    xhr.onerror = () => reject(new ApiError(0, "Нет связи с сервером"));
    xhr.ontimeout = () => reject(new ApiError(0, "Нет связи с сервером"));
    xhr.onabort = () => reject(new ApiError(-1, "Загрузка остановлена"));
    xhr.onload = () => {
      const res = xhr.response as ({ error?: string } & T) | null;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(res as T);
      if (xhr.status === 401) onUnauthorized?.();
      reject(new ApiError(xhr.status, res?.error ?? (xhr.status === 413 ? "Слишком большой запрос для сервера" : `Ошибка ${xhr.status}`), res));
    };
    xhr.send(data);
  });
}
