/**
 * Обновить справочник ТН ВЭД со ставками пошлин:
 *   npm run tnved:update               — скачать свежую выгрузку и записать в БД;
 *   npm run tnved:update -- --if-empty — только если справочник пуст (для deploy);
 *   npm run tnved:update -- --file x.xlsx — из файла.
 */

import fs from "node:fs";
import { parseArgs } from "node:util";

import { db, pool } from "../db/client.ts";
import { downloadTnved, parseTnvedXlsx, saveTnved, TNVED_URL, tnvedCount } from "../lib/tnved.ts";

const { values } = parseArgs({ options: { "if-empty": { type: "boolean" }, file: { type: "string" } } });

try {
  if (values["if-empty"] && (await tnvedCount(db)) > 0) {
    console.log("✓ Справочник ТН ВЭД уже заполнен");
  } else {
    console.log(values.file ? `→ читаем ${values.file}` : `→ скачиваем ${TNVED_URL}`);
    const buffer = values.file ? fs.readFileSync(values.file) : await downloadTnved();
    const rows = await parseTnvedXlsx(buffer);
    if (rows.length < 5000) throw new Error(`В выгрузке всего ${rows.length} кодов — похоже, формат изменился; справочник не тронут`);
    await saveTnved(db, rows);
    console.log(`✓ Справочник ТН ВЭД обновлён: ${rows.length} кодов`);
  }
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
