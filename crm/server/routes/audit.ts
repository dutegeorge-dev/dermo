/** Журнал действий (только admin). */

import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.ts";
import { auditLog, users } from "../db/schema.ts";
import { requireAdmin } from "../lib/http.ts";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request) => {
    requireAdmin(request);
    const query = request.query as { before?: string; userId?: string; entityType?: string; limit?: string };
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const filters: SQL[] = [];
    if (query.before && Number(query.before) > 0) filters.push(lt(auditLog.id, Number(query.before)));
    if (query.userId && Number(query.userId) > 0) filters.push(eq(auditLog.userId, Number(query.userId)));
    if (query.entityType) filters.push(eq(auditLog.entityType, String(query.entityType)));

    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        summary: auditLog.summary,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);

    return {
      entries: rows.slice(0, limit),
      nextBefore: rows.length > limit ? rows[limit - 1].id : null,
    };
  });
}
