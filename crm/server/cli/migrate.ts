/** Применяет SQL-миграции из crm/drizzle/ (npm run db:migrate). */

import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { CRM_ROOT } from "../config.ts";
import { db, pool } from "../db/client.ts";

try {
  await migrate(db, { migrationsFolder: path.join(CRM_ROOT, "drizzle") });
  console.log("✓ Миграции применены");
} catch (error) {
  console.error("✗ Ошибка миграции:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
