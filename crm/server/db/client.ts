/** Подключение к PostgreSQL (пул pg + Drizzle). */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { requireDatabaseUrl } from "../config.ts";
import * as schema from "./schema.ts";

export const pool = new pg.Pool({ connectionString: requireDatabaseUrl(), max: 10 });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
/** Транзакция или сам db — для функций, работающих в обоих контекстах. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
