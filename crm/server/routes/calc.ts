/** Расчёт сделки для клиента: смета + таможенные платежи, КП (DOCX). Поручение — routes/orders.ts. */

import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { documents, shipments } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { calcItems, computeCalc, defaultParams, parseParams, renderKpDocx } from "../lib/calc.ts";
import { body, currentUser, HttpError } from "../lib/http.ts";
import { addShipmentEvent, parseShipmentNumber } from "../lib/shipments.ts";
import { searchTnved, tnvedByCodes, tnvedCount } from "../lib/tnved.ts";

async function shipmentByNumber(raw: string) {
  const [sh] = await db.select().from(shipments).where(eq(shipments.number, parseShipmentNumber(raw)));
  if (!sh) throw new HttpError(404, "Сделка не найдена");
  return sh;
}

const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;

export async function calcRoutes(app: FastifyInstance): Promise<void> {
  /** Справочник ТН ВЭД: поиск по началу кода или по словам. */
  app.get("/tnved", async (request) => {
    const q = String((request.query as { q?: string }).q ?? "");
    return { codes: await searchTnved(db, q), total: await tnvedCount(db) };
  });

  /** Сохранённый расчёт, параметры по умолчанию и товары (с кодами ТН ВЭД и ставками) для правки. */
  app.get("/shipments/:number/calc", async (request) => {
    const sh = await shipmentByNumber((request.params as { number: string }).number);
    const { items } = await calcItems(db, sh.id);
    const names = await tnvedByCodes(db, items.map((i) => i.hsCode ?? ""));
    // Таможенные платежи, записанные в поручение (для сравнения с пересчётом).
    const [order] = await db
      .select({ number: documents.number, data: documents.data })
      .from(documents)
      .where(and(eq(documents.shipmentId, sh.id), eq(documents.type, "commission_order")));
    const orderCustoms = ((order?.data as { costs?: { category: string; amount: number | null }[] } | undefined)?.costs ?? []).find((c) => c.category === "customs")?.amount ?? null;
    return {
      calc: sh.calc,
      defaults: sh.calc ? null : defaultParams(sh),
      items: items.map((i) => ({ productId: i.productId, name: i.name, hsCode: i.hsCode, tariff: i.tariff, tnvedName: i.hsCode ? (names.get(i.hsCode)?.name ?? null) : null, vat10: i.vat10 })),
      order: order ? { number: order.number, customs: orderCustoms } : null,
    };
  });

  /** Рассчитать и сохранить. refreshRates: true — по свежему курсу ЦБ (иначе — по курсу прошлого расчёта). */
  app.post("/shipments/:number/calc", async (request) => {
    const user = currentUser(request);
    const sh = await shipmentByNumber((request.params as { number: string }).number);
    const input = body<Record<string, unknown>>(request);
    if (!sh.weightKg || !sh.volumeM3) throw new HttpError(400, "Укажите в сделке вес и объём груза — без них не посчитать пошлину и КП");
    const params = parseParams(input, sh.calc ?? defaultParams(sh));
    const calc = await computeCalc(db, sh, params, Boolean(input.refreshRates) || !sh.calc);
    return db.transaction(async (tx) => {
      await tx.update(shipments).set({ calc, updatedAt: new Date() }).where(eq(shipments.id, sh.id));
      const before = sh.calc ? sh.calc.customs.duty + sh.calc.customs.vat : null;
      const after = calc.customs.duty + calc.customs.vat;
      if (before === null || Math.round(before) !== Math.round(after)) {
        await addShipmentEvent(tx, sh.id, user.id, "calc", "customs", before === null ? null : rub(before), `${rub(after)} (курс ЦБ на ${calc.ratesDate.split("-").reverse().join(".")})`);
      }
      await audit(tx, { userId: user.id, action: "update", entityType: "shipment", entityId: sh.number, summary: `Расчёт по сделке «${sh.title}»: таможенные платежи ${rub(after)}`, ip: request.ip });
      return { calc };
    });
  });

  app.get("/shipments/:number/kp.docx", async (request, reply) => {
    const sh = await shipmentByNumber((request.params as { number: string }).number);
    if (!sh.calc) throw new HttpError(400, "Сначала сделайте расчёт");
    const buffer = await renderKpDocx(sh, sh.calc, config.uploadDir);
    const filename = `КП ${sh.title}.docx`.replace(/[\\/:*?"<>|]/g, " ");
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", `attachment; filename="kp-${sh.number}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(buffer);
  });
}
