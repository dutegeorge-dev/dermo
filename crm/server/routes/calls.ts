/** Справочник для звонков: чтение, правка строк, порядок, история версий. */

import crypto from "node:crypto";

import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.ts";
import { callScriptTopics, callScriptVersions, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import {
  latestVersion,
  listTopics,
  lockCallScript,
  normalizeTopic,
  replaceAllTopics,
  snapshotCallScript,
  topicRow,
} from "../lib/call-script.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";

function label(topic: { title: string; ask: string[] }): string {
  return topic.title || topic.ask[0] || "без названия";
}

const CONFLICT =
  "Эту строку уже изменил другой сотрудник. Обновите справочник и внесите правку заново.";

export async function callRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ topics: await listTopics(db), version: await latestVersion(db) }));

  /** Новая строка: в конец или после строки afterId. */
  app.post("/topics", async (request) => {
    const user = currentUser(request);
    const input = body<{ topic: unknown; afterId: string }>(request);
    const topic = normalizeTopic(input.topic);
    const id = `t-${crypto.randomBytes(5).toString("hex")}`;

    return db.transaction(async (tx) => {
      await lockCallScript(tx);
      const current = await listTopics(tx);
      const order = current.map((t) => t.id);
      const at = input.afterId ? order.indexOf(String(input.afterId)) + 1 : order.length;
      order.splice(at > 0 ? at : order.length, 0, id);

      await tx.insert(callScriptTopics).values({ id, position: order.indexOf(id), ...topicRow(topic), updatedBy: user.id });
      for (const [position, tid] of order.entries()) {
        if (tid !== id) await tx.update(callScriptTopics).set({ position }).where(eq(callScriptTopics.id, tid));
      }
      const version = await snapshotCallScript(tx, user.id, `Добавлена строка «${label(topic)}»`);
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "call_topic",
        entityId: id,
        summary: `Добавил строку справочника «${label(topic)}» (версия ${version})`,
        ip: request.ip,
      });
      return { id, version };
    });
  });

  /** Правка строки. baseUpdatedAt — время последней правки, от которой редактировали. */
  app.put("/topics/:id", async (request) => {
    const user = currentUser(request);
    const id = String((request.params as { id: string }).id);
    const input = body<{ topic: unknown; baseUpdatedAt: string }>(request);
    const topic = normalizeTopic(input.topic);

    return db.transaction(async (tx) => {
      await lockCallScript(tx);
      const [existing] = await tx.select().from(callScriptTopics).where(eq(callScriptTopics.id, id));
      if (!existing) throw new HttpError(404, "Строка не найдена — возможно, её удалили");
      if (input.baseUpdatedAt && new Date(input.baseUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
        throw new HttpError(409, CONFLICT);
      }
      const same =
        existing.title === topic.title &&
        JSON.stringify(existing.ask) === JSON.stringify(topic.ask) &&
        JSON.stringify(existing.qa) === JSON.stringify(topic.qa);
      if (same) return { id, version: (await latestVersion(tx))?.version ?? null };

      await tx
        .update(callScriptTopics)
        .set({ ...topicRow(topic), updatedBy: user.id, updatedAt: new Date() })
        .where(eq(callScriptTopics.id, id));
      const version = await snapshotCallScript(tx, user.id, `Изменена строка «${label(topic)}»`);
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "call_topic",
        entityId: id,
        summary: `Изменил строку справочника «${label(topic)}» (версия ${version})`,
        data: { before: { title: existing.title, ask: existing.ask, qa: existing.qa } },
        ip: request.ip,
      });
      return { id, version };
    });
  });

  app.delete("/topics/:id", async (request) => {
    const user = currentUser(request);
    const id = String((request.params as { id: string }).id);
    return db.transaction(async (tx) => {
      await lockCallScript(tx);
      const [existing] = await tx.delete(callScriptTopics).where(eq(callScriptTopics.id, id)).returning();
      if (!existing) throw new HttpError(404, "Строка не найдена — возможно, её уже удалили");
      const version = await snapshotCallScript(tx, user.id, `Удалена строка «${label(existing)}»`);
      await audit(tx, {
        userId: user.id,
        action: "delete",
        entityType: "call_topic",
        entityId: id,
        summary: `Удалил строку справочника «${label(existing)}» (версия ${version})`,
        data: { title: existing.title, ask: existing.ask, qa: existing.qa },
        ip: request.ip,
      });
      return { ok: true, version };
    });
  });

  /** Новый порядок строк: полный список ID. */
  app.post("/reorder", async (request) => {
    const user = currentUser(request);
    const input = body<{ ids: string[] }>(request);
    const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];

    return db.transaction(async (tx) => {
      await lockCallScript(tx);
      const current = await listTopics(tx);
      const currentIds = current.map((t) => t.id);
      const sameSet = ids.length === currentIds.length && [...ids].sort().join() === [...currentIds].sort().join();
      if (!sameSet) throw new HttpError(409, "Справочник изменился. Обновите страницу и повторите.");
      if (ids.join() === currentIds.join()) return { ok: true, version: (await latestVersion(tx))?.version ?? null };

      for (const [position, id] of ids.entries()) {
        await tx.update(callScriptTopics).set({ position }).where(eq(callScriptTopics.id, id));
      }
      const version = await snapshotCallScript(tx, user.id, "Изменён порядок строк");
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "call_script",
        summary: `Изменил порядок строк справочника (версия ${version})`,
        ip: request.ip,
      });
      return { ok: true, version };
    });
  });

  // ── История версий ───────────────────────────────────────────────────────

  app.get("/versions", async () => ({
    versions: await db
      .select({
        version: callScriptVersions.version,
        note: callScriptVersions.note,
        createdAt: callScriptVersions.createdAt,
        createdByName: users.name,
      })
      .from(callScriptVersions)
      .leftJoin(users, eq(users.id, callScriptVersions.createdBy))
      .orderBy(desc(callScriptVersions.version))
      .limit(500),
  }));

  app.get("/versions/:version", async (request) => {
    const version = intParam((request.params as { version: string }).version, "version");
    const [row] = await db
      .select({
        version: callScriptVersions.version,
        note: callScriptVersions.note,
        topics: callScriptVersions.topics,
        createdAt: callScriptVersions.createdAt,
        createdByName: users.name,
      })
      .from(callScriptVersions)
      .leftJoin(users, eq(users.id, callScriptVersions.createdBy))
      .where(eq(callScriptVersions.version, version));
    if (!row) throw new HttpError(404, "Версия не найдена");
    return { version: row };
  });

  /** Откат: снимок старой версии становится текущим содержимым и новой версией. */
  app.post("/versions/:version/restore", async (request) => {
    const user = currentUser(request);
    const target = intParam((request.params as { version: string }).version, "version");
    return db.transaction(async (tx) => {
      await lockCallScript(tx);
      const [old] = await tx.select().from(callScriptVersions).where(eq(callScriptVersions.version, target));
      if (!old) throw new HttpError(404, "Версия не найдена");
      await replaceAllTopics(tx, old.topics, user.id);
      const version = await snapshotCallScript(tx, user.id, `Откат к версии ${target}`);
      await audit(tx, {
        userId: user.id,
        action: "restore",
        entityType: "call_script",
        summary: `Откатил справочник к версии ${target} (версия ${version})`,
        ip: request.ip,
      });
      return { ok: true, version };
    });
  });
}
