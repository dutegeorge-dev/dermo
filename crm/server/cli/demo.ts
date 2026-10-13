/**
 * Демо-данные для показа CRM команде (npm run crm:seed -- --demo).
 * Всё вымышленное, помечено «демо» и удаляется: npm run crm:seed -- --remove-demo.
 *
 * Три сделки с полной цепочкой документов (комиссия ×2, ТЭУ), контрагенты
 * с реквизитами, товары, оплаты, ДТ, сертификат, доверенность; страницы
 * базы знаний по разделам.
 */

import { and, asc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";

import { type CostLine, docSpec } from "../../shared/documents.ts";
import { db, type DbOrTx } from "../db/client.ts";
import {
  contacts,
  counterparties,
  dealComments,
  shipmentParties,
  deals,
  dealStatuses,
  documentItems,
  documents,
  kbPages,
  kbPageVersions,
  kbSpaces,
  products,
  shipments,
  users,
} from "../db/schema.ts";
import { createDeal } from "../lib/deals.ts";
import { linkToShipment, nextSeqNo, pad2, replaceItems } from "../lib/documents.ts";
import { addShipmentEvent, createShipment } from "../lib/shipments.ts";
import { addDays, MILESTONES, type MilestoneKey, SHIPMENT_STAGES } from "../../shared/shipments.ts";
import { buildOrderDraft } from "../lib/order.ts";
import { tiptapToText } from "../lib/text.ts";

const MARK = "демо";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type CpInput = Partial<typeof counterparties.$inferInsert> & { name: string; role: "client" | "supplier" | "contractor"; contact?: { name: string; phone?: string; email?: string; messenger?: "telegram" | "whatsapp" | "wechat"; position?: string } };

async function cp(tx: DbOrTx, input: CpInput): Promise<number> {
  const { contact, ...values } = input;
  const [row] = await tx
    .insert(counterparties)
    .values({ notes: MARK, ...values })
    .returning({ id: counterparties.id });
  if (contact) await tx.insert(contacts).values({ counterpartyId: row.id, isPrimary: true, ...contact });
  return row.id;
}

type Item = { name: string; quantity?: number; unit?: string; price?: number; hsCode?: string };

async function doc(
  tx: DbOrTx,
  userId: number | null,
  input: Partial<typeof documents.$inferInsert> & { type: string },
  items?: Item[],
): Promise<number> {
  const spec = docSpec(input.type)!;
  const values: typeof documents.$inferInsert = { notes: MARK, createdBy: userId, ...input };
  if (spec.numberedInParent && values.parentId && !values.seqNo) {
    values.seqNo = await nextSeqNo(tx, values.parentId, input.type);
    values.number ??= pad2(values.seqNo);
  }
  const [row] = await tx.insert(documents).values(values).returning();
  const patch: Partial<typeof documents.$inferInsert> = {};
  if (items) {
    // Товары справочника — тоже с пометкой «демо», чтобы удалить вместе с остальным.
    for (const it of items) {
      const [found] = await tx.select({ id: products.id }).from(products).where(sql`lower(${products.name}) = lower(${it.name})`);
      if (!found) await tx.insert(products).values({ name: it.name, hsCode: it.hsCode ?? null, unit: it.unit ?? null, notes: MARK });
    }
    const total = await replaceItems(tx, userId, row.id, items);
    if (total !== null && values.amount == null) patch.amount = String(total);
  }
  Object.assign(patch, await linkToShipment(tx, userId, row));
  if (Object.keys(patch).length) await tx.update(documents).set(patch).where(eq(documents.id, row.id));
  if (row.shipmentId) await addShipmentEvent(tx, row.shipmentId, userId, "document_added", null, null, `${spec.label}${row.number ? ` № ${row.number}` : ""}`);
  return row.id;
}

/** Поручение по сделке — как кнопка «Сформировать поручение», плюс заполненная смета. */
async function order(tx: DbOrTx, userId: number | null, shipmentId: number, amounts: Partial<Record<CostLine["category"], number>>, status: string) {
  const draft = await buildOrderDraft(tx, shipmentId);
  for (const c of draft.data.costs) if (c.category in amounts) c.amount = amounts[c.category]!;
  return doc(
    tx,
    userId,
    {
      type: "commission_order",
      date: day(-20),
      counterpartyId: draft.shipment.clientId,
      shipmentId,
      parentId: draft.contract.id,
      currency: draft.currency,
      amount: draft.amount === null ? null : String(draft.amount),
      status,
      data: draft.data,
    },
    draft.items.map((i) => ({ name: i.name, quantity: Number(i.quantity), unit: i.unit ?? "", price: Number(i.price) })),
  );
}

async function stageKey(tx: DbOrTx, index: number): Promise<string> {
  const stages = await tx.select().from(dealStatuses).orderBy(asc(dealStatuses.position));
  return stages[Math.min(index, stages.length - 1)].key;
}

export async function seedDemoDocuments(): Promise<void> {
  const [exists] = await db.select({ id: documents.id }).from(documents).where(eq(documents.notes, MARK)).limit(1);
  if (exists) {
    console.log("  = демо-документы уже есть");
    return;
  }
  const [admin] = await db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1);
  const userId = admin?.id ?? null;

  await db.transaction(async (tx) => {
    // ── Контрагенты ─────────────────────────────────────────────────────────
    const vtbLike = { bankName: "ПАО «Демобанк»", bankBik: "044525999", bankCorrAccount: "30101810400000000999", bankInn: "7700000999" };
    const greenland = await cp(tx, {
      role: "client", kind: "ooo", name: "ООО «ГринЛэнд»", fullName: "Общество с ограниченной ответственностью «ГринЛэнд»",
      inn: "5001000001", kpp: "500101001", ogrn: "1225000000001", legalAddress: "143900, Московская обл., г. Балашиха, ул. Демонстрационная, д. 1",
      bankAccount: "40702810000000000101", ...vtbLike, signatoryTitle: "Генеральный директор", signatoryName: "Кузнецов Андрей Павлович", signatoryBasis: "Устава",
      email: "zakaz@greenland-demo.ru", phone: "+7 900 100-00-01",
      contact: { name: "Андрей Кузнецов", phone: "+7 900 100-00-01", email: "a.kuznetsov@greenland-demo.ru", messenger: "telegram", position: "Директор" },
    });
    const smirnov = await cp(tx, {
      role: "client", kind: "ip", name: "ИП Смирнов А.В.", inn: "770100000002", ogrn: "321770000000002",
      legalAddress: "Москва, ул. Примерная, д. 2", bankAccount: "40802810000000000202", ...vtbLike,
      signatoryTitle: "Индивидуальный предприниматель", signatoryName: "Смирнов Алексей Викторович", signatoryBasis: "свидетельства ОГРНИП",
      email: "smirnov-demo@mail.ru",
      contact: { name: "Алексей Смирнов", phone: "+7 900 100-00-02", email: "smirnov-demo@mail.ru", messenger: "whatsapp" },
    });
    const svetdom = await cp(tx, {
      role: "client", kind: "ooo", name: "ООО «Светлый Дом»", inn: "7801000003", kpp: "780101001", ogrn: "1227800000003",
      legalAddress: "Санкт-Петербург, Невский пр., д. 3", bankAccount: "40702810000000000303", ...vtbLike,
      signatoryTitle: "Директор", signatoryName: "Орлова Мария Сергеевна", signatoryBasis: "Устава", email: "info@svetdom-demo.ru",
      contact: { name: "Мария Орлова", phone: "+7 900 100-00-03", email: "m.orlova@svetdom-demo.ru", messenger: "telegram", position: "Закупки" },
    });

    const foreign = (swift: string) => ({ kind: "foreign" as const, country: "Китай", bankName: "Bank of China, demo branch", bankSwift: swift });
    const turf = await cp(tx, {
      role: "supplier", name: "SHIJIAZHUANG GREEN TURF CO., LTD.", regNumber: "91130100MA0DEMO001", legalAddress: "Shijiazhuang, Hebei, China",
      bankAccount: "1001 0000 0000 0001", ...foreign("BKCHCNBJ001"), signatoryName: "Wang Lei",
      contact: { name: "Lucy Wang", phone: "+86 130 0000 0001", messenger: "wechat", email: "lucy@greenturf-demo.cn" },
    });
    const foshan = await cp(tx, {
      role: "supplier", name: "FOSHAN NANHAI FLOORING CO., LTD.", regNumber: "91440605MA0DEMO002", legalAddress: "Foshan, Guangdong, China",
      bankAccount: "1001 0000 0000 0002", ...foreign("BKCHCNBJ002"), signatoryName: "Chen Hua",
      contact: { name: "Tony Chen", phone: "+86 130 0000 0002", messenger: "wechat" },
    });
    const brightled = await cp(tx, {
      role: "supplier", name: "SHENZHEN BRIGHTLED TECHNOLOGY CO., LTD.", regNumber: "91440300MA0DEMO003", legalAddress: "Shenzhen, Guangdong, China",
      bankAccount: "1001 0000 0000 0003", ...foreign("BKCHCNBJ003"),
      contact: { name: "Amy Li", phone: "+86 130 0000 0003", messenger: "wechat", email: "amy@brightled-demo.cn" },
    });

    const carrierCn = await cp(tx, { role: "contractor", contractorType: "carrier_cn", kind: "foreign", country: "Китай", name: "HEBEI SILK ROAD LOGISTICS CO., LTD.", contact: { name: "Mike Zhao", messenger: "wechat", phone: "+86 130 0000 0010" } });
    const carrierRu = await cp(tx, { role: "contractor", contractorType: "carrier_ru", name: "ООО «ТрансСибирь»", inn: "5402000010", country: "Россия", contact: { name: "Диспетчер", phone: "+7 900 100-00-10" } });
    const broker = await cp(tx, { role: "contractor", contractorType: "broker", name: "ООО «Брокер-Восток»", inn: "7702000011", country: "Россия", contact: { name: "Ирина, декларант", phone: "+7 900 100-00-11", email: "decl@broker-demo.ru" } });
    const svh = await cp(tx, { role: "contractor", contractorType: "warehouse", name: "ООО «СВХ Ворсино»", inn: "4025000012", country: "Россия" });

    // ── Договоры ───────────────────────────────────────────────────────────
    await doc(tx, userId, { type: "commission_contract", number: "01", date: day(-210), counterpartyId: greenland, status: "signed", validUntil: day(155) });
    await doc(tx, userId, { type: "commission_contract", number: "02", date: day(-150), counterpartyId: smirnov, status: "signed", validUntil: day(215) });
    await doc(tx, userId, { type: "teu_contract", number: "ТЭУ-03", date: day(-30), counterpartyId: svetdom, status: "draft", validUntil: day(335) });
    await doc(tx, userId, { type: "supplier_contract", number: "SGT-2026-01", date: day(-200), counterpartyId: turf, currency: "CNY", status: "signed", validUntil: day(450) });
    await doc(tx, userId, { type: "supplier_contract", number: "FNF-2026-07", date: day(-140), counterpartyId: foshan, currency: "CNY", status: "signed", validUntil: day(500) });
    // ТЭУ: контракт клиента с поставщиком.
    await doc(tx, userId, { type: "supplier_contract", number: "BLT-SD-2026", date: day(-25), counterpartyId: brightled, clientId: svetdom, currency: "USD", status: "signed", validUntil: day(340) });
    await doc(tx, userId, { type: "contractor_contract", number: "HSR-15", date: day(-180), counterpartyId: carrierCn, status: "signed", validUntil: day(185) });
    await doc(tx, userId, { type: "contractor_contract", number: "Б-44/26", date: day(-170), counterpartyId: broker, status: "signed", validUntil: day(195) });

    // Лиды воронки, из которых выросли сделки (в воронке — только работа с клиентом).
    const lead = { labels: [MARK], source: "demo", description: "Демо-лид: переговоры прошли, клиент оплатил депозит — дальше всё в «Сделках»." };
    const final = await stageKey(tx, 99);
    const d1 = await createDeal(tx, userId, { ...lead, title: "ГринЛэнд — трава на стадион", clientId: greenland, product: "Искусственная трава 30 мм, ~15 000 м²" }, { statusKey: final });
    const d2 = await createDeal(tx, userId, { ...lead, title: "Смирнов — LVT для магазина", clientId: smirnov, product: "Ламинат LVT 4 мм" }, { statusKey: final });
    const d3 = await createDeal(tx, userId, { ...lead, title: "Светлый Дом — LED-панели", clientId: svetdom, product: "Панели LED 600×600" }, { statusKey: final });
    const rail = { transport: "rail", pickupLocation: "Китай", deliveryLocation: "Москва" };
    const base = { notes: MARK, assigneeId: userId };

    // ── Сделка 1: искусственная трава, комиссия, ждём погрузку ─────────────
    const s1 = await createShipment(tx, {
      ...base, title: "Трава 30 мм зелёная", scheme: "commission", dealId: d1.id, clientId: greenland, supplierId: turf, carrierId: carrierCn,
      containerNo: "DEMU1000011", hsCode: "5703300000", weightKg: "21500", volumeM3: "58", ...rail,
      pickupLocation: "Shijiazhuang", deliveryLocation: "Московская обл., г. Балашиха",
      exportLicense: "yes", certificates: "in_progress", certificateHolder: "ООО «ГринЛэнд»", chestnyZnak: "not_required",
      milestones: demoMilestones(3, 2), flags: { balance: day(-1) },
    }, userId);
    await doc(tx, userId, {
      type: "supplier_invoice", number: "PI-SGT-0412", date: day(-22), counterpartyId: turf, shipmentId: s1.id, currency: "CNY",
      paymentStatus: "partial", paidAmount: "41746.20", paidAt: day(-18),
      data: { incoterms: "EXW (Shijiazhuang, Китай)", paymentTerms: "30% депозит 70% до отгрузки" },
    }, [
      { name: "Artificial grass 30mm", quantity: 14600, unit: "кв. м.", price: 9.49, hsCode: "5703300000" },
      { name: "Glue for artificial grass", quantity: 50, unit: "шт.", price: 12, hsCode: "3506910000" },
    ]);
    await order(tx, userId, s1.id, { transport: 60050, broker: 20000, terminal: 110000, customs: 900000, commission: 156000 }, "signed");
    await doc(tx, userId, { type: "contractor_invoice", number: "HSR-INV-0931", date: day(-5), counterpartyId: carrierCn, shipmentId: s1.id, currency: "CNY", amount: "61000", paymentStatus: "unpaid" });
    await doc(tx, userId, { type: "packing_list", number: "PL-SGT-0412", date: day(-6), counterpartyId: turf, shipmentId: s1.id });
    // Сертификат на товар (не на сделку): виден во всех сделках с этой травой.
    await doc(tx, userId, { type: "conformity", number: "ЕАЭС N RU Д-CN.РА01.В.54321/26", date: day(-120), clientId: greenland, validUntil: day(610) }, [
      { name: "Artificial grass 30mm", hsCode: "5703300000" },
    ]);

    // ── Сделка 2: LVT, комиссия, выпущен — доставка клиенту ────────────────
    const s2 = await createShipment(tx, {
      ...base, title: "LVT 4 мм дуб", scheme: "commission", dealId: d2.id, clientId: smirnov, supplierId: foshan, carrierId: carrierCn,
      containerNo: "DEMU1000022", hsCode: "3918101000", weightKg: "19800", volumeM3: "34", ...rail, pickupLocation: "Foshan",
      exportLicense: "we_arrange", certificates: "yes", certificateHolder: "ИП Смирнов А.В.", chestnyZnak: "applied",
      milestones: demoMilestones(7, 1, { slip: 1 }),
      flags: { balance: day(-30), freight: day(-30), customs_payment: day(-5), customs_docs: day(-5) },
    }, userId);
    await doc(tx, userId, {
      type: "supplier_invoice", number: "PI-FN-2208", date: day(-70), counterpartyId: foshan, shipmentId: s2.id, currency: "CNY",
      paymentStatus: "paid", paidAt: day(-60), data: { incoterms: "FOB (Shenzhen, Китай)", paymentTerms: "100% до отгрузки" },
    }, [
      { name: "LVT flooring 4mm Oak", quantity: 2400, unit: "кв. м.", price: 6.8, hsCode: "3918101000" },
      { name: "PVC skirting 2.4m", quantity: 1200, unit: "шт.", price: 1.1, hsCode: "3916209000" },
    ]);
    await order(tx, userId, s2.id, { transport: 42000, broker: 25000, terminal: 85000, customs: 1240000, commission: 120000 }, "signed");
    await doc(tx, userId, { type: "contractor_invoice", number: "HSR-INV-0812", date: day(-55), counterpartyId: carrierCn, shipmentId: s2.id, currency: "CNY", amount: "42000", paymentStatus: "paid", paidAt: day(-50) });
    await doc(tx, userId, { type: "railway_bill", number: "СМГС 30458812", date: day(-45), counterpartyId: carrierCn, shipmentId: s2.id });
    await doc(tx, userId, { type: "contractor_invoice", number: "421", date: day(-12), counterpartyId: broker, shipmentId: s2.id, currency: "RUB", amount: "25000", paymentStatus: "paid", paidAt: day(-10), data: { costCategory: "broker" } });
    await doc(tx, userId, { type: "contractor_invoice", number: "С-1187", date: day(-11), counterpartyId: svh, shipmentId: s2.id, currency: "RUB", amount: "92400", paymentStatus: "unpaid" });
    await doc(tx, userId, { type: "contractor_invoice", number: "ТС-5521", date: day(-3), counterpartyId: carrierRu, shipmentId: s2.id, currency: "RUB", amount: "38000", paymentStatus: "partial", paidAmount: "19000", paidAt: day(-2), data: { costCategory: "transport" } });
    await doc(tx, userId, { type: "customs_declaration", number: "10013160/150926/3012345", date: day(-10), shipmentId: s2.id, currency: "RUB", amount: "1236480", paymentStatus: "paid", paidAt: day(-10) });
    await doc(tx, userId, { type: "conformity", number: "ЕАЭС N RU Д-CN.РА01.В.12345/26", date: day(-90), clientId: smirnov, shipmentId: s2.id, validUntil: day(640) }, [
      { name: "LVT flooring 4mm Oak", hsCode: "3918101000" },
    ]);
    await doc(tx, userId, { type: "client_invoice", number: "118", date: day(-9), counterpartyId: smirnov, shipmentId: s2.id, currency: "RUB", amount: "120000", paymentStatus: "unpaid" });

    // ── Сделка 3: LED, ТЭУ, производство ──────────────────────────────────
    const s3 = await createShipment(tx, {
      ...base, title: "LED-панели 600×600", scheme: "teu", dealId: d3.id, clientId: svetdom, supplierId: brightled, carrierId: carrierRu,
      hsCode: "9405110009", weightKg: "1800", volumeM3: "12", transport: "auto", pickupLocation: "Shenzhen", deliveryLocation: "Санкт-Петербург",
      exportLicense: "yes", certificates: "no", chestnyZnak: "not_required", milestones: demoMilestones(2, 12),
    }, userId);
    await doc(tx, userId, {
      type: "supplier_invoice", number: "BL-PI-7781", date: day(-8), counterpartyId: brightled, shipmentId: s3.id, currency: "USD",
      paymentStatus: "unpaid", data: { incoterms: "FCA (Shenzhen, Китай)", paymentTerms: "50% / 50%" },
    }, [
      { name: "LED panel 600x600 40W", quantity: 300, unit: "шт.", price: 12.5, hsCode: "9405110009" },
      { name: "LED driver 40W", quantity: 300, unit: "шт.", price: 2.1, hsCode: "8504409000" },
    ]);
    const [teu] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.type, "teu_contract"), eq(documents.counterpartyId, svetdom)));
    await doc(tx, userId, { type: "teu_request", date: day(-7), counterpartyId: svetdom, shipmentId: s3.id, parentId: teu.id, status: "draft" });
    await doc(tx, userId, { type: "client_invoice", number: "121", date: day(-4), counterpartyId: svetdom, shipmentId: s3.id, currency: "RUB", amount: "85000", paymentStatus: "unpaid" });

    // Брокер и СВХ — подрядчики сделки с LVT (перевозчики добавились сами).
    for (const id of [broker, svh]) await tx.insert(shipmentParties).values({ shipmentId: s2.id, counterpartyId: id }).onConflictDoNothing();

    // Доверенность, истекающая скоро, — для фильтра «Истекают».
    await doc(tx, userId, { type: "power_of_attorney", number: "Д-17", date: day(-355), validUntil: day(10), data: { issuedTo: "Водитель-экспедитор Петров П.П., получение груза" } });

    // Комментарии: в сделках — по исполнению, в воронке — по переговорам.
    for (const [shipmentId, body] of [
      [s1.id, "Поставщик подтвердил готовность к 20-му числу, ждём остаток оплаты от клиента."],
      [s1.id, "Сертификат оформляем на клиента, документы отправили в лабораторию."],
      [s2.id, "ДТ выпущена, груз на СВХ. Счёт СВХ передали клиенту."],
    ] as const) {
      await addShipmentEvent(tx, shipmentId, userId, "comment", null, null, body);
    }
    await tx.insert(dealComments).values({ dealId: d3.id, authorId: userId, body: "Клиент сравнивал авто и ж/д — выбрал авто, депозит оплачен." });
  });
  console.log("  + демо-документооборот: 3 сделки с документами, 3 лида, 10 контрагентов, договоры, инвойсы, поручения, счета, ДТ, сертификаты");
}

// ── База знаний ───────────────────────────────────────────────────────────

type Block = ["h2" | "p", string] | ["ul" | "ol", string[]];

function tiptap(blocks: Block[]) {
  const text = (t: string) => [{ type: "text", text: t }];
  return {
    type: "doc" as const,
    content: blocks.map(([kind, value]) => {
      if (kind === "h2") return { type: "heading", attrs: { level: 2 }, content: text(value) };
      if (kind === "p") return { type: "paragraph", content: text(value) };
      return {
        type: kind === "ul" ? "bulletList" : "orderedList",
        content: (value as string[]).map((li) => ({ type: "listItem", content: [{ type: "paragraph", content: text(li) }] })),
      };
    }),
  };
}

const KB_PAGES: { space: string; title: string; parent?: string; blocks: Block[] }[] = [
  {
    space: "SALES",
    title: "Как вести сделку в CRM: от инвойса до поручения",
    blocks: [
      ["p", "Короткая инструкция для менеджеров. Главное правило: сделку собирают документы — не заполняйте руками то, что есть в инвойсе."],
      ["h2", "Порядок"],
      ["ol", [
        "Пришёл инвойс поставщика — «Загрузить документ», тип «Инвойс поставщика», выберите клиента и «Новая сделка».",
        "Позиции вставьте из Excel через Ctrl+V и проверьте количество и цены.",
        "В сделке нажмите «Сформировать поручение», заполните смету, скачайте DOCX и отправьте клиенту.",
        "Подписанный скан загрузите в поручение — статус станет «Подписан».",
        "Счета перевозчиков, брокера и СВХ добавляйте в сделку по мере поступления и отмечайте оплаты.",
      ]],
      ["h2", "Что проверить перед поручением"],
      ["ul", ["Есть действующий договор комиссии с клиентом.", "У клиента заполнены реквизиты (ИНН, ОГРН, банк).", "В инвойсе верная валюта и Incoterms."]],
    ],
  },
  {
    space: "SALES",
    title: "Схемы работы: комиссия, поставка, ТЭУ",
    blocks: [
      ["h2", "Комиссия"],
      ["p", "Мы закупаем от своего имени за счёт клиента по нашему контракту с поставщиком. Документ на каждую закупку — поручение к договору комиссии."],
      ["h2", "Поставка"],
      ["p", "Мы покупаем товар и продаём клиенту по договору поставки; цена и состав — в спецификации."],
      ["h2", "ТЭУ"],
      ["p", "Клиент сам покупает у поставщика по своему контракту, мы организуем доставку и таможню. Документы — заявка и расчёт доставки."],
    ],
  },
  {
    space: "CUSTOMS",
    title: "Документы для таможенного оформления",
    blocks: [
      ["ul", ["Контракт и инвойс поставщика", "Упаковочный лист", "Транспортный документ: CMR, СМГС или коносамент", "Декларация соответствия / сертификат", "Документы о маркировке («Честный знак»), если нужно"]],
      ["p", "Код ТН ВЭД определяет пошлину, НДС, нужен ли сертификат и маркировка — уточняйте его до отгрузки."],
    ],
  },
  {
    space: "CUSTOMS",
    title: "Маркировка «Честный знак»",
    blocks: [
      ["p", "Коды DataMatrix должны быть на товаре до выпуска с таможни. Удобнее всего наносить их в Китае до отгрузки."],
      ["ul", ["Проверяем по коду ТН ВЭД, подлежит ли товар маркировке.", "Заказываем коды и передаём поставщику.", "В сделке ставим поле «Честный знак»: нужна → нанесена."]],
    ],
  },
  {
    space: "LOGISTICS",
    title: "Маршруты и сроки доставки",
    blocks: [
      ["ul", ["Авто — 15–25 дней до Москвы.", "Ж/д — 25–35 дней, выгодно для контейнеров и тяжёлых грузов.", "Авиа — 3–7 дней, для срочных и лёгких грузов, образцов.", "Море — 45–60 дней через Владивосток или Санкт-Петербург."]],
    ],
  },
  {
    space: "LOGISTICS",
    parent: "Маршруты и сроки доставки",
    title: "Образцы авиа: Гуанчжоу — Москва",
    blocks: [["p", "Образцы отправляем официально через «Аэрофлот» с таможенной декларацией по форме 064; забирают в аэропорту прилёта в Москве."]],
  },
  {
    space: "COMPANY",
    title: "Как мы работаем с документами",
    blocks: [
      ["ul", ["Все договоры, инвойсы и сканы — только в CRM, в карточке документа.", "Подписанный экземпляр загружаем как «Подписанный скан».", "Оплаты отмечаем в документе в день оплаты.", "Раз в неделю смотрим «Документы → Не оплачены» и «Истекают»."]],
    ],
  },
];

export async function seedDemoKb(): Promise<void> {
  const [exists] = await db.select({ id: kbPages.id }).from(kbPages).where(eq(kbPages.title, KB_PAGES[0].title)).limit(1);
  if (exists) {
    console.log("  = демо-страницы базы знаний уже есть");
    return;
  }
  const ids = new Map<string, number>();
  await db.transaction(async (tx) => {
    for (const [i, page] of KB_PAGES.entries()) {
      const [space] = await tx.select({ id: kbSpaces.id }).from(kbSpaces).where(eq(kbSpaces.key, page.space));
      if (!space) continue;
      const content = tiptap(page.blocks);
      const contentText = tiptapToText(content);
      const [row] = await tx
        .insert(kbPages)
        .values({ spaceId: space.id, parentId: page.parent ? (ids.get(page.parent) ?? null) : null, title: page.title, content, contentText, position: i })
        .returning({ id: kbPages.id });
      await tx.insert(kbPageVersions).values({ pageId: row.id, version: 1, title: page.title, content, contentText, note: "Создание (демо)" });
      ids.set(page.title, row.id);
    }
  });
  console.log(`  + демо-страницы базы знаний: ${ids.size}`);
}

// ── Сделки (отгрузки) для календаря ──────────────────────────────────────

/** Типичные интервалы между ключевыми датами, дней. */
const GAPS: Partial<Record<MilestoneKey, number>> = { deposit: 0, ready: 25, loading: 4, departure: 3, border: 8, arrival: 10, release: 4, delivery: 3 };

/**
 * Даты сделки на этапе stage: плановая дата текущей точки — через offset дней
 * от сегодня, остальные — по типичным интервалам; прошлые точки выполнены.
 */
function demoMilestones(stage: number, offset: number, opts: { slip?: number; noBorder?: boolean } = {}) {
  const keys = MILESTONES.map((m) => m.key).filter((k) => k in GAPS && !(opts.noBorder && k === "border"));
  const current = SHIPMENT_STAGES[stage - 1].milestone;
  const anchorIdx = current ? keys.indexOf(current) : keys.length;
  const plans: string[] = [];
  const base = day(offset);
  // Даты от якоря назад и вперёд (на последнем этапе якорь — доставка).
  let d = base;
  for (let i = Math.min(anchorIdx, keys.length - 1); i >= 0; i--) {
    plans[i] = d;
    d = addDays(d, -(GAPS[keys[i]] ?? 0));
  }
  d = plans[Math.min(anchorIdx, keys.length - 1)];
  for (let i = anchorIdx + 1; i < keys.length; i++) {
    d = addDays(d, GAPS[keys[i]] ?? 0);
    plans[i] = d;
  }
  const today = day(0);
  const result: Record<string, { plan: string; fact?: string }> = {};
  keys.forEach((k, i) => {
    const plan = plans[i];
    const before = i < anchorIdx;
    // Отметка «граница» на этапе «в пути» — выполнена, если дата прошла.
    const passedBorder = k === "border" && current === "arrival" && plan < today;
    result[k] = before || passedBorder ? { plan, fact: addDays(plan, opts.slip ?? 0) } : { plan };
  });
  return result;
}

export async function seedDemoShipments(): Promise<void> {
  const [exists] = await db.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.notes, MARK), eq(shipments.title, "Трава 40 мм оливковая"))).limit(1);
  if (exists) {
    console.log("  = демо-сделки (повторные заказы) уже есть");
    return;
  }
  const [admin] = await db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1);
  const userId = admin?.id ?? null;
  const byName = async (name: string) => (await db.select({ id: counterparties.id }).from(counterparties).where(eq(counterparties.name, name)).limit(1))[0]?.id ?? null;

  const greenland = await byName("ООО «ГринЛэнд»");
  const smirnov = await byName("ИП Смирнов А.В.");
  const svetdom = await byName("ООО «Светлый Дом»");
  const turf = await byName("SHIJIAZHUANG GREEN TURF CO., LTD.");
  const foshan = await byName("FOSHAN NANHAI FLOORING CO., LTD.");
  const brightled = await byName("SHENZHEN BRIGHTLED TECHNOLOGY CO., LTD.");
  const carrierCn = await byName("HEBEI SILK ROAD LOGISTICS CO., LTD.");
  if (!greenland || !carrierCn) {
    console.log("  ! нет демо-контрагентов — сделки календаря пропущены");
    return;
  }
  const rail = { transport: "rail", pickupLocation: "Китай", deliveryLocation: "Москва" };
  const all = { balance: day(-30), freight: day(-30), customs_payment: day(-5), customs_docs: day(-5) };
  // Повторные заказы — без воронки, сразу сделкой.
  const list: Record<string, unknown>[] = [
    { title: "Трава 40 мм оливковая", clientId: greenland, supplierId: turf, carrierId: carrierCn, containerNo: "DEMU1000033", hsCode: "5703300000", ...rail, milestones: demoMilestones(5, 9), flags: { balance: day(-25), freight: day(-24) } },
    { title: "Плинтус ПВХ белый", clientId: smirnov, supplierId: foshan, carrierId: carrierCn, containerNo: "DEMU1000044", hsCode: "3916209000", ...rail, milestones: demoMilestones(6, -1), flags: { balance: day(-30), freight: day(-30), customs_docs: day(-3) } },
    { title: "LED-драйверы 40 Вт", scheme: "teu", clientId: svetdom, supplierId: brightled, carrierId: carrierCn, containerNo: "DEMU1000055", transport: "sea", pickupLocation: "Шэньчжэнь", deliveryLocation: "Москва (через Владивосток)", milestones: demoMilestones(4, 4), flags: { balance: day(-8), freight: day(-8) } },
    { title: "Клей для травы", clientId: greenland, supplierId: turf, carrierId: carrierCn, containerNo: "DEMU1000066", ...rail, milestones: demoMilestones(5, 20), flags: { balance: day(-12), freight: day(-12) } },
    { title: "LVT 5 мм ёлочка", clientId: smirnov, supplierId: foshan, carrierId: carrierCn, hsCode: "3918101000", ...rail, milestones: demoMilestones(3, -2) },
    { title: "Трековые светильники", scheme: "teu", clientId: svetdom, supplierId: brightled, transport: "rail", milestones: demoMilestones(2, 30) },
    // Заказ сформирован, ждём депозит: инвойса и поручения ещё нет — видно, что сделать.
    { title: "Линолеум коричневый", clientId: smirnov, supplierId: foshan, carrierId: carrierCn, ...rail, milestones: demoMilestones(1, 3) },
    { title: "Трава 20 мм", clientId: greenland, supplierId: turf, carrierId: carrierCn, containerNo: "DEMU1000077", ...rail, milestones: demoMilestones(8, -1), flags: all },
    { title: "LVT 4 мм серый", clientId: smirnov, supplierId: foshan, carrierId: carrierCn, containerNo: "DEMU1000088", ...rail, milestones: demoMilestones(8, -40), flags: all, status: "closed" },
  ];
  await db.transaction(async (tx) => {
    for (const input of list) await createShipment(tx, { ...input, notes: MARK, assigneeId: userId }, userId);
  });
  console.log(`  + демо-сделки (повторные заказы): ${list.length}`);
}

export async function removeDemoExtras(): Promise<void> {
  const ships = await db.delete(shipments).where(eq(shipments.notes, MARK)).returning({ id: shipments.id });
  if (ships.length) console.log(`  − демо-сделок календаря: ${ships.length}`);
  const docs = await db.delete(documents).where(eq(documents.notes, MARK)).returning({ id: documents.id });
  const pages = await db
    .delete(kbPages)
    .where(and(inArray(kbPages.title, KB_PAGES.map((p) => p.title)), isNull(kbPages.createdBy)))
    .returning({ id: kbPages.id });
  const prods = await db
    .delete(products)
    .where(and(eq(products.notes, MARK), notExists(db.select({ id: documentItems.id }).from(documentItems).where(eq(documentItems.productId, products.id)))))
    .returning({ id: products.id });
  const cps = await db
    .delete(counterparties)
    .where(
      and(
        eq(counterparties.notes, MARK),
        notExists(db.select({ id: deals.id }).from(deals).where(eq(deals.clientId, counterparties.id))),
        notExists(
          db
            .select({ id: shipments.id })
            .from(shipments)
            .where(or(eq(shipments.clientId, counterparties.id), eq(shipments.supplierId, counterparties.id), eq(shipments.carrierId, counterparties.id))),
        ),
        notExists(db.select({ id: documents.id }).from(documents).where(or(eq(documents.counterpartyId, counterparties.id), eq(documents.clientId, counterparties.id)))),
      ),
    )
    .returning({ id: counterparties.id });
  console.log(`  − демо-документов: ${docs.length}, страниц: ${pages.length}, товаров: ${prods.length}, контрагентов: ${cps.length}`);
}
