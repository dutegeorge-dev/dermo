/** Запись в журнал действий. */

import type { DbOrTx } from "../db/client.ts";
import { auditLog } from "../db/schema.ts";

export type AuditEntry = {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  data?: unknown;
  ip?: string | null;
};

export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    summary: entry.summary,
    data: entry.data ?? null,
    ip: entry.ip ?? null,
  });
}
