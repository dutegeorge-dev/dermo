/** База знаний: пространства, дерево страниц, версии. */

import { and, asc, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";

import { db, type DbOrTx } from "../db/client.ts";
import { attachments, kbPages, kbPageVersions, kbSpaces, type TiptapDoc, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";
import { EMPTY_DOC, isTiptapDoc, tiptapToText } from "../lib/text.ts";
import { deleteAttachmentRows, unlinkStoredFiles } from "./files.ts";

const SPACE_KEY_RE = /^[A-Z][A-Z0-9]{1,15}$/;
const MAX_DOC_BYTES = 1_500_000;

function cleanTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (!title) throw new HttpError(400, "Укажите заголовок");
  return title;
}

function cleanDoc(value: unknown): TiptapDoc {
  if (value === undefined || value === null) return EMPTY_DOC;
  if (!isTiptapDoc(value)) throw new HttpError(400, "Некорректное содержимое страницы");
  if (JSON.stringify(value).length > MAX_DOC_BYTES) throw new HttpError(413, "Страница слишком большая");
  return value;
}

async function getPageOr404(tx: DbOrTx, id: number) {
  const [page] = await tx.select().from(kbPages).where(eq(kbPages.id, id)).limit(1);
  if (!page) throw new HttpError(404, "Страница не найдена");
  return page;
}

/** ID страницы и всех её потомков. */
async function subtreeIds(tx: DbOrTx, id: number): Promise<number[]> {
  const result = await tx.execute<{ id: number }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM kb_pages WHERE id = ${id}
      UNION ALL
      SELECT p.id FROM kb_pages p JOIN tree t ON p.parent_id = t.id
    )
    SELECT id FROM tree`);
  return result.rows.map((r) => Number(r.id));
}

/** Цепочка предков (от корня к родителю) — для хлебных крошек. */
async function ancestors(tx: DbOrTx, parentId: number | null): Promise<{ id: number; title: string }[]> {
  if (!parentId) return [];
  const result = await tx.execute<{ id: number; title: string; depth: number }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, title, 0 AS depth FROM kb_pages WHERE id = ${parentId}
      UNION ALL
      SELECT p.id, p.parent_id, p.title, c.depth + 1 FROM kb_pages p JOIN chain c ON p.id = c.parent_id
    )
    SELECT id, title, depth FROM chain ORDER BY depth DESC`);
  return result.rows.map((r) => ({ id: Number(r.id), title: r.title }));
}

/** Следующая позиция в конце списка детей родителя. */
async function nextPosition(tx: DbOrTx, spaceId: number, parentId: number | null): Promise<number> {
  const [row] = await tx
    .select({ max: max(kbPages.position) })
    .from(kbPages)
    .where(
      and(eq(kbPages.spaceId, spaceId), parentId ? eq(kbPages.parentId, parentId) : isNull(kbPages.parentId)),
    );
  return (row?.max ?? -1) + 1;
}

export async function kbRoutes(app: FastifyInstance): Promise<void> {
  // ── Пространства ─────────────────────────────────────────────────────────

  app.get("/spaces", async () => {
    const rows = await db
      .select({
        id: kbSpaces.id,
        key: kbSpaces.key,
        name: kbSpaces.name,
        description: kbSpaces.description,
        updatedAt: kbSpaces.updatedAt,
        pageCount: count(kbPages.id),
      })
      .from(kbSpaces)
      .leftJoin(kbPages, eq(kbPages.spaceId, kbSpaces.id))
      .groupBy(kbSpaces.id)
      .orderBy(asc(kbSpaces.position), asc(kbSpaces.name));
    return { spaces: rows };
  });

  app.post("/spaces", async (request) => {
    const user = currentUser(request);
    const input = body<{ key: string; name: string; description: string }>(request);
    const key = String(input.key ?? "").trim().toUpperCase();
    const name = String(input.name ?? "").trim().slice(0, 100);
    const description = String(input.description ?? "").trim().slice(0, 500);
    if (!SPACE_KEY_RE.test(key)) {
      throw new HttpError(400, "Ключ: 2–16 латинских букв и цифр, начинается с буквы (например SALES)");
    }
    if (!name) throw new HttpError(400, "Укажите название");
    const [exists] = await db.select({ id: kbSpaces.id }).from(kbSpaces).where(eq(kbSpaces.key, key));
    if (exists) throw new HttpError(409, "Пространство с таким ключом уже есть");

    const [{ max: maxPos }] = await db.select({ max: max(kbSpaces.position) }).from(kbSpaces);
    const [space] = await db
      .insert(kbSpaces)
      .values({ key, name, description, position: (maxPos ?? -1) + 1, createdBy: user.id, updatedBy: user.id })
      .returning();
    await audit(db, {
      userId: user.id,
      action: "create",
      entityType: "kb_space",
      entityId: space.id,
      summary: `Создал пространство «${name}» (${key})`,
      ip: request.ip,
    });
    return { space };
  });

  app.patch("/spaces/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ name: string; description: string }>(request);
    const [space] = await db.select().from(kbSpaces).where(eq(kbSpaces.id, id));
    if (!space) throw new HttpError(404, "Пространство не найдено");
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : space.name;
    const description =
      typeof input.description === "string" ? input.description.trim().slice(0, 500) : space.description;
    if (!name) throw new HttpError(400, "Укажите название");
    const [updated] = await db
      .update(kbSpaces)
      .set({ name, description, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(kbSpaces.id, id))
      .returning();
    await audit(db, {
      userId: user.id,
      action: "update",
      entityType: "kb_space",
      entityId: id,
      summary: `Изменил пространство «${name}»`,
      ip: request.ip,
    });
    return { space: updated };
  });

  /** Удалить пространство со всеми страницами — только admin. */
  app.delete("/spaces/:id", async (request) => {
    const admin = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [space] = await db.select().from(kbSpaces).where(eq(kbSpaces.id, id));
    if (!space) throw new HttpError(404, "Пространство не найдено");

    const pageIds = (await db.select({ id: kbPages.id }).from(kbPages).where(eq(kbPages.spaceId, id))).map(
      (r) => r.id,
    );
    const stored = await db.transaction(async (tx) => {
      const keys = await deleteAttachmentRows(tx, "kb_page", pageIds);
      await tx.delete(kbSpaces).where(eq(kbSpaces.id, id));
      await audit(tx, {
        userId: admin.id,
        action: "delete",
        entityType: "kb_space",
        entityId: id,
        summary: `Удалил пространство «${space.name}» (${space.key}) и ${pageIds.length} стр.`,
        ip: request.ip,
      });
      return keys;
    });
    await unlinkStoredFiles(stored);
    return { ok: true };
  });

  /** Пространство и плоский список страниц для дерева. */
  app.get("/spaces/:key", async (request) => {
    const key = String((request.params as { key: string }).key).toUpperCase();
    const [space] = await db.select().from(kbSpaces).where(eq(kbSpaces.key, key));
    if (!space) throw new HttpError(404, "Пространство не найдено");
    const pages = await db
      .select({
        id: kbPages.id,
        parentId: kbPages.parentId,
        title: kbPages.title,
        position: kbPages.position,
        updatedAt: kbPages.updatedAt,
      })
      .from(kbPages)
      .where(eq(kbPages.spaceId, space.id))
      .orderBy(asc(kbPages.position), asc(kbPages.id));
    return { space, pages };
  });

  // ── Страницы ─────────────────────────────────────────────────────────────

  app.post("/pages", async (request) => {
    const user = currentUser(request);
    const input = body<{ spaceId: number; parentId: number | null; title: string; content: unknown }>(request);
    const spaceId = intParam(input.spaceId, "spaceId");
    const parentId = input.parentId == null ? null : intParam(input.parentId, "parentId");
    const title = cleanTitle(input.title);
    const content = cleanDoc(input.content);
    const contentText = tiptapToText(content);

    const page = await db.transaction(async (tx) => {
      const [space] = await tx.select().from(kbSpaces).where(eq(kbSpaces.id, spaceId));
      if (!space) throw new HttpError(404, "Пространство не найдено");
      if (parentId) {
        const parent = await getPageOr404(tx, parentId);
        if (parent.spaceId !== spaceId) throw new HttpError(400, "Родитель из другого пространства");
      }
      const [created] = await tx
        .insert(kbPages)
        .values({
          spaceId,
          parentId,
          title,
          content,
          contentText,
          position: await nextPosition(tx, spaceId, parentId),
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: kbPages.id, version: kbPages.version });
      await tx.insert(kbPageVersions).values({
        pageId: created.id,
        version: 1,
        title,
        content,
        contentText,
        note: "Создание",
        createdBy: user.id,
      });
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "kb_page",
        entityId: created.id,
        summary: `Создал страницу «${title}» в пространстве «${space.name}»`,
        ip: request.ip,
      });
      return created;
    });
    return { page };
  });

  app.get("/pages/:id", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const creator = alias(users, "creator");
    const editor = alias(users, "editor");
    const [row] = await db
      .select({
        page: kbPages,
        space: { id: kbSpaces.id, key: kbSpaces.key, name: kbSpaces.name },
        createdByName: creator.name,
        updatedByName: editor.name,
      })
      .from(kbPages)
      .innerJoin(kbSpaces, eq(kbSpaces.id, kbPages.spaceId))
      .leftJoin(creator, eq(creator.id, kbPages.createdBy))
      .leftJoin(editor, eq(editor.id, kbPages.updatedBy))
      .where(eq(kbPages.id, id))
      .limit(1);
    if (!row) throw new HttpError(404, "Страница не найдена");

    const { search: _search, contentText: _text, ...page } = row.page;
    const files = await db
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
      .where(and(eq(attachments.ownerType, "kb_page"), eq(attachments.ownerId, id)))
      .orderBy(asc(attachments.createdAt));

    return {
      page: { ...page, createdByName: row.createdByName, updatedByName: row.updatedByName },
      space: row.space,
      breadcrumbs: await ancestors(db, page.parentId),
      attachments: files,
    };
  });

  /** Сохранение страницы. baseVersion — защита от затирания чужих правок. */
  app.put("/pages/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ title: string; content: unknown; baseVersion: number }>(request);
    const title = cleanTitle(input.title);
    const content = cleanDoc(input.content);
    const contentText = tiptapToText(content);

    return db.transaction(async (tx) => {
      const [page] = await tx.select().from(kbPages).where(eq(kbPages.id, id)).for("update");
      if (!page) throw new HttpError(404, "Страница не найдена");
      if (input.baseVersion !== undefined && Number(input.baseVersion) !== page.version) {
        throw new HttpError(
          409,
          "Страницу уже изменил другой сотрудник. Скопируйте свой текст, обновите страницу и внесите правки заново.",
        );
      }
      const unchanged = page.title === title && JSON.stringify(page.content) === JSON.stringify(content);
      if (unchanged) return { page: { id, version: page.version } };

      const version = page.version + 1;
      await tx
        .update(kbPages)
        .set({ title, content, contentText, version, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(kbPages.id, id));
      await tx.insert(kbPageVersions).values({ pageId: id, version, title, content, contentText, createdBy: user.id });
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "kb_page",
        entityId: id,
        summary:
          page.title === title
            ? `Изменил страницу «${title}» (версия ${version})`
            : `Изменил страницу «${page.title}» → «${title}» (версия ${version})`,
        ip: request.ip,
      });
      return { page: { id, version } };
    });
  });

  /** Удаление страницы вместе с дочерними. */
  app.delete("/pages/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const stored = await db.transaction(async (tx) => {
      const page = await getPageOr404(tx, id);
      const ids = await subtreeIds(tx, id);
      const keys = await deleteAttachmentRows(tx, "kb_page", ids);
      await tx.delete(kbPages).where(eq(kbPages.id, id));
      await audit(tx, {
        userId: user.id,
        action: "delete",
        entityType: "kb_page",
        entityId: id,
        summary:
          ids.length > 1
            ? `Удалил страницу «${page.title}» и ${ids.length - 1} дочерн.`
            : `Удалил страницу «${page.title}»`,
        data: { title: page.title, content: page.content, subtree: ids },
        ip: request.ip,
      });
      return keys;
    });
    await unlinkStoredFiles(stored);
    return { ok: true };
  });

  /** Перенос в дереве: новый родитель и позиция среди его детей. */
  app.post("/pages/:id/move", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ parentId: number | null; index: number }>(request);
    const parentId = input.parentId == null ? null : intParam(input.parentId, "parentId");
    const index = Math.max(0, Math.floor(Number(input.index) || 0));

    await db.transaction(async (tx) => {
      const page = await getPageOr404(tx, id);
      if (parentId) {
        const parent = await getPageOr404(tx, parentId);
        if (parent.spaceId !== page.spaceId) throw new HttpError(400, "Нельзя перенести в другое пространство");
        if ((await subtreeIds(tx, id)).includes(parentId)) {
          throw new HttpError(400, "Нельзя вложить страницу в саму себя или в свою дочернюю");
        }
      }
      const siblings = await tx
        .select({ id: kbPages.id })
        .from(kbPages)
        .where(
          and(
            eq(kbPages.spaceId, page.spaceId),
            parentId ? eq(kbPages.parentId, parentId) : isNull(kbPages.parentId),
          ),
        )
        .orderBy(asc(kbPages.position), asc(kbPages.id));
      const order = siblings.map((s) => s.id).filter((sid) => sid !== id);
      order.splice(Math.min(index, order.length), 0, id);

      for (const [position, sid] of order.entries()) {
        await tx
          .update(kbPages)
          .set(sid === id ? { position, parentId } : { position })
          .where(eq(kbPages.id, sid));
      }
      if (page.parentId !== parentId) {
        const parentTitle = parentId ? (await getPageOr404(tx, parentId)).title : null;
        await audit(tx, {
          userId: user.id,
          action: "move",
          entityType: "kb_page",
          entityId: id,
          summary: parentTitle
            ? `Перенёс страницу «${page.title}» внутрь «${parentTitle}»`
            : `Перенёс страницу «${page.title}» в корень пространства`,
          ip: request.ip,
        });
      }
    });
    return { ok: true };
  });

  // ── Версии ───────────────────────────────────────────────────────────────

  app.get("/pages/:id/versions", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    await getPageOr404(db, id);
    const versions = await db
      .select({
        version: kbPageVersions.version,
        title: kbPageVersions.title,
        note: kbPageVersions.note,
        createdAt: kbPageVersions.createdAt,
        createdByName: users.name,
      })
      .from(kbPageVersions)
      .leftJoin(users, eq(users.id, kbPageVersions.createdBy))
      .where(eq(kbPageVersions.pageId, id))
      .orderBy(desc(kbPageVersions.version));
    return { versions };
  });

  app.get("/pages/:id/versions/:version", async (request) => {
    const params = request.params as { id: string; version: string };
    const id = intParam(params.id);
    const version = intParam(params.version, "version");
    const [row] = await db
      .select({
        version: kbPageVersions.version,
        title: kbPageVersions.title,
        content: kbPageVersions.content,
        note: kbPageVersions.note,
        createdAt: kbPageVersions.createdAt,
        createdByName: users.name,
      })
      .from(kbPageVersions)
      .leftJoin(users, eq(users.id, kbPageVersions.createdBy))
      .where(and(eq(kbPageVersions.pageId, id), eq(kbPageVersions.version, version)));
    if (!row) throw new HttpError(404, "Версия не найдена");
    return { version: row };
  });

  /** Откат: содержимое старой версии становится новой версией (история не теряется). */
  app.post("/pages/:id/versions/:version/restore", async (request) => {
    const user = currentUser(request);
    const params = request.params as { id: string; version: string };
    const id = intParam(params.id);
    const target = intParam(params.version, "version");

    return db.transaction(async (tx) => {
      const [page] = await tx.select().from(kbPages).where(eq(kbPages.id, id)).for("update");
      if (!page) throw new HttpError(404, "Страница не найдена");
      const [old] = await tx
        .select()
        .from(kbPageVersions)
        .where(and(eq(kbPageVersions.pageId, id), eq(kbPageVersions.version, target)));
      if (!old) throw new HttpError(404, "Версия не найдена");

      const version = page.version + 1;
      await tx
        .update(kbPages)
        .set({
          title: old.title,
          content: old.content,
          contentText: old.contentText,
          version,
          updatedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(kbPages.id, id));
      await tx.insert(kbPageVersions).values({
        pageId: id,
        version,
        title: old.title,
        content: old.content,
        contentText: old.contentText,
        note: `Откат к версии ${target}`,
        createdBy: user.id,
      });
      await audit(tx, {
        userId: user.id,
        action: "restore",
        entityType: "kb_page",
        entityId: id,
        summary: `Откатил страницу «${old.title}» к версии ${target}`,
        ip: request.ip,
      });
      return { page: { id, version } };
    });
  });
}
