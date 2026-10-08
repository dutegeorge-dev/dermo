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
  uuid,
} from "drizzle-orm/pg-core";

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
export const dealRoute = pgEnum("deal_route", ["auto", "rail", "air", "sea", "multimodal"]);
export const contractParty = pgEnum("contract_party", ["ours", "client"]);
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
    /** Схема работы с клиентом: комиссия, поставка, ТЭУ. */
    scheme: dealScheme("scheme").notNull().default("commission"),
    clientId: integer("client_id").references(() => counterparties.id, { onDelete: "set null" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    supplierId: integer("supplier_id").references(() => counterparties.id, { onDelete: "set null" }),
    /** Договор с клиентом (комиссии / поставки / ТЭУ) и контракт с поставщиком. */
    clientContractId: integer("client_contract_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    supplierContractId: integer("supplier_contract_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),
    statusKey: text("status_key")
      .notNull()
      .default("new_request")
      .references(() => dealStatuses.key),
    /** null — в работе; won — дошла до завершающего этапа; lost — отказ (на любом этапе). */
    outcome: dealOutcome("outcome"),
    lostReason: text("lost_reason"),
    product: text("product"),
    hsCode: text("hs_code"),
    weightKg: numeric("weight_kg", { precision: 14, scale: 3 }),
    volumeM3: numeric("volume_m3", { precision: 14, scale: 3 }),
    pickupLocation: text("pickup_location"),
    deliveryLocation: text("delivery_location"),
    goodsReadyDate: date("goods_ready_date"),
    route: dealRoute("route"),
    contractParty: contractParty("contract_party"),
    exportLicense: exportLicense("export_license"),
    certificates: certificateStatus("certificates"),
    certificateHolder: text("certificate_holder"),
    chestnyZnak: chestnyZnak("chestny_znak"),
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
export const dealParties = pgTable(
  "deal_parties",
  {
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    counterpartyId: integer("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.counterpartyId] })],
);

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
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_name_idx").on(t.name)],
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
    dealId: integer("deal_id").references((): AnyPgColumn => deals.id, { onDelete: "set null" }),
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
    index("documents_deal_idx").on(t.dealId),
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
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});
