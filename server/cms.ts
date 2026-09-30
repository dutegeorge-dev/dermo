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
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

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

interface CmsRequest {
  action?: unknown;
  params?: { mediaFolder?: unknown };
}

interface MediaPreview {
  id: string;
  content: string;
  encoding: "base64";
  path: string;
  name: string;
}

const mediaPreviewCache = new Map<string, { version: string; preview: MediaPreview }>();
const PREVIEW_SIZE = 480;

/** Делает безопасный путь внутри репозитория. */
function repoPath(relativePath: string): string {
  const absolute = path.resolve(ROOT, relativePath);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("Путь медиатеки выходит за пределы репозитория");
  }
  return absolute;
}

/** Уменьшает изображение, сохраняя его формат, чтобы MIME совпадал с именем. */
async function resizeMedia(buffer: Buffer, extension: string): Promise<Buffer> {
  const image = sharp(buffer, { animated: false }).rotate().resize({
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    fit: "inside",
    withoutEnlargement: true,
  });

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return image.jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    case ".png":
      return image.png({ compressionLevel: 9, palette: true, quality: 72 }).toBuffer();
    case ".webp":
      return image.webp({ quality: 72 }).toBuffer();
    case ".gif":
      return image.gif().toBuffer();
    case ".avif":
      return image.avif({ quality: 55 }).toBuffer();
    default:
      return buffer;
  }
}

/** Превью одного файла с кэшем по размеру и времени изменения. */
async function mediaPreview(folder: string, name: string): Promise<MediaPreview> {
  const relativePath = path.posix.join(folder.replace(/\\/g, "/"), name);
  const absolutePath = repoPath(relativePath);
  const stat = await fs.stat(absolutePath);
  const version = `${stat.size}:${stat.mtimeMs}`;
  const cached = mediaPreviewCache.get(relativePath);
  if (cached?.version === version) return cached.preview;

  const original = await fs.readFile(absolutePath);
  const id = createHash("sha256").update(original).digest("hex");
  let thumbnail: Buffer = original;
  try {
    thumbnail = await resizeMedia(original, path.extname(name).toLowerCase());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[cms] не удалось сделать превью ${relativePath}: ${message}`);
  }

  const preview: MediaPreview = {
    id,
    content: thumbnail.toString("base64"),
    encoding: "base64",
    path: relativePath,
    name,
  };
  mediaPreviewCache.set(relativePath, { version, preview });
  return preview;
}

/**
 * Возвращает лёгкий индекс медиатеки вместо оригиналов в base64.
 * Полный файл Decap запросит отдельно через getMediaFile при необходимости.
 */
async function mediaIndex(mediaFolder: string): Promise<Response> {
  const startedAt = Date.now();
  const absoluteFolder = repoPath(mediaFolder);
  const entries = await fs.readdir(absoluteFolder, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const previews: MediaPreview[] = [];
  // Последовательная обработка не загружает все оригиналы одновременно в RAM.
  for (const name of files) previews.push(await mediaPreview(mediaFolder, name));

  const body = JSON.stringify(previews);
  console.log(
    `[cms] getMedia: ${files.length} превью, ${Buffer.byteLength(body)} байт за ${Date.now() - startedAt} мс`,
  );
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
    },
  });
}

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
  let request: CmsRequest = {};
  try {
    request = JSON.parse(bodyText) as CmsRequest;
    if (typeof request.action === "string") action = request.action;
  } catch {
    // Валидацию тела выполнит decap-server; имя нужно только для диагностики.
  }

  if (action === "getMedia" && typeof request.params?.mediaFolder === "string") {
    try {
      return await mediaIndex(request.params.mediaFolder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cms] индекс медиатеки недоступен: ${message}`);
      return Response.json({ error: "Не удалось загрузить медиатеку." }, { status: 500 });
    }
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
    if (MUTATING_ACTIONS.has(action)) {
      if (/Media|File/.test(action)) mediaPreviewCache.clear();
      scheduleRebuild();
    }
  }

  const bytes = response.headers.get("content-length") ?? "неизвестно";
  console.log(
    `[cms] ${action}: ответ ${response.status}, ${bytes} байт, заголовки за ${Date.now() - startedAt} мс`,
  );
  return response;
}
