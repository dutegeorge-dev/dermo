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
 * 3. --demo — тестовые клиенты и сделки на разных этапах (метка «демо»,
 *    source=demo), чтобы попробовать CRM. Повторно не создаются.
 *    --remove-demo — удалить их (и демо-клиентов без других сделок).
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { and, asc, eq, notExists } from "drizzle-orm";

import { CRM_ROOT } from "../config.ts";
import { db, pool } from "../db/client.ts";
import { contacts, counterparties, dealEvents, deals, dealStatuses, kbSpaces } from "../db/schema.ts";
import { getCompany, setCompany } from "../lib/settings.ts";
import { removeDemoExtras, seedDemoDocuments, seedDemoKb } from "./demo.ts";
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
    demo: { type: "boolean", default: false },
    "remove-demo": { type: "boolean", default: false },
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

const DEMO_DEALS = [
  { client: "ООО «Пол-Маркет»", inn: "7701234567", contact: "Сергей", phone: "+7 900 000-00-01", title: "Ламинат LVT, 2 фуры", product: "Ламинат LVT 4 мм", hsCode: "3918101000", weightKg: 38000, volumeM3: 64, route: "auto", stage: 0 },
  { client: "ИП Соколова А. В.", inn: "500100732259", contact: "Анна", phone: "+7 900 000-00-02", title: "Детская одежда, сборный груз", product: "Одежда детская трикотажная", hsCode: "6111209000", weightKg: 420, volumeM3: 3.2, route: "auto", stage: 1, chestnyZnak: "required" },
  { client: "ООО «ТехноСвет»", inn: "7802345678", contact: "Михаил", phone: "+7 900 000-00-03", title: "Светодиодные панели", product: "Панели LED 600×600", hsCode: "9405110009", weightKg: 1800, volumeM3: 12, route: "rail", stage: 2, certificates: "in_progress" },
  { client: "ООО «Модуль»", inn: "6601234567", contact: "Олег", phone: "+7 900 000-00-04", title: "Модульный дом, образцы", product: "Сэндвич-панели (образцы)", hsCode: "9406900099", weightKg: 35, volumeM3: 0.2, route: "air", stage: 3 },
  { client: "ООО «Вектор Поставка»", inn: "5401234567", contact: "Дарья", phone: "+7 900 000-00-05", title: "Мониторы 27″, 300 шт.", product: "Мониторы 27″", hsCode: "8528521000", weightKg: 2700, volumeM3: 18, route: "rail", stage: 4, exportLicense: "we_arrange" },
  { client: "ООО «Пол-Маркет»", inn: "7701234567", contact: "Сергей", phone: "+7 900 000-00-01", title: "Плинтус и подложка", product: "Плинтус ПВХ, подложка", hsCode: "3916209000", weightKg: 5200, volumeM3: 22, route: "auto", stage: 5 },
  { client: "ООО «Агро-Тех»", inn: "2301234567", contact: "Виктор", phone: "+7 900 000-00-06", title: "Запчасти для спецтехники", product: "Запчасти гидравлики", hsCode: "8412290009", weightKg: 900, volumeM3: 2.5, route: "auto", stage: 6 },
  { client: "ИП Ким Д. С.", inn: "253601234567", contact: "Денис", phone: "+7 900 000-00-07", title: "Текстиль для дома", product: "Постельное бельё", hsCode: "6302210000", weightKg: 3100, volumeM3: 25, route: "sea", stage: 7, chestnyZnak: "applied" },
  { client: "ООО «ТехноСвет»", inn: "7802345678", contact: "Михаил", phone: "+7 900 000-00-03", title: "Прожекторы, пробная партия", product: "Прожекторы LED 100 Вт", hsCode: "9405410009", weightKg: 600, volumeM3: 4, route: "auto", stage: 8 },
] as const;

async function seedDemo(): Promise<void> {
  const [exists] = await db.select({ id: deals.id }).from(deals).where(eq(deals.source, "demo")).limit(1);
  if (exists) {
    console.log("  = демо-сделки уже есть (удалить: --remove-demo)");
    return;
  }
  const stages = await db.select().from(dealStatuses).orderBy(asc(dealStatuses.position));
  const clientIds = new Map<string, { clientId: number; contactId: number }>();
  await db.transaction(async (tx) => {
    for (const [i, d] of DEMO_DEALS.entries()) {
      let ids = clientIds.get(d.client);
      if (!ids) {
        const [client] = await tx
          .insert(counterparties)
          .values({ role: "client", name: d.client, kind: d.client.startsWith("ИП") ? "ip" : "ooo", inn: d.inn, notes: "демо" })
          .returning({ id: counterparties.id });
        const [contact] = await tx
          .insert(contacts)
          .values({ counterpartyId: client.id, name: d.contact, phone: d.phone, messenger: "telegram", isPrimary: true })
          .returning({ id: contacts.id });
        ids = { clientId: client.id, contactId: contact.id };
        clientIds.set(d.client, ids);
      }
      const stage = stages[Math.min(d.stage, stages.length - 1)];
      const due = new Date(Date.now() + (i - 2) * 3 * 86_400_000).toISOString().slice(0, 10);
      const [deal] = await tx
        .insert(deals)
        .values({
          title: d.title,
          ...ids,
          statusKey: stage.key,
          outcome: stage.isFinal ? "won" : null,
          closedAt: stage.isFinal ? new Date() : null,
          product: d.product,
          hsCode: d.hsCode,
          weightKg: String(d.weightKg),
          volumeM3: String(d.volumeM3),
          pickupLocation: "Гуанчжоу",
          deliveryLocation: "Москва",
          route: d.route,
          contractParty: "ours",
          exportLicense: "exportLicense" in d ? d.exportLicense : "yes",
          certificates: "certificates" in d ? d.certificates : "yes",
          chestnyZnak: "chestnyZnak" in d ? d.chestnyZnak : "not_required",
          dueDate: due,
          priority: i % 4 === 0 ? "high" : "medium",
          labels: ["демо"],
          description: "Тестовая сделка для знакомства с CRM. Удалить: npm run crm:seed -- --remove-demo",
          boardPosition: (i + 1) * 1024,
          source: "demo",
        })
        .returning({ id: deals.id });
      await tx.insert(dealEvents).values({ dealId: deal.id, kind: "created", newValue: stage.name });
    }
  });
  console.log(`  + демо: ${DEMO_DEALS.length} сделок, ${clientIds.size} клиентов`);
}

async function removeDemo(): Promise<void> {
  const removed = await db.delete(deals).where(eq(deals.source, "demo")).returning({ id: deals.id });
  await removeDemoExtras();
  const orphanDemoClients = await db
    .delete(counterparties)
    .where(
      and(
        eq(counterparties.notes, "демо"),
        notExists(db.select({ id: deals.id }).from(deals).where(eq(deals.clientId, counterparties.id))),
      ),
    )
    .returning({ id: counterparties.id });
  console.log(`  − удалено демо-сделок: ${removed.length}, демо-клиентов: ${orphanDemoClients.length}`);
}

/** Реквизиты ООО ТЛК БАРС для шаблонов — из договоров компании. Только если ещё не заданы. */
async function seedCompany(): Promise<void> {
  const current = await getCompany(db);
  if (current.name) return;
  const vtb = {
    bankName: "ФИЛИАЛ «ЦЕНТРАЛЬНЫЙ» БАНКА ВТБ (ПАО)",
    bik: "044525411",
    corrAccount: "30101810145250000411",
    bankInn: "7702070139",
    bankAddress: "г Москва ул. Рождественка, д. 10/2, строен. 1",
  };
  await setCompany(
    db,
    {
      name: "ООО ТЛК БАРС",
      fullName: "Общество с ограниченной ответственностью «Торгово-логистическая компания БАРС»",
      legalAddress: "143408, Московская область, г. Красногорск, б-р Космонавтов, д. 7, кв. 189",
      ogrn: "1255000095778",
      inn: "5024256988",
      kpp: "502401001",
      okpo: "54212939",
      city: "г. Красногорск",
      signatoryTitle: "Директор",
      signatoryName: "Фотин Евгений Петрович",
      signatoryShort: "Фотин Е.П.",
      signatoryBasis: "Устава",
      email: "info@tlkbars.ru",
      phone: "+7 (495) 133-12-60",
      accounts: [
        { id: "vtb-cny", label: "Юани, ВТБ", currency: "CNY", account: "40702156924840000310", ...vtb },
        { id: "vtb-rub", label: "Рубли, ВТБ", currency: "RUB", account: "40702810600810064577", ...vtb },
      ],
      orderAccountId: "vtb-cny",
    },
    null,
  );
  console.log("  + реквизиты ООО ТЛК БАРС (Настройки → Реквизиты компании)");
}

try {
  if (values["remove-demo"]) {
    console.log("Демо-данные CRM:");
    await removeDemo();
    console.log("✓ Готово");
    process.exit(0);
  }

  console.log("Реквизиты компании:");
  await seedCompany();

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
  if (values.demo) {
    console.log("Демо-данные CRM:");
    await seedDemo();
    await seedDemoDocuments();
    await seedDemoKb();
  }
  console.log("✓ Готово");
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
