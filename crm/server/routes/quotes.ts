/** Ставки доставки (справочник) и расчёты цены товара для клиента с КП. */

import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { freightRates, productQuotes, products, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";
import { freightDto, freightValues, quoteKpData, quoteParams, renderQuoteKp, serverQuote } from "../lib/quotes.ts";
import { cbrRates } from "../lib/rates.ts";

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  // ── Ставки доставки ──────────────────────────────────────────────────────

  app.get("/freight-rates", async () => {
    const rows = await db.select().from(freightRates).orderBy(desc(freightRates.quotedAt), desc(freightRates.id)).limit(500);
    return { rates: rows.map(freightDto) };
  });

  app.post("/freight-rates", async (request) => {
    const user = currentUser(request);
    const [row] = await db.insert(freightRates).values({ ...freightValues(body<Record<string, unknown>>(request)), createdBy: user.id }).returning();
    await audit(db, { userId: user.id, action: "create", entityType: "freight_rate", entityId: row.id, summary: `Добавил ставку доставки ${row.origin} — ${row.destination}`, ip: request.ip });
    return { rate: freightDto(row) };
  });

  app.patch("/freight-rates/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db.update(freightRates).set({ ...freightValues(body<Record<string, unknown>>(request)), updatedAt: new Date() }).where(eq(freightRates.id, id)).returning();
    if (!row) throw new HttpError(404, "Ставка не найдена");
    await audit(db, { userId: user.id, action: "update", entityType: "freight_rate", entityId: id, summary: `Изменил ставку доставки ${row.origin} — ${row.destination}`, ip: request.ip });
    return { rate: freightDto(row) };
  });

  app.delete("/freight-rates/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db.delete(freightRates).where(eq(freightRates.id, id)).returning();
    if (!row) throw new HttpError(404, "Ставка не найдена");
    await audit(db, { userId: user.id, action: "delete", entityType: "freight_rate", entityId: id, summary: `Удалил ставку доставки ${row.origin} — ${row.destination}`, data: row, ip: request.ip });
    return { ok: true };
  });

  /** Курсы ЦБ на сегодня — для расчёта прямо в браузере. */
  app.get("/cbr-rates", async () =>
    cbrRates().catch((e: Error) => {
      throw new HttpError(502, e.message);
    }),
  );

  // ── Расчёты цены товара ──────────────────────────────────────────────────

  app.get("/products/:id/quotes", async (request) => {
    const productId = intParam((request.params as { id: string }).id);
    const rows = await db
      .select({
        id: productQuotes.id,
        clientName: productQuotes.clientName,
        params: productQuotes.params,
        result: productQuotes.result,
        freight: productQuotes.freight,
        ratesDate: productQuotes.ratesDate,
        createdAt: productQuotes.createdAt,
        createdBy: productQuotes.createdBy,
        createdByName: users.name,
      })
      .from(productQuotes)
      .leftJoin(users, eq(users.id, productQuotes.createdBy))
      .where(eq(productQuotes.productId, productId))
      .orderBy(desc(productQuotes.createdAt))
      .limit(50);
    return { quotes: rows };
  });

  /** Сохранить расчёт: пересчитываем на сервере по тем же курсам, что видел пользователь (или по свежим ЦБ). */
  app.post("/products/:id/quotes", async (request) => {
    const user = currentUser(request);
    const productId = intParam((request.params as { id: string }).id);
    const input = body<{ params: unknown; rates: unknown; ratesDate: unknown }>(request);
    const params = quoteParams(input.params);
    if (!params.quantity) throw new HttpError(400, "Укажите объём партии");
    const given = input.rates && typeof input.rates === "object" ? (input.rates as Record<string, unknown>) : null;
    const fresh = given && typeof input.ratesDate === "string" ? null : await cbrRates().catch((e: Error) => {
      throw new HttpError(502, e.message);
    });
    const rates = fresh?.rates ?? Object.fromEntries(Object.entries(given!).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>;
    const ratesDate = fresh?.date ?? String(input.ratesDate).slice(0, 10);
    const { product, freight, result } = await serverQuote(db, productId, params, { RUB: 1, ...rates });
    const [quote] = await db
      .insert(productQuotes)
      .values({ productId, offerId: params.offerId, clientName: params.clientName, params, result, freight, ratesDate, rates: { RUB: 1, ...rates }, createdBy: user.id })
      .returning({ id: productQuotes.id });
    await audit(db, {
      userId: user.id,
      action: "create",
      entityType: "product_quote",
      entityId: quote.id,
      summary: `Расчёт «${product.name}»: ${params.quantity} ${params.unit} — ${Math.round(result.totalRub).toLocaleString("ru-RU")} ₽${params.clientName ? ` для ${params.clientName}` : ""}`,
      ip: request.ip,
    });
    return { id: quote.id, result };
  });

  app.get("/quotes/:id/kp.docx", async (request, reply) => {
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db
      .select({ q: productQuotes, name: products.name, nameRu: products.nameRu })
      .from(productQuotes)
      .innerJoin(products, eq(products.id, productQuotes.productId))
      .where(eq(productQuotes.id, id));
    if (!row) throw new HttpError(404, "Расчёт не найден");
    const productName = row.nameRu || row.name;
    const data = quoteKpData(productName, row.q.params, row.q.result, row.q.freight ?? null, row.q.ratesDate ?? row.q.createdAt.toISOString().slice(0, 10), row.q.rates);
    const buffer = await renderQuoteKp(data, config.uploadDir);
    const filename = `КП ${productName}${row.q.clientName ? ` — ${row.q.clientName}` : ""}.docx`.replace(/[\\/:*?"<>|]/g, " ");
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", `attachment; filename="kp-product-${id}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(buffer);
  });

  app.delete("/quotes/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db
      .delete(productQuotes)
      .where(and(eq(productQuotes.id, id), user.role === "admin" ? undefined : eq(productQuotes.createdBy, user.id)))
      .returning({ id: productQuotes.id });
    if (!row) throw new HttpError(404, "Расчёт не найден (удалить может автор или админ)");
    return { ok: true };
  });
}
