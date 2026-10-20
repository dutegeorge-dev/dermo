/**
 * После погрузки и на таможне: спецификация для перевозчика (Excel по шаблону) и пакет документов
 * для таможни (ZIP: инвойсы с оплатами, перевозка, упаковочные листы, спецификация, сертификаты…).
 */

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import JSZip from "jszip";

import { DEFAULT_SPEC_PARAMS, type SpecParams } from "../../shared/cargo.ts";
import { DOC_TYPES } from "../../shared/documents.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { attachments, counterparties, documentItems, documents, shipments } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { DEFAULT_MAPPING, defaultTemplate, mapTemplate, renderSpec, specData } from "../lib/carrier-spec.ts";
import { body, currentUser, HttpError } from "../lib/http.ts";
import { addShipmentEvent, parseShipmentNumber } from "../lib/shipments.ts";
import { readStored, storeBuffer } from "./files.ts";

async function shipmentByNumber(tx: DbOrTx, raw: string) {
  const [sh] = await tx.select().from(shipments).where(eq(shipments.number, parseShipmentNumber(raw)));
  if (!sh) throw new HttpError(404, "Сделка не найдена");
  return sh;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const disposition = (filename: string, ascii: string) => `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

function parseSpecParams(input: Record<string, unknown>, base: SpecParams): SpecParams {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const p = { ...base };
  if ("consignee" in input) p.consignee = str(input.consignee, 1000);
  if ("station" in input) p.station = str(input.station, 200);
  if ("country" in input) p.country = str(input.country, 100);
  if ("origin" in input) p.origin = str(input.origin, 100);
  if (input.descriptions && typeof input.descriptions === "object") {
    p.descriptions = Object.fromEntries(
      Object.entries(input.descriptions as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v.trim())
        .slice(0, 100)
        .map(([k, v]) => [k.slice(0, 200), String(v).slice(0, 500)]),
    );
  }
  return p;
}

// ── Пакет для таможни ──────────────────────────────────────────────────────

type PackFile = { folder: string; name: string; key: string };

/** Что войдёт в пакет и чего не хватает. */
async function customsPack(tx: DbOrTx, sh: typeof shipments.$inferSelect) {
  const ids = [sh.supplierContractId].filter((x): x is number => !!x);
  const docs = await tx
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      date: documents.date,
      counterpartyId: documents.counterpartyId,
      contractorType: counterparties.contractorType,
      paymentStatus: documents.paymentStatus,
    })
    .from(documents)
    .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
    .where(ids.length ? or(eq(documents.shipmentId, sh.id), inArray(documents.id, ids)) : eq(documents.shipmentId, sh.id))
    .orderBy(asc(documents.date), asc(documents.id));
  // Сертификаты: привязанные к сделке или выданные на её товары.
  const productIds = (
    await tx
      .select({ id: documentItems.productId })
      .from(documentItems)
      .innerJoin(documents, eq(documents.id, documentItems.documentId))
      .where(and(eq(documents.shipmentId, sh.id), eq(documents.type, "supplier_invoice")))
  )
    .map((r) => r.id)
    .filter((x): x is number => !!x);
  const certs = productIds.length
    ? await tx
        .selectDistinct({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, counterpartyId: documents.counterpartyId, contractorType: sql<string | null>`null`, paymentStatus: documents.paymentStatus })
        .from(documents)
        .innerJoin(documentItems, eq(documentItems.documentId, documents.id))
        .where(and(eq(documents.type, "conformity"), inArray(documentItems.productId, productIds)))
    : [];
  const all = [...docs, ...certs.filter((c) => !docs.some((d) => d.id === c.id))];
  const files = all.length
    ? await tx
        .select({ ownerId: attachments.ownerId, filename: attachments.filename, key: attachments.storageKey, label: attachments.label })
        .from(attachments)
        .where(and(eq(attachments.ownerType, "document"), inArray(attachments.ownerId, all.map((d) => d.id))))
        .orderBy(asc(attachments.createdAt))
    : [];

  const isCarrier = (d: (typeof all)[number]) => d.type === "contractor_invoice" && (d.counterpartyId === sh.carrierId || (d.contractorType ?? "").startsWith("carrier"));
  const folders: [string, (d: (typeof all)[number]) => boolean][] = [
    ["1 Контракт", (d) => d.type === "supplier_contract" || (d.type === "supplementary" && d.id === sh.supplierContractId)],
    ["2 Инвойсы поставщика", (d) => d.type === "supplier_invoice"],
    ["3 Упаковочные листы", (d) => d.type === "packing_list"],
    ["4 Спецификация", (d) => d.type === "carrier_spec"],
    ["5 Перевозка — счета", isCarrier],
    ["6 Транспортные документы", (d) => ["railway_bill", "cmr", "bill_of_lading", "air_waybill"].includes(d.type)],
    ["7 Сертификаты и декларации", (d) => d.type === "conformity"],
  ];
  const out: PackFile[] = [];
  const missing: string[] = [];
  const present: { folder: string; label: string; files: number; payments: number }[] = [];
  for (const [folder, test] of folders) {
    const list = all.filter(test);
    for (const d of list) {
      const label = `${DOC_TYPES[d.type as keyof typeof DOC_TYPES]?.label ?? d.type} ${d.number ? `№ ${d.number}` : "б/н"}`;
      const own = files.filter((f) => f.ownerId === d.id);
      const main = own.filter((f) => f.label !== "payment");
      const pays = own.filter((f) => f.label === "payment");
      for (const f of main) out.push({ folder, name: safeName(`${label} — ${f.filename}`), key: f.key });
      for (const f of pays) out.push({ folder, name: safeName(`${label} — оплата — ${f.filename}`), key: f.key });
      present.push({ folder, label, files: main.length, payments: pays.length });
      if (!main.length) missing.push(`${label}: нет файла`);
      if ((d.type === "supplier_invoice" || isCarrier(d)) && !pays.length) missing.push(`${label}: нет документа об оплате`);
    }
    if (!list.length) missing.push(folder === "6 Транспортные документы" ? "СМГС (ж/д накладная) или другая транспортная накладная: нет" : `${folder.slice(2)}: нет`);
  }
  return { files: out, present, missing };
}

export async function cargoRoutes(app: FastifyInstance): Promise<void> {
  // ── Спецификация для перевозчика ──
  app.get("/shipments/:number/spec", async (request) => {
    const sh = await shipmentByNumber(db, (request.params as { number: string }).number);
    const data = await specData(db, sh);
    const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.shipmentId, sh.id), eq(documents.type, "carrier_spec")));
    return { ...data, document: doc ?? null };
  });

  app.put("/shipments/:number/spec", async (request) => {
    const sh = await shipmentByNumber(db, (request.params as { number: string }).number);
    const spec = parseSpecParams(body<Record<string, unknown>>(request), { ...DEFAULT_SPEC_PARAMS, ...(sh.spec ?? {}) });
    await db.update(shipments).set({ spec, updatedAt: new Date() }).where(eq(shipments.id, sh.id));
    return { params: spec };
  });

  /**
   * Сформировать Excel. multipart с полем file — шаблон перевозчика (иначе наш). Файл сохраняется
   * документом «Спецификация для перевозчика» в сделке (прежняя версия заменяется) и отдаётся.
   */
  app.post("/shipments/:number/spec.xlsx", async (request, reply) => {
    const user = currentUser(request);
    const sh = await shipmentByNumber(db, (request.params as { number: string }).number);
    const upload = request.isMultipart() ? await request.file() : undefined;
    const custom = upload ? await upload.toBuffer() : null;
    const template = custom ?? (await defaultTemplate());
    const { mapping, usage } = custom ? await mapTemplate(db, custom) : { mapping: DEFAULT_MAPPING, usage: null };
    if (usage) request.log.info({ ai: "spec-template", usage }, "ИИ: разметка шаблона спецификации");
    const data = await specData(db, sh);
    if (!data.lines.length) throw new HttpError(400, "Нет товаров — загрузите инвойс поставщика");
    const buffer = await renderSpec(template, mapping, data);
    const filename = `Спецификация ${safeName(sh.title)}${sh.containerNo ? ` ${sh.containerNo}` : ""}.xlsx`;

    await db.transaction(async (tx) => {
      let [doc] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.shipmentId, sh.id), eq(documents.type, "carrier_spec")));
      if (!doc) {
        [doc] = await tx
          .insert(documents)
          .values({ type: "carrier_spec", number: data.fields.invoiceNo || null, date: new Date().toISOString().slice(0, 10), shipmentId: sh.id, clientId: sh.clientId, createdBy: user.id })
          .returning({ id: documents.id });
        await addShipmentEvent(tx, sh.id, user.id, "document_added", null, null, "Спецификация для перевозчика");
      }
      // Прежние сформированные версии — заменяем (файлы на диске остаются до бэкапа — их немного).
      await tx.delete(attachments).where(and(eq(attachments.ownerType, "document"), eq(attachments.ownerId, doc.id), eq(attachments.label, "generated")));
      await storeBuffer(tx, { type: "document", id: doc.id }, { filename, mime: XLSX, buffer, label: "generated" }, user.id);
      await audit(tx, { userId: user.id, action: "create", entityType: "document", entityId: doc.id, summary: `Сформировал спецификацию для перевозчика по сделке «${sh.title}»`, ip: request.ip });
    });
    return reply.header("content-type", XLSX).header("content-disposition", disposition(filename, `spec-${sh.number}.xlsx`)).send(buffer);
  });

  // ── Пакет документов для таможни ──
  app.get("/shipments/:number/customs-pack", async (request) => {
    const sh = await shipmentByNumber(db, (request.params as { number: string }).number);
    const { files, present, missing } = await customsPack(db, sh);
    return { files: files.length, present, missing };
  });

  app.get("/shipments/:number/customs-pack.zip", async (request, reply) => {
    const sh = await shipmentByNumber(db, (request.params as { number: string }).number);
    const { files, present, missing } = await customsPack(db, sh);
    if (!files.length) throw new HttpError(400, "В сделке ещё нет файлов документов");
    const zip = new JSZip();
    const used = new Set<string>();
    for (const f of files) {
      let name = `${f.folder}/${f.name}`;
      for (let i = 2; used.has(name); i++) name = `${f.folder}/${i} ${f.name}`;
      used.add(name);
      try {
        zip.file(name, await readStored(f.key));
      } catch {
        missing.push(`${f.name}: файл не найден на диске`);
      }
    }
    const lines = [
      `Документы для таможни — сделка № ${sh.number} «${sh.title}»${sh.containerNo ? `, контейнер ${sh.containerNo}` : ""}`,
      `Сформировано: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`,
      "",
      ...present.map((p) => `${p.folder.slice(2)}: ${p.label} — файлов ${p.files}${p.payments ? `, оплат ${p.payments}` : ""}`),
      ...(missing.length ? ["", "Не хватает:", ...missing.map((m) => `- ${m}`)] : []),
    ];
    zip.file("Опись.txt", `﻿${lines.join("\r\n")}`);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const filename = `Таможня ${safeName(sh.title)}${sh.containerNo ? ` ${sh.containerNo}` : ""}.zip`;
    return reply.header("content-type", "application/zip").header("content-disposition", disposition(filename, `customs-${sh.number}.zip`)).send(buffer);
  });
}
