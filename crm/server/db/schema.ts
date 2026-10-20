/**
 * Схема БД внутреннего раздела /crm/ (Drizzle ORM, PostgreSQL).
 *
 * Этап 1 — пользователи, сессии, журнал действий, база знаний, справочник для
 * звонков. Этап 2 (CRM) — таблицы созданы заранее, интерфейса к ним пока нет;
 * описание полей и процесса — в crm/README.md.
 *
 * После правки схемы: `npm run db:generate` (создаст SQL-миграцию в drizzle/),
 * затем `npm run db:migrate`.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { SpecParams } from "../../shared/cargo.ts";
import type { ShipmentCalc } from "../../shared/customs.ts";
import type { FactoryProfile } from "../../shared/factories.ts";
import type { FreightRate, QuoteParams, QuoteResult } from "../../shared/quote.ts";

/** Полнотекстовый индекс PostgreSQL. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── Пользователи и доступ ───────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["admin", "manager"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Логин хранится в нижнем регистре. */
  login: text("login").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  role: userRole("role").notNull().default("manager"),
  passwordHash: text("password_hash").notNull(),
  /** Отключённый сотрудник не может войти; его авторство в истории сохраняется. */
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 от токена из cookie: сам токен в БД не хранится. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/** Журнал действий: кто, когда, что создал, изменил или удалил. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** create | update | delete | move | restore | login | logout | … */
    action: text("action").notNull(),
    /** user | kb_space | kb_page | attachment | call_topic | call_script | deal | … */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** Человекочитаемое описание для журнала. */
    summary: text("summary").notNull(),
    data: jsonb("data"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_created_idx").on(t.createdAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);

// ── База знаний ─────────────────────────────────────────────────────────────

export const kbSpaces = pgTable("kb_spaces", {
  id: serial("id").primaryKey(),
  /** Короткий латинский ключ для адреса: /crm/kb/SALES. */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type TiptapDoc = { type: "doc"; content?: unknown[] };

export const kbPages = pgTable(
  "kb_pages",
  {
    id: serial("id").primaryKey(),
    spaceId: integer("space_id")
      .notNull()
      .references(() => kbSpaces.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): AnyPgColumn => kbPages.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    /** Документ TipTap (ProseMirror JSON). */
    content: jsonb("content").$type<TiptapDoc>().notNull(),
    /** Плоский текст документа — для поиска. */
    contentText: text("content_text").notNull().default(""),
    position: integer("position").notNull().default(0),
    /** Номер текущей версии; растёт на каждое сохранение. */
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('russian', coalesce("title", '')), 'A') || setweight(to_tsvector('russian', coalesce("content_text", '')), 'B')`,
    ),
  },
  (t) => [
    index("kb_pages_tree_idx").on(t.spaceId, t.parentId, t.position),
    index("kb_pages_search_idx").using("gin", t.search),
  ],
);

export const kbPageVersions = pgTable(
  "kb_page_versions",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => kbPages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<TiptapDoc>().notNull(),
    contentText: text("content_text").notNull().default(""),
    /** Пояснение: «Создание», «Откат к версии 3» и т.п. */
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique("kb_page_versions_page_version_uq").on(t.pageId, t.version)],
);

/**
 * Вложения-файлы. Общая таблица для страниц базы знаний (owner_type=kb_page)
 * и, на этапе 2, сделок (owner_type=deal). Сами файлы — на диске в
 * CRM_UPLOAD_DIR под именем storage_key.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: text("owner_type").notNull(),
    ownerId: integer("owner_id").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Метка файла документа: original — как прислали, signed — подписанный скан, generated — сформирован системой. */
    label: text("label"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_owner_idx").on(t.ownerType, t.ownerId)],
);

// ── Справочник для звонков ──────────────────────────────────────────────────

export type CallQa = { q: string; a: string };

/** Строка справочника: вопросы менеджера клиенту, тема и ответы на вопросы клиента. */
export const callScriptTopics = pgTable(
  "call_script_topics",
  {
    /** Строковый ID из kb-call-script.json (или сгенерированный при создании). */
    id: text("id").primaryKey(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    ask: jsonb("ask").$type<string[]>().notNull().default([]),
    qa: jsonb("qa").$type<CallQa[]>().notNull().default([]),
    /** Весь текст строки (вопросы, ответы) — для глобального поиска. */
    searchText: text("search_text").notNull().default(""),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('russian', coalesce("title", '')), 'A') || setweight(to_tsvector('russian', coalesce("search_text", '')), 'B')`,
    ),
  },
  (t) => [
    index("call_topics_position_idx").on(t.position),
    index("call_topics_search_idx").using("gin", t.search),
  ],
);

export type CallTopicSnapshot = {
  id: string;
  title: string;
  ask: string[];
  qa: CallQa[];
};

/** История версий справочника: снимок всего списка на каждое сохранение. */
export const callScriptVersions = pgTable("call_script_versions", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull().unique(),
  topics: jsonb("topics").$type<CallTopicSnapshot[]>().notNull(),
  note: text("note").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ── CRM ─────────────────────────────────────────────────────────────────────

/** Организационная форма: ООО, ИП, иностранная компания, прочее. */
export const companyKind = pgEnum("company_kind", ["ip", "ooo", "other", "foreign"]);
/** Роль контрагента: клиент, поставщик товара, подрядчик (перевозчик, брокер, СВХ…). */
export const counterpartyRole = pgEnum("counterparty_role", ["client", "supplier", "contractor"]);
export const messengerKind = pgEnum("messenger_kind", [
  "telegram",
  "whatsapp",
  "max",
  "wechat",
  "other",
]);
export const exportLicense = pgEnum("export_license", ["yes", "no", "we_arrange"]);
export const certificateStatus = pgEnum("certificate_status", ["yes", "no", "in_progress"]);
export const chestnyZnak = pgEnum("chestny_znak", ["not_required", "required", "applied"]);
export const dealPriority = pgEnum("deal_priority", ["low", "medium", "high", "urgent"]);
export const dealOutcome = pgEnum("deal_outcome", ["won", "lost"]);
export const dealScheme = pgEnum("deal_scheme", ["commission", "supply", "teu"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "partial", "paid"]);

/**
 * Контрагент: клиент, поставщик или подрядчик. Одна таблица — реквизиты,
 * контакты и документы у всех одинаковые; в интерфейсе это три раздела.
 */
export const counterparties = pgTable(
  "counterparties",
  {
    id: serial("id").primaryKey(),
    role: counterpartyRole("role").notNull().default("client"),
    /** Для подрядчиков: carrier_cn, carrier_ru, broker, warehouse, agent, other. */
    contractorType: text("contractor_type"),
    kind: companyKind("kind").notNull().default("ooo"),
    /** Краткое название, как в документах: «ИП Иванова И.И.», «QINGDAO GREAT WAY …». */
    name: text("name").notNull(),
    /** Полное наименование для договоров. */
    fullName: text("full_name"),
    country: text("country").notNull().default("RU"),
    inn: text("inn"),
    kpp: text("kpp"),
    /** ОГРН / ОГРНИП. */
    ogrn: text("ogrn"),
    /** Регистрационный номер иностранной компании (USCC в Китае). */
    regNumber: text("reg_number"),
    legalAddress: text("legal_address"),
    postalAddress: text("postal_address"),
    bankAccount: text("bank_account"),
    bankName: text("bank_name"),
    bankBik: text("bank_bik"),
    bankCorrAccount: text("bank_corr_account"),
    bankInn: text("bank_inn"),
    bankAddress: text("bank_address"),
    bankSwift: text("bank_swift"),
    /** Подписант: должность, ФИО, основание («Устава»). */
    signatoryTitle: text("signatory_title"),
    signatoryName: text("signatory_name"),
    signatoryBasis: text("signatory_basis"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("counterparties_inn_idx").on(t.inn), index("counterparties_role_idx").on(t.role, t.name)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    counterpartyId: integer("counterparty_id").references(() => counterparties.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    messenger: messengerKind("messenger"),
    messengerHandle: text("messenger_handle"),
    email: text("email"),
    position: text("position"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_counterparty_idx").on(t.counterpartyId), index("contacts_phone_idx").on(t.phone)],
);

/**
 * Этапы воронки — колонки канбан-доски. Таблицей, а не enum: админ меняет
 * названия, цвета и порядок в интерфейсе. Начальный набор — миграцией 0002.
 * Последний по порядку этап — завершающий (is_final): сделка в нём «успешна».
 */
export const dealStatuses = pgTable("deal_statuses", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  /** Цвет плашки этапа (#RRGGBB). */
  color: text("color").notNull().default("#94A3B8"),
  /** Завершающий этап: сделка в нём получает итог «успешно». */
  isFinal: boolean("is_final").notNull().default(false),
});

/** Сквозная нумерация сделок: ключ BARS-<number>. */
export const dealNumberSeq = pgSequence("deal_number_seq", { startWith: 1 });

export const deals = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    number: integer("number")
      .notNull()
      .unique()
      .default(sql`nextval('deal_number_seq')`),
    key: text("key").generatedAlwaysAs(sql`'BARS-' || ("number"::text)`),
    title: text("title").notNull(),
    clientId: integer("client_id").references(() => counterparties.id, { onDelete: "set null" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    statusKey: text("status_key")
      .notNull()
      .default("new_request")
      .references(() => dealStatuses.key),
    /** null — в работе; won — дошла до завершающего этапа; lost — отказ (на любом этапе). */
    outcome: dealOutcome("outcome"),
    lostReason: text("lost_reason"),
    /** Что хочет клиент (запрос / КП). Фактический груз — в сделке (shipments). */
    product: text("product"),
    assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    priority: dealPriority("priority").notNull().default("medium"),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    description: text("description").notNull().default(""),
    /** Порядок карточки внутри колонки доски. */
    boardPosition: doublePrecision("board_position").notNull().default(0),
    /** manual | site — откуда пришла сделка (позже: заявки с сайта). */
    source: text("source").notNull().default("manual"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("deals_board_idx").on(t.statusKey, t.boardPosition),
    index("deals_assignee_idx").on(t.assigneeId),
    index("deals_client_idx").on(t.clientId),
  ],
);

export const dealComments = pgTable(
  "deal_comments",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deal_comments_deal_idx").on(t.dealId, t.createdAt)],
);

/** Журнал изменений сделки (лента «Активность» в карточке). */
export const dealEvents = pgTable(
  "deal_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** created | field_changed | status_changed | comment_added | attachment_added | … */
    kind: text("kind").notNull(),
    field: text("field"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: createdAt(),
  },
  (t) => [index("deal_events_deal_idx").on(t.dealId, t.createdAt)],
);

/** Подрядчики сделки (перевозчики, брокер, СВХ…) — кроме клиента и поставщика. */

// ── Документы и товары ──────────────────────────────────────────────────────

/** Товар — справочник наименований из инвойсов. */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** Наименование по-русски (для поручений и ДТ), если в инвойсе по-английски. */
    nameRu: text("name_ru"),
    hsCode: text("hs_code"),
    unit: text("unit"),
    /** НДС при ввозе 10 % (льготный перечень) вместо 22 %. */
    vat10: boolean("vat10").notNull().default(false),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_name_idx").on(t.name)],
);

/**
 * База фабрик (shared/factories.ts): заводы из WeChat — сначала кандидаты (counterparty_id пуст), после договора
 * связываются с поставщиком. Кандидата видит админ и тот, кто нашёл (found_by).
 */
export const factories = pgTable(
  "factories",
  {
    id: serial("id").primaryKey(),
    /** Как в WeChat: «A-某某地板厂-小王». */
    name: text("name").notNull(),
    /** Коротко по-русски: «Демо-фабрика — SPC-ламинат». */
    nameRu: text("name_ru"),
    wechatId: text("wechat_id"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    /** Место производства: «Линьи, провинция Шаньдун». */
    location: text("location"),
    categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("new"),
    profile: jsonb("profile").$type<FactoryProfile>().notNull().default(sql`'{}'::jsonb`),
    notes: text("notes").notNull().default(""),
    foundBy: integer("found_by").references(() => users.id, { onDelete: "set null" }),
    counterpartyId: integer("counterparty_id").references(() => counterparties.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("factories_wechat_idx").on(t.wechatId),
    index("factories_found_by_idx").on(t.foundBy),
    uniqueIndex("factories_counterparty_idx").on(t.counterpartyId),
  ],
);

/** Цены фабрик на товары (из анкеты, прайса, переписки). */
export const productOffers = pgTable(
  "product_offers",
  {
    id: serial("id").primaryKey(),
    factoryId: integer("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    price: numeric("price", { precision: 16, scale: 4 }),
    currency: text("currency").notNull().default("CNY"),
    unit: text("unit"),
    moq: numeric("moq", { precision: 16, scale: 3 }),
    perContainer: numeric("per_container", { precision: 16, scale: 3 }),
    kgPerUnit: numeric("kg_per_unit", { precision: 16, scale: 4 }),
    m3PerUnit: numeric("m3_per_unit", { precision: 16, scale: 6 }),
    conditions: text("conditions").notNull().default(""),
    quotedAt: date("quoted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("product_offers_factory_idx").on(t.factoryId, t.position), index("product_offers_product_idx").on(t.productId)],
);

/** Ставки доставки от перевозчиков (shared/quote.ts → FreightRate): для расчёта цены товара для клиента. */
export const freightRates = pgTable("freight_rates", {
  id: serial("id").primaryKey(),
  carrierName: text("carrier_name").notNull().default(""),
  transport: text("transport").notNull().default("rail"),
  /** container — за контейнер; cbm — сборный груз за м³. */
  mode: text("mode").notNull().default("container"),
  container: text("container"),
  origin: text("origin").notNull().default(""),
  destination: text("destination").notNull().default(""),
  rate: numeric("rate", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  kgPerCbm: numeric("kg_per_cbm", { precision: 10, scale: 2 }),
  minCbm: numeric("min_cbm", { precision: 10, scale: 3 }),
  fee: numeric("fee", { precision: 16, scale: 2 }),
  feeCurrency: text("fee_currency").notNull().default("USD"),
  transitDays: integer("transit_days"),
  etd: text("etd").notNull().default(""),
  validUntil: date("valid_until"),
  quotedAt: date("quoted_at"),
  notes: text("notes").notNull().default(""),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Сохранённые расчёты цены товара для клиента (параметры и результат на момент расчёта). */
export const productQuotes = pgTable(
  "product_quotes",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    offerId: integer("offer_id").references(() => productOffers.id, { onDelete: "set null" }),
    clientName: text("client_name").notNull().default(""),
    params: jsonb("params").$type<QuoteParams>().notNull(),
    result: jsonb("result").$type<QuoteResult>().notNull(),
    freight: jsonb("freight").$type<FreightRate | null>(),
    ratesDate: date("rates_date"),
    rates: jsonb("rates").$type<Record<string, number>>().notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("product_quotes_product_idx").on(t.productId, t.createdAt)],
);

/**
 * Документ любого типа: договоры, поручения, инвойсы, накладные, ДТ,
 * сертификаты, доверенности… Типы и их поля — shared/documents.ts;
 * поля, нужные не всем типам, лежат в data (jsonb).
 */
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    number: text("number"),
    date: date("date"),
    /** Вторая сторона документа (клиент, поставщик или подрядчик). */
    counterpartyId: integer("counterparty_id").references(() => counterparties.id, { onDelete: "set null" }),
    /** Клиент, к которому относится документ (для документов поставщиков и подрядчиков). */
    clientId: integer("client_id").references(() => counterparties.id, { onDelete: "set null" }),
    /** Сделка (отгрузка), к которой относится документ. */
    shipmentId: integer("shipment_id").references((): AnyPgColumn => shipments.id, { onDelete: "set null" }),
    /** Договор, к которому относится документ: приложение, инвойс по контракту и т.п. */
    parentId: integer("parent_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    /** Порядковый номер внутри договора (поручение № 09 к договору комиссии). */
    seqNo: integer("seq_no"),
    currency: text("currency"),
    amount: numeric("amount", { precision: 16, scale: 2 }),
    /** draft | signed | cancelled — для договоров и приложений. */
    status: text("status"),
    paymentStatus: paymentStatus("payment_status"),
    paidAmount: numeric("paid_amount", { precision: 16, scale: 2 }),
    paidAt: date("paid_at"),
    validUntil: date("valid_until"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_type_idx").on(t.type, t.date),
    index("documents_counterparty_idx").on(t.counterpartyId),
    index("documents_client_idx").on(t.clientId),
    index("documents_shipment_idx").on(t.shipmentId),
    index("documents_parent_idx").on(t.parentId),
    index("documents_valid_idx").on(t.validUntil),
  ],
);

/** Строки документа: позиции инвойса, товары поручения, спецификации. */
export const documentItems = pgTable(
  "document_items",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Наименование, как в документе. */
    name: text("name").notNull(),
    /** «Партийный номер» в поручении: 1, 2, 3… */
    batchNo: text("batch_no"),
    hsCode: text("hs_code"),
    quantity: numeric("quantity", { precision: 16, scale: 3 }),
    unit: text("unit"),
    price: numeric("price", { precision: 16, scale: 4 }),
    amount: numeric("amount", { precision: 16, scale: 2 }),
  },
  (t) => [
    index("document_items_doc_idx").on(t.documentId, t.position),
    index("document_items_product_idx").on(t.productId),
  ],
);

/** Настройки: реквизиты своей компании, счета. Ключ → JSON. */
/** Справочник ТН ВЭД ЕАЭС со ставками ввозных пошлин (обновляется командой tnved:update). */
export const tnved = pgTable("tnved", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** Ставка как в ЕТТ: «6.5%, но не менее 0.096 EUR за 1 кг». */
  tariff: text("tariff").notNull().default(""),
  updatedAt: updatedAt(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

// ── Сделки (отгрузки) и календарь ───────────────────────────────────────────
// Сделка начинается с оплаты депозита и независима от воронки продаж: связь с
// лидом из воронки необязательна (повторный заказ в воронку не попадает).

export const shipmentNumberSeq = pgSequence("shipment_number_seq", { startWith: 1 });

export const shipments = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    number: integer("number")
      .notNull()
      .unique()
      .default(sql`nextval('shipment_number_seq')`),
    /** active — в работе; closed — закрыта вручную; cancelled — отменена. */
    status: text("status").notNull().default("active"),
    /** 1–8, вычисляется из фактических дат (shared/shipments.ts → stageOf). */
    stage: integer("stage").notNull().default(1),
    clientId: integer("client_id").references(() => counterparties.id, { onDelete: "set null" }),
    supplierId: integer("supplier_id").references(() => counterparties.id, { onDelete: "set null" }),
    carrierId: integer("carrier_id").references(() => counterparties.id, { onDelete: "set null" }),
    carrierInvoiceId: integer("carrier_invoice_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    /** Лид из воронки продаж, из которого пришла сделка (необязательно). */
    dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
    /** Название груза — как вы его называете: «Линолеум коричневый». */
    title: text("title").notNull().default(""),
    scheme: dealScheme("scheme").notNull().default("commission"),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Договор с клиентом (комиссии / поставки / ТЭУ) и контракт с поставщиком. */
    clientContractId: integer("client_contract_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    supplierContractId: integer("supplier_contract_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    containerNo: text("container_no"),
    hsCode: text("hs_code"),
    weightKg: numeric("weight_kg", { precision: 14, scale: 3 }),
    volumeM3: numeric("volume_m3", { precision: 14, scale: 3 }),
    transport: text("transport"),
    pickupLocation: text("pickup_location"),
    deliveryLocation: text("delivery_location"),
    exportLicense: exportLicense("export_license"),
    certificates: certificateStatus("certificates"),
    certificateHolder: text("certificate_holder"),
    chestnyZnak: chestnyZnak("chestny_znak"),
    /** Отмеченные флажки ожиданий: ключ → дата отметки. */
    flags: jsonb("flags").$type<Record<string, string>>().notNull().default({}),
    /** Расчёт для клиента: смета КП / поручения и таможенные платежи (shared/customs.ts). */
    calc: jsonb("calc").$type<ShipmentCalc>(),
    /** Параметры спецификации для перевозчика: получатель, станция… (shared/cargo.ts). */
    spec: jsonb("spec").$type<SpecParams>(),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("shipments_status_idx").on(t.status, t.stage),
    index("shipments_client_idx").on(t.clientId),
    index("shipments_carrier_idx").on(t.carrierId),
  ],
);

/** Подрядчики сделки: перевозчики, брокер, СВХ… */
export const shipmentParties = pgTable(
  "shipment_parties",
  {
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    counterpartyId: integer("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.counterpartyId] })],
);

/** Ключевые даты сделки: план и факт. */
export const shipmentMilestones = pgTable(
  "shipment_milestones",
  {
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    plan: date("plan"),
    fact: date("fact"),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.key] }), index("shipment_milestones_plan_idx").on(t.plan)],
);

/** История сделки: переносы дат, этапы, флажки, правки полей. */
export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** created | field | plan | fact | flag | status | comment */
    kind: text("kind").notNull(),
    field: text("field"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: createdAt(),
  },
  (t) => [index("shipment_events_idx").on(t.shipmentId, t.createdAt)],
);

/**
 * Оплата на несколько счетов (lib/payments.ts): одна платёжка, разнесённая на инвойсы / счета — в том числе
 * частично и на инвойс другой сделки (оплаченный остаток, уехавший следующим контейнером). Обычная оплата одного
 * счёта сюда не пишется — это статус оплаты самого документа. Не разнесённое — на сделке, с пометкой (note).
 */
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    counterpartyId: integer("counterparty_id").references(() => counterparties.id, { onDelete: "set null" }),
    number: text("number"),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_shipment_idx").on(t.shipmentId)],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  },
  (t) => [index("payment_allocations_payment_idx").on(t.paymentId), index("payment_allocations_document_idx").on(t.documentId)],
);

