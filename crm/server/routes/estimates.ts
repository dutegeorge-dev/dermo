/** Раздел «Расчёт»: расчёты по заявкам клиентов на их товары и КП. */

import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { estimates, users } from "../db/schema.ts";
import { aiEnabled } from "../lib/ai.ts";
import { fileContent } from "../lib/ai-parse.ts";
import { audit } from "../lib/audit.ts";
import { estimateKpData, estimateParams, parseEstimateRequest, serverEstimate, suggestEstimateHs } from "../lib/estimates.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";
import { renderQuoteKp } from "../lib/quotes.ts";
import { cbrRates } from "../lib/rates.ts";

/** Курсы: переданные (как видел пользователь) или свежие ЦБ. */
async function ratesOf(input: { rates?: unknown; ratesDate?: unknown }) {
  const given = input.rates && typeof input.rates === "object" ? (input.rates as Record<string, unknown>) : null;
  if (given && typeof input.ratesDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(input.ratesDate)) {
    const rates = Object.fromEntries(Object.entries(given).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>;
    return { rates: { ...rates, RUB: 1 }, ratesDate: input.ratesDate.slice(0, 10) };
  }
  const fresh = await cbrRates().catch((e: Error) => {
    throw new HttpError(502, e.message);
  });
  return { rates: { ...fresh.rates, RUB: 1 }, ratesDate: fresh.date };
}

const title = (p: { title: string; items: { name: string }[] }) => p.title || p.items.map((i) => i.name).filter(Boolean).join(", ").slice(0, 300) || "Без названия";

export async function estimateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/estimates", async () => {
    const rows = await db
      .select({
        id: estimates.id,
        title: estimates.title,
        clientName: estimates.clientName,
        scheme: estimates.scheme,
        result: estimates.result,
        currency: estimates.params,
        createdAt: estimates.createdAt,
        updatedAt: estimates.updatedAt,
        createdBy: estimates.createdBy,
        createdByName: users.name,
      })
      .from(estimates)
      .leftJoin(users, eq(users.id, estimates.createdBy))
      .orderBy(desc(estimates.updatedAt))
      .limit(500);
    return {
      estimates: rows.map(({ result, currency, ...r }) => ({ ...r, totalRub: result.totalRub, goods: result.goods, goodsCurrency: currency.currency })),
    };
  });

  app.get("/estimates/:id", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db.select().from(estimates).where(eq(estimates.id, id));
    if (!row) throw new HttpError(404, "Расчёт не найден");
    // Наличные сверху расчёта — только администраторам.
    if (currentUser(request).role !== "admin") return { estimate: { ...row, params: { ...row.params, markup: null } } };
    return { estimate: row };
  });

  /** Текст заявки → поля расчёта (ИИ). */
  app.post("/estimates/parse", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    // Текст заявки (JSON { text }) или файл инвойса (multipart: file, text).
    let text = "";
    const files: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (request.isMultipart()) {
      for await (const part of request.parts({ limits: { files: 1 } })) {
        if (part.type === "file") files.push(...(await fileContent(await part.toBuffer(), part.filename || "file", part.mimetype || "application/octet-stream")));
        else if (part.fieldname === "text") text = String(part.value ?? "");
      }
    } else text = String(body<{ text?: string }>(request).text ?? "");
    const { params, usage } = await parseEstimateRequest(db, text, files);
    request.log.info({ ai: "estimate-request", model: config.ai.model, usage }, "ИИ: заявка на расчёт");
    return { params };
  });

  /** Подобрать код ТН ВЭД по названию товара (ИИ + справочник). */
  app.post("/estimates/hs", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    const { hsCode, usage } = await suggestEstimateHs(db, String(body<{ name?: string }>(request).name ?? ""));
    request.log.info({ ai: "estimate-hs", model: config.ai.model, usage }, "ИИ: код ТН ВЭД");
    if (!hsCode) throw new HttpError(422, "Не удалось подобрать код — впишите вручную");
    return { hsCode };
  });

  app.post("/estimates", async (request) => {
    const user = currentUser(request);
    const input = body<{ params: unknown; request?: unknown; rates?: unknown; ratesDate?: unknown }>(request);
    const params = estimateParams(input.params);
    if (user.role !== "admin") params.markup = null;
    const { rates, ratesDate } = await ratesOf(input);
    const { freight, result } = await serverEstimate(db, params, rates);
    const [row] = await db
      .insert(estimates)
      .values({ title: title(params), clientName: params.clientName, scheme: params.scheme, request: typeof input.request === "string" ? input.request.slice(0, 20000) : "", params, result, freight, rates, ratesDate, createdBy: user.id })
      .returning({ id: estimates.id });
    await audit(db, { userId: user.id, action: "create", entityType: "estimate", entityId: row.id, summary: `Расчёт «${title(params)}» — ${Math.round(result.totalRub).toLocaleString("ru-RU")} ₽`, ip: request.ip });
    return { id: row.id, result };
  });

  app.put("/estimates/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ params: unknown; request?: unknown; rates?: unknown; ratesDate?: unknown }>(request);
    const params = estimateParams(input.params);
    // Не админ наличные не видит и не меняет — оставляем как было.
    if (user.role !== "admin") {
      const [prev] = await db.select({ params: estimates.params }).from(estimates).where(eq(estimates.id, id));
      params.markup = prev?.params.markup ?? null;
    }
    const { rates, ratesDate } = await ratesOf(input);
    const { freight, result } = await serverEstimate(db, params, rates);
    const [row] = await db
      .update(estimates)
      .set({
        title: title(params),
        clientName: params.clientName,
        scheme: params.scheme,
        ...(typeof input.request === "string" ? { request: input.request.slice(0, 20000) } : {}),
        params,
        result,
        freight,
        rates,
        ratesDate,
        updatedAt: new Date(),
      })
      .where(eq(estimates.id, id))
      .returning({ id: estimates.id });
    if (!row) throw new HttpError(404, "Расчёт не найден");
    await audit(db, { userId: user.id, action: "update", entityType: "estimate", entityId: id, summary: `Изменил расчёт «${title(params)}» — ${Math.round(result.totalRub).toLocaleString("ru-RU")} ₽`, ip: request.ip });
    return { id, result };
  });

  app.delete("/estimates/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db
      .delete(estimates)
      .where(and(eq(estimates.id, id), user.role === "admin" ? undefined : eq(estimates.createdBy, user.id)))
      .returning({ id: estimates.id, title: estimates.title });
    if (!row) throw new HttpError(404, "Расчёт не найден (удалить может автор или админ)");
    await audit(db, { userId: user.id, action: "delete", entityType: "estimate", entityId: id, summary: `Удалил расчёт «${row.title}»`, ip: request.ip });
    return { ok: true };
  });

  app.get("/estimates/:id/kp.docx", async (request, reply) => {
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db.select().from(estimates).where(eq(estimates.id, id));
    if (!row) throw new HttpError(404, "Расчёт не найден");
    const data = estimateKpData(row.params, row.result, row.freight ?? null, row.ratesDate ?? row.createdAt.toISOString().slice(0, 10), row.rates);
    const buffer = await renderQuoteKp(data, config.uploadDir);
    const filename = `КП ${row.title}${row.clientName ? ` — ${row.clientName}` : ""}.docx`.replace(/[\\/:*?"<>|]/g, " ");
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", `attachment; filename="kp-estimate-${id}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(buffer);
  });
}
