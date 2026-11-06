/**
 * Письмо продавцу: выбор шаблона (категория → «все категории» с маркировкой / без), варианты {a|b}, подстановки,
 * персональная ссылка https://<домен ящика>/wb/<slug>?l=<токен>, запрет tlkbars.ru, Message-ID на домене ящика.
 */

import crypto from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { shortProduct } from "../../../shared/leadgen.ts";
import { DEFAULT_MAIL_SETTINGS, fillVars, hash32, MAIN_DOMAIN_ERROR, type MailSettings, mentionsMainDomain, namePatronymic, normalizeMailSettings, spin } from "../../../shared/mail.ts";
import type { DbOrTx } from "../../db/client.ts";
import { leadCategories, leadSellers, mailDomains, mailboxes, mailTemplates, settings as settingsTable } from "../../db/schema.ts";
import { HttpError } from "../http.ts";

export const MAIL_SETTINGS_KEY = "mail";
export const MAIL_STATE_KEY = "mail_state";

export async function getMailSettings(tx: DbOrTx): Promise<MailSettings> {
  const [row] = await tx.select().from(settingsTable).where(eq(settingsTable.key, MAIL_SETTINGS_KEY));
  return row ? normalizeMailSettings(row.value) : { ...DEFAULT_MAIL_SETTINGS };
}

export async function setMailSettings(tx: DbOrTx, value: unknown, userId: number | null): Promise<MailSettings> {
  const next = normalizeMailSettings(value);
  await tx
    .insert(settingsTable)
    .values({ key: MAIL_SETTINGS_KEY, value: next, updatedBy: userId })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: next, updatedBy: userId, updatedAt: new Date() } });
  return next;
}

export async function getMailState<T extends Record<string, unknown>>(tx: DbOrTx): Promise<T> {
  const [row] = await tx.select().from(settingsTable).where(eq(settingsTable.key, MAIL_STATE_KEY));
  return ((row?.value as T) ?? {}) as T;
}

export async function patchMailState(tx: DbOrTx, patch: Record<string, unknown>): Promise<void> {
  const value = { ...(await getMailState(tx)), ...patch };
  await tx.insert(settingsTable).values({ key: MAIL_STATE_KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

type Seller = typeof leadSellers.$inferSelect;
type Category = typeof leadCategories.$inferSelect;
type Template = typeof mailTemplates.$inferSelect;
export type MailboxFull = typeof mailboxes.$inferSelect & { domain: typeof mailDomains.$inferSelect };

const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newLinkToken(): string {
  return [...crypto.randomBytes(10)].map((b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
}

/** Токен персональной ссылки продавца: есть — тот же, нет — новый случайный (10 символов, уникальный). */
export async function ensureLinkToken(tx: DbOrTx, seller: Pick<Seller, "inn" | "linkToken">): Promise<string> {
  if (seller.linkToken) return seller.linkToken;
  for (let i = 0; i < 5; i++) {
    const token = newLinkToken();
    try {
      const [row] = await tx.update(leadSellers).set({ linkToken: token }).where(and(eq(leadSellers.inn, seller.inn))).returning({ t: leadSellers.linkToken });
      if (row) return token;
    } catch {
      /* совпал с чужим — ещё раз */
    }
  }
  throw new HttpError(500, "Не удалось выдать токен ссылки");
}

export const landingLink = (base: string, slug: string, token: string) => `${base.trim().replace(/\/*$/, "/")}${encodeURIComponent(slug || "")}?l=${token}`;

/** Message-ID на домене ящика (сохраняется — по нему цепочка и сопоставление ответов). */
export const newMessageId = (domain: string) => `<${Date.now().toString(36)}.${crypto.randomBytes(9).toString("hex")}@${domain}>`;

/** Шаблон для продавца: сначала шаблоны его категории, иначе «все категории» (с маркировкой / без / любые). Несколько — по ИНН. */
export function chooseTemplate(templates: Template[], category: Pick<Category, "id" | "marking"> | null, touch: "first" | "followup", inn: string): Template | null {
  const active = templates.filter((t) => t.active && t.touch === touch);
  const own = category ? active.filter((t) => t.categoryId === category.id) : [];
  const common = active.filter((t) => t.categoryId === null && (t.forMarking === null || t.forMarking === (category?.marking ?? false)));
  const pool = own.length ? own : common;
  if (!pool.length) return null;
  pool.sort((a, b) => a.id - b.id);
  return pool[hash32(`${inn}:${touch}`) % pool.length];
}

export type Rendered = { subject: string; body: string; variants: { subject: number[]; body: number[] }; template: Template };

/** Проверка: шаблон, подпись, ссылка — без tlkbars.ru. */
export function assertNoMainDomain(...parts: (string | null | undefined)[]): void {
  if (parts.some((p) => mentionsMainDomain(p))) throw new HttpError(400, MAIN_DOMAIN_ERROR);
}

export function renderWith(template: Template, ctx: { seller: Seller; category: Category | null; mailbox: MailboxFull; token: string; firstSubject?: string }): Rendered {
  const { seller, category, mailbox } = ctx;
  const brand = seller.brands[0] ?? "";
  const seed = `${seller.inn}:${template.touch}`;
  const subj = spin(template.subject, `${seed}:s`);
  const body = spin(template.body, `${seed}:b`);
  const vars = {
    name_patronymic: namePatronymic(seller.managerName),
    brand: brand || "вашим брендом",
    product: shortProduct(seller.products[0]?.name ?? "", brand) || "товары",
    category: category?.mailName || category?.name.toLowerCase() || "товаров",
    marking_note: category?.mailNote ?? "",
    link: landingLink(mailbox.domain.landingBaseUrl, category?.slug ?? "", ctx.token),
    signature: mailbox.signature,
    first_subject: ctx.firstSubject ?? "",
  };
  const subject = fillVars(subj.text, vars).replace(/\s+/g, " ");
  const text = fillVars(body.text, vars);
  assertNoMainDomain(subject, text, mailbox.signature, vars.link);
  return { subject, body: text, variants: { subject: subj.choices, body: body.choices }, template };
}

export async function loadMailbox(tx: DbOrTx, id: number): Promise<MailboxFull> {
  const [row] = await tx.select().from(mailboxes).innerJoin(mailDomains, eq(mailDomains.id, mailboxes.domainId)).where(eq(mailboxes.id, id));
  if (!row) throw new HttpError(404, "Ящик не найден");
  return { ...row.mailboxes, domain: row.mail_domains };
}

/** Письмо продавцу целиком (для плана, предпросмотра и теста цепочки). */
export async function renderForSeller(tx: DbOrTx, inn: string, mailbox: MailboxFull, touch: "first" | "followup", opts: { templateId?: number; firstSubject?: string } = {}): Promise<Rendered> {
  const [seller] = await tx.select().from(leadSellers).where(eq(leadSellers.inn, inn));
  if (!seller) throw new HttpError(404, "Продавец не найден");
  const [category] = seller.categoryId ? await tx.select().from(leadCategories).where(eq(leadCategories.id, seller.categoryId)) : [];
  const templates = await tx.select().from(mailTemplates).orderBy(asc(mailTemplates.id));
  const template = opts.templateId ? templates.find((t) => t.id === opts.templateId) : chooseTemplate(templates, category ?? null, touch, inn);
  if (!template) throw new HttpError(400, `Нет активного шаблона «${touch === "first" ? "первое письмо" : "повтор"}» для категории ${category?.name ?? "—"}`);
  const token = await ensureLinkToken(tx, seller);
  let firstSubject = opts.firstSubject;
  if (touch === "followup" && !firstSubject) {
    // Первое ушло не рассылкой (вручную) — тема первого по шаблону, как если бы его отправили.
    const first = chooseTemplate(templates, category ?? null, "first", inn);
    firstSubject = first ? renderWith(first, { seller, category: category ?? null, mailbox, token }).subject : "";
  }
  return renderWith(template, { seller, category: category ?? null, mailbox, token, firstSubject });
}
