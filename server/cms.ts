/**
 * Мост между админкой Decap и файлами сайта на этом же сервере.
 *
 * Decap (backend: proxy) шлёт JSON-RPC вида {action, params} на /api/cms/v1.
 * Мы, убедившись в сессии, пробрасываем это на локальный decap-server
 * (127.0.0.1:8081, git-режим), который читает/пишет файлы в репозитории и
 * делает локальный git-коммит на каждое сохранение (история для отката).
 *
 * После записи планируем пересборку статики (11ty), чтобы правка появилась
 * на сайте. Никакого GitHub: всё остаётся на этом VDS.
 */

import { spawn } from "node:child_process";

import { config, ROOT } from "./config.ts";

/** Действия Decap, меняющие файлы — после них нужна пересборка сайта. */
const MUTATING_ACTIONS = new Set([
  "persistEntry",
  "persistMedia",
  "deleteEntry",
  "deleteEntries",
  "deleteFile",
  "deleteFiles",
]);

// ── Пересборка сайта: с дебаунсом и без наложения запусков ──────────────────
let rebuildTimer: NodeJS.Timeout | null = null;
let building = false;
let rebuildQueued = false;

function runRebuild(): void {
  if (building) {
    // Уже собираем — запомним, что за это время были новые правки.
    rebuildQueued = true;
    return;
  }
  building = true;
  console.log(`[cms] пересборка сайта: ${config.cms.rebuildCmd}`);
  const child = spawn(config.cms.rebuildCmd, {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
  });
  child.on("close", (code) => {
    building = false;
    if (code === 0) {
      console.log("[cms] пересборка завершена");
    } else {
      console.error(`[cms] пересборка завершилась с кодом ${code}`);
    }
    if (rebuildQueued) {
      rebuildQueued = false;
      scheduleRebuild();
    }
  });
  child.on("error", (error) => {
    building = false;
    console.error(`[cms] не удалось запустить пересборку: ${error.message}`);
  });
}

/** Планирует пересборку с дебаунсом (склеивает серию сохранений). */
export function scheduleRebuild(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    runRebuild();
  }, config.cms.rebuildDebounceMs);
}

/**
 * Пробрасывает тело запроса на локальный decap-server и возвращает поток ответа.
 * Если действие меняло файлы и ответ успешный — планирует пересборку.
 *
 * Ответ намеренно не преобразуется через `response.text()`: getMedia кодирует
 * всю медиатеку в base64 и на реальном сайте может вернуть десятки мегабайт.
 * Поток не создаёт вторую полную копию JSON в памяти процесса bars-lead.
 */
export async function proxyCms(bodyText: string): Promise<Response> {
  const startedAt = Date.now();
  let action = "unknown";
  try {
    const parsed = JSON.parse(bodyText) as { action?: unknown };
    if (typeof parsed.action === "string") action = parsed.action;
  } catch {
    // Валидацию тела выполнит decap-server; имя нужно только для диагностики.
  }

  let response: Response;
  try {
    response = await fetch(config.cms.proxyTarget, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cms] decap-server недоступен: ${message}`);
    return Response.json(
      { error: "CMS-бэкенд недоступен. Проверьте службу decap-server." },
      { status: 502 },
    );
  }

  if (response.ok) {
    if (MUTATING_ACTIONS.has(action)) scheduleRebuild();
  }

  const bytes = response.headers.get("content-length") ?? "неизвестно";
  console.log(
    `[cms] ${action}: ответ ${response.status}, ${bytes} байт, заголовки за ${Date.now() - startedAt} мс`,
  );
  return response;
}
