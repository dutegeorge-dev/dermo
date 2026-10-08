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

// ── Этап 2: CRM (схема заложена, интерфейса пока нет) ───────────────────────

export const companyKind = pgEnum("company_kind", ["ip", "ooo", "other"]);
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

/** Клиент — компания (ИП/ООО). */
export const clients = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    kind: companyKind("kind").notNull().default("ooo"),
    name: text("name").notNull(),
    inn: text("inn"),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_inn_idx").on(t.inn)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
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
  (t) => [index("contacts_client_idx").on(t.clientId), index("contacts_phone_idx").on(t.phone)],
);

/**
 * Статусы сделки — колонки канбан-доски. Таблицей, а не enum: порядок и
 * названия можно менять без миграции типов. Заполняется миграцией.
 */
export const dealStatuses = pgTable("deal_statuses", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  /** Финальный статус («Закрыто»): у сделки должен быть указан итог. */
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
    clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    statusKey: text("status_key")
      .notNull()
      .default("new_lead")
      .references(() => dealStatuses.key),
    outcome: dealOutcome("outcome"),
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
    description: jsonb("description").$type<TiptapDoc>(),
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
