/** CRM: этапы воронки, сделки, комментарии, журнал изменений. */

import crypto from "node:crypto";

import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { DEAL_FIELDS, type DealField } from "../../shared/deal-fields.ts";
import { db, type DbOrTx } from "../db/client.ts";
import {
  attachments,
  contacts,
  counterparties,
  dealComments,
  dealEvents,
  dealParties,
  deals,
  dealStatuses,
  users,
} from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import {
  addEvent,
  autoContracts,
  createDeal,
  dealQuery,
  dealSearchColumns,
  displayValue,
  endOfColumn,
  getStage,
  outcomeForStage,
  parseDealKey,
  parseFields,
  sameValue,
} from "../lib/deals.ts";
import { dealDocuments, dealFinance } from "../lib/finance.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";
import { deleteAttachmentRows, unlinkStoredFiles } from "./files.ts";

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

async function findDeal(tx: DbOrTx, rawKey: unknown) {
  const number = parseDealKey(rawKey);
  const [deal] = await tx.select().from(deals).where(eq(deals.number, number));
  if (!deal) throw new HttpError(404, "Сделка не найдена");
  return deal;
}

/** Новый клиент (и контакт) из формы создания сделки. */
async function createClientInline(
  tx: DbOrTx,
  userId: number,
  input: { name?: unknown; kind?: unknown; inn?: unknown },
): Promise<number | null> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 300) : "";
  if (!name) return null;
  const kind = input.kind === "ip" || input.kind === "other" ? input.kind : "ooo";
  const inn = typeof input.inn === "string" ? input.inn.replace(/\D/g, "").slice(0, 12) || null : null;
  const [row] = await tx
    .insert(counterparties)
    .values({ role: "client", name, kind, inn, createdBy: userId })
    .returning({ id: counterparties.id });
  return row.id;
}

async function createContactInline(
  tx: DbOrTx,
  clientId: number | null,
  input: Record<string, unknown>,
): Promise<number | null> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  const phone = typeof input.phone === "string" ? input.phone.trim().slice(0, 50) : "";
  if (!name && !phone) return null;
  const messengers = ["telegram", "whatsapp", "max", "wechat", "other"] as const;
  const messenger = messengers.find((m) => m === input.messenger) ?? null;
  const [row] = await tx
    .insert(contacts)
    .values({
      counterpartyId: clientId,
      name: name || phone,
      phone: phone || null,
      messenger,
      messengerHandle: typeof input.messengerHandle === "string" ? input.messengerHandle.trim().slice(0, 100) || null : null,
      email: typeof input.email === "string" ? input.email.trim().slice(0, 200) || null : null,
      isPrimary: true,
    })
    .returning({ id: contacts.id });
  return row.id;
}

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  // ── Этапы воронки ────────────────────────────────────────────────────────

  app.get("/stages", async () => {
    const rows = await db
      .select({
        key: dealStatuses.key,
        name: dealStatuses.name,
        color: dealStatuses.color,
        position: dealStatuses.position,
        isFinal: dealStatuses.isFinal,
        dealCount: count(deals.id),
      })
      .from(dealStatuses)
      .leftJoin(deals, and(eq(deals.statusKey, dealStatuses.key), isNull(deals.outcome)))
      .groupBy(dealStatuses.key)
      .orderBy(asc(dealStatuses.position));
    return { stages: rows };
  });

  /** Полный список этапов в новом порядке (только admin). Последний — завершающий. */
  app.put("/stages", async (request) => {
    const admin = requireAdmin(request);
    const input = body<{ stages: { key?: string; name: string; color: string }[] }>(request);
    const list = Array.isArray(input.stages) ? input.stages : [];
    if (list.length < 2) throw new HttpError(400, "Нужно хотя бы два этапа");
    if (list.length > 30) throw new HttpError(400, "Слишком много этапов");
    const cleaned = list.map((s) => {
      const name = typeof s?.name === "string" ? s.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
      if (!name) throw new HttpError(400, "У каждого этапа должно быть название");
      const color = typeof s?.color === "string" && COLOR_RE.test(s.color) ? s.color.toUpperCase() : "#94A3B8";
      const key = typeof s?.key === "string" && s.key ? s.key : `st_${crypto.randomBytes(4).toString("hex")}`;
      return { key, name, color };
    });

    await db.transaction(async (tx) => {
      const existing = await tx.select().from(dealStatuses);
      const keep = new Set(cleaned.map((s) => s.key));
      const removed = existing.filter((s) => !keep.has(s.key));
      for (const stage of removed) {
        const [{ n }] = await tx.select({ n: count() }).from(deals).where(eq(deals.statusKey, stage.key));
        if (n > 0) {
          throw new HttpError(409, `На этапе «${stage.name}» есть сделки (${n}). Перенесите их на другой этап и удалите этап снова.`);
        }
      }
      if (removed.length) await tx.delete(dealStatuses).where(inArray(dealStatuses.key, removed.map((s) => s.key)));

      const existingKeys = new Set(existing.map((s) => s.key));
      for (const [i, stage] of cleaned.entries()) {
        const values = { name: stage.name, color: stage.color, position: (i + 1) * 10, isFinal: i === cleaned.length - 1 };
        if (existingKeys.has(stage.key)) await tx.update(dealStatuses).set(values).where(eq(dealStatuses.key, stage.key));
        else await tx.insert(dealStatuses).values({ key: stage.key, ...values });
      }

      // Итоги сделок под новый завершающий этап.
      const finalKey = cleaned[cleaned.length - 1].key;
      await tx
        .update(deals)
        .set({ outcome: null, closedAt: null })
        .where(and(eq(deals.outcome, "won"), ne(deals.statusKey, finalKey)));
      await tx
        .update(deals)
        .set({ outcome: "won", closedAt: new Date() })
        .where(and(isNull(deals.outcome), eq(deals.statusKey, finalKey)));

      await audit(tx, {
        userId: admin.id,
        action: "update",
        entityType: "deal_stages",
        summary: `Изменил этапы воронки: ${cleaned.map((s) => s.name).join(" → ")}`,
        ip: request.ip,
      });
    });
    return { ok: true };
  });

  // ── Сделки ───────────────────────────────────────────────────────────────

  /**
   * Список сделок. view=board — доска: всё в работе + успешные за 30 дней.
   * Иначе фильтры: outcome=open|won|lost|all, stage, assignee (id|me|none), client, label, q.
   */
  app.get("/deals", async (request) => {
    const user = currentUser(request);
    const q = request.query as Record<string, string | undefined>;
    const filters: SQL[] = [];

    if (q.view === "board") {
      filters.push(
        or(isNull(deals.outcome), and(eq(deals.outcome, "won"), gt(deals.closedAt, sql`now() - interval '30 days'`)))!,
      );
    } else if (q.outcome === "open") filters.push(isNull(deals.outcome));
    else if (q.outcome === "won" || q.outcome === "lost") filters.push(eq(deals.outcome, q.outcome));

    if (q.stage) filters.push(eq(deals.statusKey, q.stage));
    if (q.assignee === "me") filters.push(eq(deals.assigneeId, user.id));
    else if (q.assignee === "none") filters.push(isNull(deals.assigneeId));
    else if (q.assignee && Number(q.assignee) > 0) filters.push(eq(deals.assigneeId, Number(q.assignee)));
    if (q.client && Number(q.client) > 0) filters.push(eq(deals.clientId, Number(q.client)));
    if (q.supplier && Number(q.supplier) > 0) filters.push(eq(deals.supplierId, Number(q.supplier)));
    if (q.label) filters.push(sql`${q.label} = ANY(${deals.labels})`);
    if (q.q?.trim()) {
      const text = q.q.trim().slice(0, 100);
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const num = /^(?:bars-)?(\d+)$/i.exec(text);
      filters.push(
        or(
          ilike(deals.title, like),
          ilike(deals.product, like),
          ilike(deals.hsCode, like),
          ilike(dealSearchColumns.client.name, like),
          ilike(dealSearchColumns.client.inn, like),
          ilike(dealSearchColumns.supplier.name, like),
          ilike(contacts.name, like),
          ilike(contacts.phone, like),
          ...(num ? [eq(deals.number, Number(num[1]))] : []),
        )!,
      );
    }

    const sortable = {
      key: deals.number,
      title: deals.title,
      dueDate: deals.dueDate,
      updatedAt: deals.updatedAt,
      createdAt: deals.createdAt,
      priority: deals.priority,
    } as const;
    const sortCol = sortable[(q.sort as keyof typeof sortable) ?? "updatedAt"] ?? deals.updatedAt;
    const order = q.view === "board" ? [asc(deals.boardPosition), asc(deals.id)] : [q.dir === "asc" ? asc(sortCol) : desc(sortCol), desc(deals.id)];

    const rows = await dealQuery(db)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(...order)
      .limit(1000);
    return { deals: rows };
  });

  app.post("/deals", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);

    const deal = await db.transaction(async (tx) => {
      const fields = await parseFields(tx, input);
      if (!fields.title) throw new HttpError(400, "Укажите название сделки");

      let clientId = (fields.clientId as number | null | undefined) ?? null;
      if (!clientId && input.newClient && typeof input.newClient === "object") {
        clientId = await createClientInline(tx, user.id, input.newClient as Record<string, unknown>);
      }
      let contactId = (fields.contactId as number | null | undefined) ?? null;
      if (!contactId && input.newContact && typeof input.newContact === "object") {
        contactId = await createContactInline(tx, clientId, input.newContact as Record<string, unknown>);
      }
      return createDeal(
        tx,
        user.id,
        { ...fields, title: fields.title, clientId, contactId },
        { statusKey: typeof input.statusKey === "string" ? input.statusKey : undefined, ip: request.ip },
      );
    });
    return { deal };
  });

  app.get("/deals/:key", async (request) => {
    const number = parseDealKey((request.params as { key: string }).key);
    const [deal] = await dealQuery(db).where(eq(deals.number, number));
    if (!deal) throw new HttpError(404, "Сделка не найдена");

    const [comments, events, files] = await Promise.all([
      db
        .select({
          id: dealComments.id,
          body: dealComments.body,
          authorId: dealComments.authorId,
          authorName: users.name,
          createdAt: dealComments.createdAt,
        })
        .from(dealComments)
        .leftJoin(users, eq(users.id, dealComments.authorId))
        .where(eq(dealComments.dealId, deal.id))
        .orderBy(asc(dealComments.createdAt)),
      db
        .select({
          id: dealEvents.id,
          kind: dealEvents.kind,
          field: dealEvents.field,
          oldValue: dealEvents.oldValue,
          newValue: dealEvents.newValue,
          userName: users.name,
          createdAt: dealEvents.createdAt,
        })
        .from(dealEvents)
        .leftJoin(users, eq(users.id, dealEvents.userId))
        .where(eq(dealEvents.dealId, deal.id))
        .orderBy(desc(dealEvents.id))
        .limit(300),
      db
        .select({
          id: attachments.id,
          filename: attachments.filename,
          mime: attachments.mime,
          size: attachments.size,
          createdAt: attachments.createdAt,
          createdByName: users.name,
        })
        .from(attachments)
        .leftJoin(users, eq(users.id, attachments.createdBy))
        .where(and(eq(attachments.ownerType, "deal"), eq(attachments.ownerId, deal.id)))
        .orderBy(asc(attachments.createdAt)),
    ]);
    const parties = await db
      .select({
        id: counterparties.id,
        name: counterparties.name,
        role: counterparties.role,
        contractorType: counterparties.contractorType,
      })
      .from(dealParties)
      .innerJoin(counterparties, eq(counterparties.id, dealParties.counterpartyId))
      .where(eq(dealParties.dealId, deal.id))
      .orderBy(asc(counterparties.name));
    const docs = await dealDocuments(db, deal.id);
    return { deal, comments, events, attachments: files, parties, documents: docs, finance: await dealFinance(db, deal.id, docs) };
  });

  /** Правка полей. Каждое изменённое поле — запись в журнале сделки. */
  app.patch("/deals/:key", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const fields = await parseFields(tx, input);
      const changed: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(fields) as [DealField, unknown][]) {
        const before = (deal as Record<string, unknown>)[field];
        if (sameValue(field, before, value)) continue;
        changed[field] = value;
        await addEvent(
          tx,
          deal.id,
          user.id,
          "field_changed",
          field,
          await displayValue(tx, field, before),
          await displayValue(tx, field, value),
        );
      }
      if (Object.keys(changed).length === 0) return { ok: true, changed: [] };
      // Сменили клиента, схему или поставщика — договоры подбираем заново (если их не выбрали явно).
      if (("clientId" in changed || "scheme" in changed) && !("clientContractId" in changed)) changed.clientContractId = null;
      if (("supplierId" in changed || "scheme" in changed) && !("supplierContractId" in changed)) changed.supplierContractId = null;
      await tx.update(deals).set({ ...changed, updatedAt: new Date() }).where(eq(deals.id, deal.id));
      const picked = await autoContracts(tx, deal.id);
      for (const [field, value] of Object.entries(picked) as [DealField, unknown][]) {
        await addEvent(tx, deal.id, user.id, "field_changed", field, null, await displayValue(tx, field, value));
      }
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "deal",
        entityId: deal.key,
        summary: `Изменил сделку ${deal.key}: ${Object.keys(changed)
          .map((f) => DEAL_FIELDS[f as DealField].label)
          .join(", ")}`,
        ip: request.ip,
      });
      return { ok: true, changed: Object.keys(changed) };
    });
  });

  /** Перенос на доске: этап и место в колонке (перед сделкой beforeKey или в конец). */
  app.post("/deals/:key/move", async (request) => {
    const user = currentUser(request);
    const input = body<{ statusKey: string; beforeKey: string | null }>(request);
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const stage = await getStage(tx, String(input.statusKey ?? deal.statusKey));

      let position: number;
      if (input.beforeKey) {
        const before = await findDeal(tx, input.beforeKey);
        const [prev] = await tx
          .select({ pos: deals.boardPosition })
          .from(deals)
          .where(and(eq(deals.statusKey, stage.key), sql`${deals.boardPosition} < ${before.boardPosition}`, ne(deals.id, deal.id)))
          .orderBy(desc(deals.boardPosition))
          .limit(1);
        position = prev ? (prev.pos + before.boardPosition) / 2 : before.boardPosition - 1024;
      } else {
        position = await endOfColumn(tx, stage.key);
      }

      const stageChanged = stage.key !== deal.statusKey;
      await tx
        .update(deals)
        .set({
          statusKey: stage.key,
          boardPosition: position,
          ...(stageChanged ? { ...outcomeForStage(stage.isFinal, deal.outcome), updatedAt: new Date() } : {}),
        })
        .where(eq(deals.id, deal.id));

      if (stageChanged) {
        const from = await getStage(tx, deal.statusKey);
        await addEvent(tx, deal.id, user.id, "status_changed", "statusKey", from.name, stage.name);
        await audit(tx, {
          userId: user.id,
          action: "update",
          entityType: "deal",
          entityId: deal.key,
          summary: `Перевёл сделку ${deal.key} на этап «${stage.name}»`,
          ip: request.ip,
        });
      }
      return { ok: true };
    });
  });

  /** Отказ: сделка закрывается неуспешно на текущем этапе и уходит с доски. */
  app.post("/deals/:key/lose", async (request) => {
    const user = currentUser(request);
    const reason = String(body<{ reason: string }>(request).reason ?? "").trim().slice(0, 1000);
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      await tx
        .update(deals)
        .set({ outcome: "lost", lostReason: reason || null, closedAt: new Date(), updatedAt: new Date() })
        .where(eq(deals.id, deal.id));
      await addEvent(tx, deal.id, user.id, "lost", null, null, reason || null);
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "deal",
        entityId: deal.key,
        summary: `Закрыл сделку ${deal.key} как отказ${reason ? `: ${reason}` : ""}`,
        ip: request.ip,
      });
      return { ok: true };
    });
  });

  /** Вернуть в работу после отказа. */
  app.post("/deals/:key/reopen", async (request) => {
    const user = currentUser(request);
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const stage = await getStage(tx, deal.statusKey);
      await tx
        .update(deals)
        .set({ ...outcomeForStage(stage.isFinal, null), lostReason: null, updatedAt: new Date() })
        .where(eq(deals.id, deal.id));
      await addEvent(tx, deal.id, user.id, "reopened");
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "deal",
        entityId: deal.key,
        summary: `Вернул сделку ${deal.key} в работу`,
        ip: request.ip,
      });
      return { ok: true };
    });
  });

  app.delete("/deals/:key", async (request) => {
    const admin = requireAdmin(request);
    const stored = await db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const keys = await deleteAttachmentRows(tx, "deal", [deal.id]);
      await tx.delete(deals).where(eq(deals.id, deal.id));
      await audit(tx, {
        userId: admin.id,
        action: "delete",
        entityType: "deal",
        entityId: deal.key,
        summary: `Удалил сделку ${deal.key} «${deal.title}»`,
        data: deal,
        ip: request.ip,
      });
      return keys;
    });
    await unlinkStoredFiles(stored);
    return { ok: true };
  });

  // ── Подрядчики сделки ────────────────────────────────────────────────────

  app.post("/deals/:key/parties", async (request) => {
    const user = currentUser(request);
    const counterpartyId = intParam(body<{ counterpartyId: number }>(request).counterpartyId, "counterpartyId");
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const [cp] = await tx.select().from(counterparties).where(eq(counterparties.id, counterpartyId));
      if (!cp) throw new HttpError(404, "Контрагент не найден");
      await tx.insert(dealParties).values({ dealId: deal.id, counterpartyId }).onConflictDoNothing();
      await addEvent(tx, deal.id, user.id, "party_added", null, null, cp.name);
      return { ok: true };
    });
  });

  app.delete("/deals/:key/parties/:id", async (request) => {
    const user = currentUser(request);
    const counterpartyId = intParam((request.params as { id: string }).id);
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const [removed] = await tx
        .delete(dealParties)
        .where(and(eq(dealParties.dealId, deal.id), eq(dealParties.counterpartyId, counterpartyId)))
        .returning();
      if (removed) {
        const [cp] = await tx.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, counterpartyId));
        await addEvent(tx, deal.id, user.id, "party_removed", null, cp?.name ?? null, null);
      }
      return { ok: true };
    });
  });

  // ── Комментарии ──────────────────────────────────────────────────────────

  app.post("/deals/:key/comments", async (request) => {
    const user = currentUser(request);
    const text = String(body<{ body: string }>(request).body ?? "").trim().slice(0, 10_000);
    if (!text) throw new HttpError(400, "Пустой комментарий");
    return db.transaction(async (tx) => {
      const deal = await findDeal(tx, (request.params as { key: string }).key);
      const [comment] = await tx.insert(dealComments).values({ dealId: deal.id, authorId: user.id, body: text }).returning();
      await tx.update(deals).set({ updatedAt: new Date() }).where(eq(deals.id, deal.id));
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "deal_comment",
        entityId: comment.id,
        summary: `Прокомментировал сделку ${deal.key}`,
        ip: request.ip,
      });
      return { comment };
    });
  });

  app.delete("/deals/:key/comments/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [comment] = await db.select().from(dealComments).where(eq(dealComments.id, id));
    if (!comment) throw new HttpError(404, "Комментарий не найден");
    if (comment.authorId !== user.id && user.role !== "admin") throw new HttpError(403, "Удалить можно только свой комментарий");
    await db.delete(dealComments).where(eq(dealComments.id, id));
    await audit(db, {
      userId: user.id,
      action: "delete",
      entityType: "deal_comment",
      entityId: id,
      summary: "Удалил комментарий к сделке",
      data: { body: comment.body, dealId: comment.dealId },
      ip: request.ip,
    });
    return { ok: true };
  });
}
