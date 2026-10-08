/**
 * Начальное наполнение (идемпотентно — можно запускать сколько угодно раз):
 *
 *   npm run crm:seed                      # пространства + справочник из crm/seed/kb-call-script.json
 *   npm run crm:seed -- --file путь.json  # другой файл справочника
 *   npm run crm:seed -- --force           # перезаписать справочник содержимым файла
 *
 * 1. Пространства базы знаний «Продажи», «Таможня», «Логистика», «Компания» —
 *    создаются, если пространства с таким ключом ещё нет.
 * 2. Справочник для звонков. Без --force добавляются только темы, которых ещё
 *    нет (по id): правки, сделанные в интерфейсе, повторный импорт не затирает.
 *    С --force темы из файла заменяют одноимённые и встают в порядке файла;
 *    темы, созданные в интерфейсе, сохраняются и идут после них.
 *    Любое изменение записывается новой версией в истории справочника.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { CRM_ROOT } from "../config.ts";
import { db, pool } from "../db/client.ts";
import { kbSpaces } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import {
  listTopics,
  lockCallScript,
  normalizeTopic,
  replaceAllTopics,
  snapshotCallScript,
  type TopicInput,
} from "../lib/call-script.ts";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

const DEFAULT_SPACES = [
  { key: "SALES", name: "Продажи", description: "Скрипты, возражения, условия работы с клиентами" },
  { key: "CUSTOMS", name: "Таможня", description: "Таможенное оформление, ТН ВЭД, сертификация, маркировка" },
  { key: "LOGISTICS", name: "Логистика", description: "Маршруты, перевозчики, сроки и ставки" },
  { key: "COMPANY", name: "Компания", description: "Регламенты, реквизиты, контакты, онбординг" },
];

type FileTopic = { id: unknown; order?: unknown; title?: unknown; ask?: unknown; qa?: unknown };

function readCallScript(file: string): (TopicInput & { id: string })[] {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { topics?: FileTopic[] };
  if (!data || !Array.isArray(data.topics)) throw new Error(`${file}: ожидается объект { "topics": [...] }`);
  const seen = new Set<string>();
  return data.topics
    .map((raw, index) => {
      const id = String(raw.id ?? "").trim();
      if (!id) throw new Error(`${file}: у темы №${index + 1} нет id`);
      if (seen.has(id)) throw new Error(`${file}: id «${id}» встречается дважды`);
      seen.add(id);
      const order = Number(raw.order);
      return { id, order: Number.isFinite(order) ? order : index, index, ...normalizeTopic(raw) };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ id, title, ask, qa }) => ({ id, title, ask, qa }));
}

async function seedSpaces(): Promise<void> {
  for (const [position, space] of DEFAULT_SPACES.entries()) {
    const [exists] = await db.select({ id: kbSpaces.id }).from(kbSpaces).where(eq(kbSpaces.key, space.key));
    if (exists) continue;
    await db.insert(kbSpaces).values({ ...space, position });
    console.log(`  + пространство «${space.name}» (${space.key})`);
  }
}

async function seedCallScript(file: string, force: boolean): Promise<void> {
  const incoming = readCallScript(file);
  const fileName = path.basename(file);

  await db.transaction(async (tx) => {
    await lockCallScript(tx);
    const current = await listTopics(tx);
    const currentIds = new Set(current.map((t) => t.id));
    const incomingIds = new Set(incoming.map((t) => t.id));
    const strip = ({ id, title, ask, qa }: TopicInput & { id: string }) => ({ id, title, ask, qa });

    let next: (TopicInput & { id: string })[];
    if (force) {
      // Порядок файла, затем темы, созданные в интерфейсе.
      next = [...incoming, ...current.filter((t) => !incomingIds.has(t.id)).map(strip)];
    } else {
      // Существующие не трогаем; недостающие встают на своё место по порядку файла.
      const missing = incoming.filter((t) => !currentIds.has(t.id));
      if (missing.length === 0) {
        console.log(`  = справочник: все темы из ${fileName} (${incoming.length}) уже есть, без изменений`);
        return;
      }
      next = current.map(strip);
      for (const topic of missing) {
        const fileIndex = incoming.indexOf(topic);
        const prevId = incoming.slice(0, fileIndex).reverse().find((t) => next.some((n) => n.id === t.id))?.id;
        const at = prevId ? next.findIndex((n) => n.id === prevId) + 1 : 0;
        next.splice(at, 0, topic);
      }
    }

    if (JSON.stringify(next) === JSON.stringify(current.map(strip))) {
      console.log(`  = справочник совпадает с ${fileName}, без изменений`);
      return;
    }

    await replaceAllTopics(tx, next, null);
    const added = incoming.filter((t) => !currentIds.has(t.id)).length;
    const note = force
      ? `Импорт из ${fileName} (перезапись: ${incoming.length} тем)`
      : `Импорт из ${fileName} (добавлено тем: ${added})`;
    const version = await snapshotCallScript(tx, null, note);
    await audit(tx, { userId: null, action: "import", entityType: "call_script", summary: `CLI: ${note}, версия ${version}` });
    console.log(`  + справочник: ${note}, версия ${version}`);
  });
}

try {
  console.log("Пространства базы знаний:");
  await seedSpaces();

  console.log("Справочник для звонков:");
  const file = path.resolve(values.file ?? path.join(CRM_ROOT, "seed", "kb-call-script.json"));
  if (fs.existsSync(file)) {
    await seedCallScript(file, values.force ?? false);
  } else {
    console.warn(`  ! файл ${file} не найден — справочник не импортирован`);
    process.exitCode = 2;
  }
  console.log("✓ Готово");
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
