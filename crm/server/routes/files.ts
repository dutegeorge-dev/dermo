/**
 * Вложения: загрузка, выдача, удаление. Файлы лежат на диске в CRM_UPLOAD_DIR,
 * в БД — метаданные. Отдаются только вошедшим пользователям (проверка сессии
 * общая для всего API).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { config } from "../config.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { FACTORY_FILE_LABELS } from "../../shared/factories.ts";
import { attachments, deals, documents, factories, kbPages, payments, shipments } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { addEvent, documentLabel, parseDealKey } from "../lib/deals.ts";
import { getFactory } from "../lib/factories.ts";
import { currentUser, HttpError, intParam } from "../lib/http.ts";
import { flagDocuments, PAYMENT_FLAGS, type PaymentFlag } from "../lib/payments.ts";
import { parseShipmentNumber } from "../lib/shipments.ts";

/** Эти типы безопасно показывать прямо в браузере; остальное — только скачиванием. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

function storagePath(key: string): string {
  const full = path.resolve(config.uploadDir, key);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new HttpError(400, "Некорректный путь");
  return full;
}

/** Удаляет записи о вложениях владельцев и возвращает ключи файлов (удалить после коммита). */
export async function deleteAttachmentRows(tx: DbOrTx, ownerType: string, ownerIds: number[]): Promise<string[]> {
  if (ownerIds.length === 0) return [];
  const rows = await tx
    .delete(attachments)
    .where(and(eq(attachments.ownerType, ownerType), inArray(attachments.ownerId, ownerIds)))
    .returning({ key: attachments.storageKey });
  return rows.map((r) => r.key);
}

export async function unlinkStoredFiles(keys: string[]): Promise<void> {
  for (const key of keys) {
    await fs.promises.rm(storagePath(key), { force: true });
  }
}

function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Сохраняет сформированный системой файл (спецификация, пакет…) как вложение. */
export async function storeBuffer(
  tx: DbOrTx,
  owner: { type: string; id: number },
  file: { filename: string; mime: string; buffer: Buffer; label?: string | null },
  userId: number | null,
): Promise<string> {
  const id = crypto.randomUUID();
  const key = `${new Date().toISOString().slice(0, 7)}/${id}`;
  const target = storagePath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, file.buffer);
  await tx.insert(attachments).values({
    id,
    ownerType: owner.type,
    ownerId: owner.id,
    filename: file.filename.slice(0, 200),
    mime: file.mime,
    size: file.buffer.length,
    storageKey: key,
    label: file.label ?? null,
    createdBy: userId,
  });
  return id;
}

/** Содержимое сохранённого файла по ключу хранения. */
export const readStored = (key: string): Promise<Buffer> => fs.promises.readFile(storagePath(key));

/** Принимает файл из multipart-запроса (поле file), кладёт на диск и в attachments. */
async function saveUpload(request: FastifyRequest, ownerType: string, ownerId: number, ownerLabel: string, label: string | null = null) {
  const user = currentUser(request);
  const file = await request.file();
  if (!file) throw new HttpError(400, "Файл не передан");

  const filename = path.basename(file.filename || "file").slice(0, 200) || "file";
  const id = crypto.randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const key = `${month}/${id}`;
  const target = storagePath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await pipeline(file.file, fs.createWriteStream(target));
  if (file.file.truncated) {
    await fs.promises.rm(target, { force: true });
    throw new HttpError(413, `Файл больше ${Math.round(config.maxUploadBytes / 1024 / 1024)} МБ`);
  }
  const { size } = await fs.promises.stat(target);

  const [created] = await db
    .insert(attachments)
    .values({
      id,
      ownerType,
      ownerId,
      filename,
      mime: file.mimetype || "application/octet-stream",
      size,
      storageKey: key,
      label,
      createdBy: user.id,
    })
    .returning();
  await audit(db, {
    userId: user.id,
    action: "create",
    entityType: "attachment",
    entityId: id,
    summary: `Прикрепил файл «${filename}» ${ownerLabel}`,
    ip: request.ip,
  });
  return {
    id: created.id,
    filename: created.filename,
    mime: created.mime,
    size: created.size,
    createdAt: created.createdAt,
    label: created.label,
    createdByName: user.name,
    url: `${config.basePath}/api/files/${created.id}`,
  };
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  /** Загрузка вложения к странице базы знаний (multipart, поле file). */
  app.post("/kb/pages/:id/attachments", async (request) => {
    const pageId = intParam((request.params as { id: string }).id);
    const [page] = await db.select({ id: kbPages.id, title: kbPages.title }).from(kbPages).where(eq(kbPages.id, pageId));
    if (!page) throw new HttpError(404, "Страница не найдена");
    return { attachment: await saveUpload(request, "kb_page", pageId, `к странице «${page.title}»`) };
  });

  /** Загрузка вложения к сделке. */
  app.post("/deals/:key/attachments", async (request) => {
    const number = parseDealKey((request.params as { key: string }).key);
    const [deal] = await db.select({ id: deals.id, key: deals.key }).from(deals).where(eq(deals.number, number));
    if (!deal) throw new HttpError(404, "Сделка не найдена");
    const attachment = await saveUpload(request, "deal", deal.id, `к сделке ${deal.key}`);
    await addEvent(db, deal.id, currentUser(request).id, "attachment_added", null, null, attachment.filename);
    return { attachment };
  });

  /** Файл документа. ?label=original|signed|payment — как прислали / подписанный скан / документ об оплате. */
  app.post("/documents/:id/files", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, id));
    if (!doc) throw new HttpError(404, "Документ не найден");
    const raw = (request.query as { label?: string }).label;
    // original — как прислали, signed — подписанный скан, payment — документ об оплате (платёжка, SWIFT).
    const label = raw === "signed" || raw === "original" || raw === "payment" ? raw : null;
    const attachment = await saveUpload(request, "document", id, `к документу «${await documentLabel(db, id)}»`, label);
    // Загрузили подписанный скан — документ подписан.
    if (label === "signed") await db.update(documents).set({ status: "signed", updatedAt: new Date() }).where(eq(documents.id, id));
    return { attachment };
  });

  /** Файл фабрики: ?label=photo|catalog|screenshot — фото товара / каталог, прайс / скриншот переписки. */
  app.post("/factories/:id/files", async (request) => {
    const factory = await getFactory(db, currentUser(request), intParam((request.params as { id: string }).id));
    const raw = (request.query as { label?: string }).label ?? "";
    const label = raw in FACTORY_FILE_LABELS ? raw : null;
    const attachment = await saveUpload(request, "factory", factory.id, `к фабрике «${factory.name}»`, label);
    await db.update(factories).set({ updatedAt: new Date() }).where(eq(factories.id, factory.id));
    return { attachment };
  });

  /** Файл оплаты на несколько счетов (платёжка, SWIFT) — виден у каждого оплаченного ею счёта. */
  app.post("/payments/:id/files", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [payment] = await db.select({ id: payments.id, number: payments.number }).from(payments).where(eq(payments.id, id));
    if (!payment) throw new HttpError(404, "Оплата не найдена");
    const attachment = await saveUpload(request, "payment", id, `к оплате${payment.number ? ` № ${payment.number}` : ""}`, "payment");
    return { attachment };
  });

  /** Платёжка к галочке оплаты сделки — прикрепляется к оплаченному документу (последнему из её инвойсов / счетов / ДТ). */
  app.post("/shipments/:number/flags/:key/proof", async (request) => {
    const { number, key } = request.params as { number: string; key: string };
    if (!(PAYMENT_FLAGS as string[]).includes(key)) throw new HttpError(400, "Платёжка прикрепляется только к оплатам");
    const [sh] = await db.select().from(shipments).where(eq(shipments.number, parseShipmentNumber(number)));
    if (!sh) throw new HttpError(404, "Сделка не найдена");
    const docs = await flagDocuments(db, sh, key as PaymentFlag);
    const target = docs.map((d) => d.id).sort((a, b) => b - a)[0];
    if (!target) throw new HttpError(400, "В сделке нет документа, к которому прикрепить платёжку — сначала загрузите инвойс / счёт");
    const attachment = await saveUpload(request, "document", target, `к документу «${await documentLabel(db, target)}»`, "payment");
    return { attachment, documentId: target };
  });

  app.get("/files/:id", async (request, reply) => {
    const id = String((request.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Файл не найден");
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) throw new HttpError(404, "Файл не найден");
    const full = storagePath(row.storageKey);
    if (!fs.existsSync(full)) throw new HttpError(404, "Файл не найден на диске");

    const inline = INLINE_TYPES.has(row.mime);
    const download = (request.query as { download?: string }).download !== undefined;
    return reply
      .header("cache-control", "private, max-age=86400")
      .header("content-type", inline ? row.mime : "application/octet-stream")
      .header("content-length", row.size)
      .header("content-disposition", contentDisposition(inline && !download ? "inline" : "attachment", row.filename))
      .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
      .send(fs.createReadStream(full));
  });

  app.delete("/files/:id", async (request) => {
    const user = currentUser(request);
    const id = String((request.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Файл не найден");
    const [row] = await db.delete(attachments).where(eq(attachments.id, id)).returning();
    if (!row) throw new HttpError(404, "Файл не найден");
    await unlinkStoredFiles([row.storageKey]);
    await audit(db, {
      userId: user.id,
      action: "delete",
      entityType: "attachment",
      entityId: id,
      summary: `Удалил файл «${row.filename}»`,
      data: { ownerType: row.ownerType, ownerId: row.ownerId },
      ip: request.ip,
    });
    return { ok: true };
  });
}
