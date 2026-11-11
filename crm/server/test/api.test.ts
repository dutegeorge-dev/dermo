/**
 * Интеграционные тесты API на живой PostgreSQL.
 *
 *   CRM_TEST_DATABASE_URL=postgres://crm:crm@127.0.0.1/crm_test npm test
 *
 * База ОЧИЩАЕТСЯ перед прогоном — никогда не указывайте боевую.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const testUrl = process.env.CRM_TEST_DATABASE_URL;
if (!testUrl) {
  console.log("CRM_TEST_DATABASE_URL не задан — тесты API пропущены");
  process.exit(0);
}
process.env.DATABASE_URL = testUrl;
process.env.CRM_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "crm-test-"));
process.env.CRM_COOKIE_SECURE = "false";
process.env.CRM_TRUST_PROXY = "false";
// Тесты никогда не ходят в настоящий ИИ (crm/.env может содержать ключ).
process.env.ANTHROPIC_API_KEY = "";
process.env.ANTHROPIC_AUTH_TOKEN = "";
process.env.CRM_RATES_FIXED = JSON.stringify({ USD: 80, EUR: 90, CNY: 11 });
process.env.CRM_INTAKE_TOKEN = "test-intake-token-0123456789abcdef";
// Лидогенерация: ключи-заглушки (в тестах источники вымышленные, в сеть ничего не уходит).
process.env.DADATA_TOKEN = "test-dadata-token";
process.env.CHECKO_API_KEY = "";
process.env.WB_PROXY = "";
// Рассылка: ключ шифрования паролей ящиков (тестовый).
process.env.MAILBOX_SECRET_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { config, CRM_ROOT } = await import("../config.ts");
const { db, pool } = await import("../db/client.ts");
const { users } = await import("../db/schema.ts");
const { hashPassword } = await import("../lib/password.ts");
const { buildApp } = await import("../app.ts");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { sql } = await import("drizzle-orm");

const app = await buildApp();
const API = "/crm/api";

type Session = { cookie: string; csrf: string };

/** ip — для поздних блоков: лимит попыток входа считается по IP. */
async function login(loginName: string, password: string, ip?: string): Promise<Session> {
  const res = await app.inject({ method: "POST", url: `${API}/auth/login`, payload: { login: loginName, password }, remoteAddress: ip });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === config.session.cookieName);
  assert.ok(cookie, "cookie выставлена");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(cookie.path, "/crm");
  return { cookie: `${cookie.name}=${cookie.value}`, csrf: res.json().csrfToken };
}

// Один вход админа на поздние блоки — иначе упрёмся в лимит попыток входа с одного IP.
let adminSessionCache: Session | null = null;
const adminSession = async () => (adminSessionCache ??= await login("admin", "adminpass1"));

function call(s: Session, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url: `${API}${url}`,
    headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

before(async () => {
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await migrate(db, { migrationsFolder: path.join(CRM_ROOT, "drizzle") });
  await db.insert(users).values({ login: "admin", name: "Админ", role: "admin", passwordHash: await hashPassword("adminpass1") });
});

after(async () => {
  await app.close();
  await pool.end();
});

describe("доступ", () => {
  test("API без сессии — 401, служебные заголовки на месте", async () => {
    for (const url of ["/auth/me", "/kb/spaces", "/calls", "/search?q=x", "/users"]) {
      const res = await app.inject({ method: "GET", url: `${API}${url}` });
      assert.equal(res.statusCode, 401, url);
      assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
    }
    const health = await app.inject({ method: "GET", url: `${API}/health` });
    assert.equal(health.statusCode, 200);
  });

  test("неверный пароль — 401, затем лимит попыток", async () => {
    for (let i = 0; i < config.loginLimit.perLogin; i++) {
      const res = await app.inject({ method: "POST", url: `${API}/auth/login`, payload: { login: "nobody", password: "wrongpass" } });
      assert.equal(res.statusCode, 401);
    }
    const blocked = await app.inject({ method: "POST", url: `${API}/auth/login`, payload: { login: "nobody", password: "wrongpass" } });
    assert.equal(blocked.statusCode, 429);
  });

  test("CSRF: без токена и с чужого Origin изменяющие запросы отклоняются", async () => {
    const s = await login("admin", "adminpass1");
    const noToken = await app.inject({
      method: "POST",
      url: `${API}/kb/spaces`,
      headers: { cookie: s.cookie },
      payload: { key: "X1", name: "x" },
    });
    assert.equal(noToken.statusCode, 403);
    const evil = await app.inject({
      method: "POST",
      url: `${API}/kb/spaces`,
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, origin: "https://evil.example" },
      payload: { key: "X1", name: "x" },
    });
    assert.equal(evil.statusCode, 403);
  });

  test("админ заводит менеджера, менеджер входит и не видит пользователей", async () => {
    const admin = await login("admin", "adminpass1");
    const created = await call(admin, "POST", "/users", { login: "Ivan", name: "Иван", role: "manager", password: "managerpass" });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().user.login, "ivan");

    const manager = await login("ivan", "managerpass");
    const me = await call(manager, "GET", "/auth/me");
    assert.equal(me.json().user.role, "manager");
    assert.equal((await call(manager, "GET", "/users")).statusCode, 403);
    assert.equal((await call(manager, "GET", "/audit")).statusCode, 403);

    // Отключение выкидывает из сессии.
    const id = created.json().user.id;
    assert.equal((await call(admin, "PATCH", `/users/${id}`, { isActive: false })).statusCode, 200);
    assert.equal((await call(manager, "GET", "/auth/me")).statusCode, 401);
    await call(admin, "PATCH", `/users/${id}`, { isActive: true });
  });
});

describe("база знаний", () => {
  test("пространство, вложенные страницы, правка, поиск, откат, перенос", async () => {
    const s = await login("ivan", "managerpass");
    const space = (await call(s, "POST", "/kb/spaces", { key: "customs", name: "Таможня" })).json().space;
    assert.equal(space.key, "CUSTOMS");

    const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const root = (await call(s, "POST", "/kb/pages", { spaceId: space.id, title: "Оформление", content: doc("Общие правила") })).json().page;
    const child = (await call(s, "POST", "/kb/pages", { spaceId: space.id, parentId: root.id, title: "Сертификаты", content: doc("Декларация соответствия") })).json().page;
    const grandchild = (await call(s, "POST", "/kb/pages", { spaceId: space.id, parentId: child.id, title: "ЕАЭС" })).json().page;

    const view = (await call(s, "GET", `/kb/pages/${grandchild.id}`)).json();
    assert.deepEqual(view.breadcrumbs.map((b: { title: string }) => b.title), ["Оформление", "Сертификаты"]);

    // Правка с версией и конфликт по устаревшей версии.
    const saved = await call(s, "PUT", `/kb/pages/${child.id}`, { title: "Сертификаты", content: doc("Таможенные пошлины и сертификаты"), baseVersion: 1 });
    assert.equal(saved.json().page.version, 2);
    const stale = await call(s, "PUT", `/kb/pages/${child.id}`, { title: "X", content: doc("y"), baseVersion: 1 });
    assert.equal(stale.statusCode, 409);

    // Поиск с морфологией: «пошлина» находит «пошлины».
    const found = (await call(s, "GET", `/search?q=${encodeURIComponent("пошлина")}`)).json();
    assert.equal(found.pages[0]?.id, child.id);
    assert.match(found.pages[0].snippet, /<mark>/);

    // Откат к версии 1.
    const restored = await call(s, "POST", `/kb/pages/${child.id}/versions/1/restore`);
    assert.equal(restored.json().page.version, 3);
    const after = (await call(s, "GET", `/kb/pages/${child.id}`)).json().page;
    assert.equal(after.content.content[0].content[0].text, "Декларация соответствия");
    const versions = (await call(s, "GET", `/kb/pages/${child.id}/versions`)).json().versions;
    assert.deepEqual(versions.map((v: { version: number }) => v.version), [3, 2, 1]);

    // Нельзя вложить страницу в собственного потомка.
    assert.equal((await call(s, "POST", `/kb/pages/${root.id}/move`, { parentId: grandchild.id, index: 0 })).statusCode, 400);
    // Перенос в корень перед «Оформлением».
    assert.equal((await call(s, "POST", `/kb/pages/${grandchild.id}/move`, { parentId: null, index: 0 })).statusCode, 200);
    const tree = (await call(s, "GET", "/kb/spaces/CUSTOMS")).json().pages;
    const roots = tree.filter((p: { parentId: number | null }) => p.parentId === null).map((p: { title: string }) => p.title);
    assert.deepEqual(roots, ["ЕАЭС", "Оформление"]);

    // Вложение: загрузка, выдача только с сессией, удаление вместе со страницей.
    const boundary = "----crmtest";
    const payload =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="прайс.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const upload = await app.inject({
      method: "POST",
      url: `${API}/kb/pages/${root.id}/attachments`,
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const fileId = upload.json().attachment.id;
    const file = await call(s, "GET", `/files/${fileId}`);
    assert.equal(file.body, "hello");
    assert.match(String(file.headers["content-disposition"]), /^attachment;/);
    assert.equal((await app.inject({ method: "GET", url: `${API}/files/${fileId}` })).statusCode, 401);

    assert.equal((await call(s, "DELETE", `/kb/pages/${root.id}`)).statusCode, 200);
    assert.equal((await call(s, "GET", `/kb/pages/${child.id}`)).statusCode, 404);
    assert.equal((await call(s, "GET", `/files/${fileId}`)).statusCode, 404);
  });
});

describe("справочник для звонков", () => {
  test("добавление, правка, порядок, удаление, история и откат", async () => {
    const s = await login("ivan", "managerpass");
    const a = (await call(s, "POST", "/calls/topics", { topic: { title: "Товар", ask: ["Что везёте?"], qa: [{ q: "Цена?", a: "— пункт\n— пункт" }] } })).json();
    const b = (await call(s, "POST", "/calls/topics", { topic: { title: "Сроки", ask: [], qa: [] } })).json();
    assert.equal(b.version, a.version + 1);

    let list = (await call(s, "GET", "/calls")).json();
    assert.deepEqual(list.topics.map((t: { title: string }) => t.title), ["Товар", "Сроки"]);
    // Ответ хранится ровно как набран.
    assert.equal(list.topics[0].qa[0].a, "— пункт\n— пункт");

    const base = list.topics[0].updatedAt;
    const edit = await call(s, "PUT", `/calls/topics/${a.id}`, { topic: { title: "Товар", ask: ["Что везёте?", "Какой объём?"], qa: [] }, baseUpdatedAt: base });
    assert.equal(edit.statusCode, 200, edit.body);
    const stale = await call(s, "PUT", `/calls/topics/${a.id}`, { topic: { title: "Y", ask: [], qa: [] }, baseUpdatedAt: base });
    assert.equal(stale.statusCode, 409);

    assert.equal((await call(s, "POST", "/calls/reorder", { ids: [b.id, a.id] })).statusCode, 200);
    list = (await call(s, "GET", "/calls")).json();
    assert.deepEqual(list.topics.map((t: { title: string }) => t.title), ["Сроки", "Товар"]);
    assert.equal((await call(s, "POST", "/calls/reorder", { ids: [a.id] })).statusCode, 409);

    assert.equal((await call(s, "DELETE", `/calls/topics/${b.id}`)).statusCode, 200);
    const versions = (await call(s, "GET", "/calls/versions")).json().versions;
    assert.equal(versions.length, 5);

    // Откат к версии, где было две строки и исходный порядок.
    const restore = await call(s, "POST", `/calls/versions/${b.version}/restore`);
    assert.equal(restore.statusCode, 200);
    list = (await call(s, "GET", "/calls")).json();
    assert.deepEqual(list.topics.map((t: { title: string }) => t.title), ["Товар", "Сроки"]);
    assert.deepEqual(list.topics[0].ask, ["Что везёте?"]);

    const found = (await call(s, "GET", `/search?q=${encodeURIComponent("сроки")}`)).json();
    assert.equal(found.callTopics[0]?.id, b.id);
  });

  test("журнал действий фиксирует изменения", async () => {
    const admin = await login("admin", "adminpass1");
    const log = (await call(admin, "GET", "/audit?limit=200")).json().entries as { summary: string }[];
    assert.ok(log.some((e) => e.summary.includes("Откатил справочник")));
    assert.ok(log.some((e) => e.summary.includes("Создал пространство «Таможня»")));
  });
});

describe("CRM: сделки", () => {
  test("этапы воронки из миграции", async () => {
    const s = await login("ivan", "managerpass");
    const stages = (await call(s, "GET", "/stages")).json().stages as { key: string; name: string; isFinal: boolean }[];
    assert.deepEqual(stages.map((x) => x.name), [
      "Новая заявка",
      "Поиск товара",
      "Расчёт доставки предварительный",
      "Предложение клиенту",
      "Заказ у поставщика",
      "Расчёт доставки",
      "Согласование доставки",
      "Доставка / информирование клиента",
      "Завершено",
    ]);
    assert.deepEqual(stages.filter((x) => x.isFinal).map((x) => x.key), ["done"]);
  });

  test("создание, правка с журналом, перенос, отказ, комментарии, поиск", async () => {
    const s = await login("ivan", "managerpass");
    const created = await call(s, "POST", "/deals", {
      title: "Ламинат 2 фуры",
      product: "Ламинат LVT",
      newClient: { name: "ООО Пол-Маркет", kind: "ooo", inn: "7701234567" },
      newContact: { name: "Сергей", phone: "+7 900 123-45-67", messenger: "telegram" },
    });
    assert.equal(created.statusCode, 200, created.body);
    const key = created.json().deal.key as string;
    assert.match(key, /^BARS-\d+$/);

    let deal = (await call(s, "GET", `/deals/${key}`)).json();
    assert.equal(deal.deal.statusKey, "new_request");
    assert.equal(deal.deal.clientName, "ООО Пол-Маркет");
    assert.equal(deal.deal.contactPhone, "+7 900 123-45-67");
    assert.equal(deal.deal.assigneeName, "Иван", "исполнитель по умолчанию — автор");

    const patch = await call(s, "PATCH", `/deals/${key}`, { product: "Ламинат LVT 5 мм", priority: "high", labels: ["срочно", "срочно", " LVT "] });
    assert.deepEqual(patch.json().changed.sort(), ["labels", "priority", "product"]);
    assert.equal((await call(s, "PATCH", `/deals/${key}`, { priority: "boat" })).statusCode, 400);
    // Поля груза и поставщика — не в воронке, а в сделке: игнорируются.
    assert.deepEqual((await call(s, "PATCH", `/deals/${key}`, { weightKg: 100, supplierId: 1 })).json().changed, []);

    // Перенос на завершающий этап → успешно; обратно → снова в работе.
    assert.equal((await call(s, "POST", `/deals/${key}/move`, { statusKey: "done" })).statusCode, 200);
    deal = (await call(s, "GET", `/deals/${key}`)).json();
    assert.equal(deal.deal.outcome, "won");
    await call(s, "POST", `/deals/${key}/move`, { statusKey: "offer" });
    deal = (await call(s, "GET", `/deals/${key}`)).json();
    assert.equal(deal.deal.outcome, null);
    assert.equal((await call(s, "PATCH", `/deals/${key}`, { product: "Ламинат LVT 5 мм" })).json().changed.length, 0);
    assert.deepEqual(deal.deal.labels, ["срочно", "LVT"]);

    const kinds = (deal.events as { kind: string; field: string | null; newValue: unknown }[]).map((e) => e.kind);
    assert.ok(kinds.includes("created") && kinds.includes("status_changed") && kinds.includes("field_changed"));
    const prio = deal.events.find((e: { field: string | null }) => e.field === "priority");
    assert.equal(prio.newValue, "Высокий");

    // Порядок в колонке: вторая сделка встаёт перед первой.
    const second = (await call(s, "POST", "/deals", { title: "Мониторы", statusKey: "offer" })).json().deal.key;
    await call(s, "POST", `/deals/${second}/move`, { statusKey: "offer", beforeKey: key });
    const board = (await call(s, "GET", "/deals?view=board")).json().deals as { key: string; statusKey: string }[];
    assert.deepEqual(board.filter((d) => d.statusKey === "offer").map((d) => d.key), [second, key]);

    // Отказ убирает с доски, возврат — возвращает.
    await call(s, "POST", `/deals/${second}/lose`, { reason: "Дорого" });
    let onBoard = (await call(s, "GET", "/deals?view=board")).json().deals.map((d: { key: string }) => d.key);
    assert.ok(!onBoard.includes(second));
    assert.equal((await call(s, "GET", "/deals?outcome=lost")).json().deals[0].lostReason, "Дорого");
    await call(s, "POST", `/deals/${second}/reopen`);
    onBoard = (await call(s, "GET", "/deals?view=board")).json().deals.map((d: { key: string }) => d.key);
    assert.ok(onBoard.includes(second));

    const comment = await call(s, "POST", `/deals/${key}/comments`, { body: "Клиент ждёт расчёт до пятницы" });
    assert.equal(comment.statusCode, 200);
    assert.equal((await call(s, "GET", `/deals/${key}`)).json().comments.length, 1);

    // Поиск по телефону контакта и по ключу.
    const byPhone = (await call(s, "GET", `/search?q=${encodeURIComponent("123-45")}`)).json();
    assert.equal(byPhone.deals[0]?.key, key);
    const byKey = (await call(s, "GET", `/deals?q=${key.toLowerCase()}`)).json().deals;
    assert.equal(byKey.length, 1);

    // Удалять сделки может только admin.
    assert.equal((await call(s, "DELETE", `/deals/${second}`)).statusCode, 403);
  });

  test("редактор этапов: переименование, новый этап, удаление занятого запрещено", async () => {
    const admin = await login("admin", "adminpass1");
    const manager = await login("ivan", "managerpass");
    const stages = (await call(admin, "GET", "/stages")).json().stages as { key: string; name: string; color: string }[];
    assert.equal((await call(manager, "PUT", "/stages", { stages })).statusCode, 403);

    const withoutOffer = stages.filter((x) => x.key !== "offer");
    const busy = await call(admin, "PUT", "/stages", { stages: withoutOffer });
    assert.equal(busy.statusCode, 409);
    assert.match(busy.json().error, /Предложение клиенту/);

    const next = [
      ...stages.slice(0, -1).map((x) => (x.key === "new_request" ? { ...x, name: "Новая заявка с сайта" } : x)),
      { name: "Оплата", color: "#43A047" },
      stages[stages.length - 1],
    ];
    assert.equal((await call(admin, "PUT", "/stages", { stages: next })).statusCode, 200);
    const after = (await call(admin, "GET", "/stages")).json().stages as { name: string; isFinal: boolean }[];
    assert.equal(after[0].name, "Новая заявка с сайта");
    assert.equal(after[after.length - 2].name, "Оплата");
    assert.ok(after[after.length - 1].isFinal);
  });

  test("клиенты: карточка с контактами и сделками, ИНН проверяется", async () => {
    const s = await login("ivan", "managerpass");
    assert.equal((await call(s, "POST", "/counterparties", { role: "client", name: "ИП Петров", kind: "ip", inn: "123" })).statusCode, 400);
    const list = (await call(s, "GET", `/counterparties?role=client&q=${encodeURIComponent("пол-маркет")}`)).json().counterparties;
    assert.equal(list.length, 1);
    const card = (await call(s, "GET", `/counterparties/${list[0].id}`)).json();
    assert.equal(card.contacts[0].name, "Сергей");
    assert.equal(card.deals.length, 1);
    assert.equal((await call(s, "POST", `/counterparties/${list[0].id}/contacts`, { name: "Анна", email: "a@b.ru" })).statusCode, 200);
    assert.equal((await call(s, "GET", "/counterparties?role=supplier&q=" + encodeURIComponent("пол-маркет"))).json().counterparties.length, 0);
  });
});

describe("Документы: договор → инвойс → сделка (отгрузка) → поручение", () => {
  test("полная цепочка, план/факт, оплаты, товары, связи", async () => {
    const s = await login("ivan", "managerpass");
    const admin = await login("admin", "adminpass1");

    // Реквизиты своей компании (обычно — npm run crm:seed).
    const company = await call(admin, "PUT", "/settings/company", {
      name: "ООО ТЛК БАРС",
      legalAddress: "143408, Московская область, г. Красногорск",
      ogrn: "1255000095778",
      inn: "5024256988",
      kpp: "502401001",
      city: "г. Красногорск",
      signatoryShort: "Фотин Е.П.",
      accounts: [{ id: "cny", label: "Юани", currency: "CNY", account: "40702156924840000310", bankName: "ВТБ", bik: "044525411", corrAccount: "30101810145250000411", bankInn: "7702070139", bankAddress: "Москва" }],
      orderAccountId: "cny",
    });
    assert.equal(company.statusCode, 200, company.body);
    assert.equal((await call(s, "PUT", "/settings/company", { name: "x" })).statusCode, 403);

    const client = (await call(s, "POST", "/counterparties", {
      role: "client", kind: "ip", name: "ИП Иванова И.И.", inn: "771234567890", ogrn: "321770000000001",
      bankAccount: "40802810000000000001", bankName: "АО «Тест-Банк»", bankBik: "044525000", signatoryName: "Иванова Ирина Игоревна",
    })).json().counterparty;
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "QINGDAO GREAT WAY INTERNATIONAL COMMERCE CO.,LTD.", country: "CN" })).json().counterparty;
    assert.equal(supplier.kind, "foreign");
    const carrier = (await call(s, "POST", "/counterparties", { role: "contractor", contractorType: "carrier_cn", name: "Китайский перевозчик" })).json().counterparty;

    // Договор комиссии с клиентом и контракт с поставщиком.
    const commission = (await call(s, "POST", "/documents", { type: "commission_contract", number: "01", date: "2026-03-09", counterpartyId: client.id, validUntil: "2099-12-31" })).json().document;
    const contract = (await call(s, "POST", "/documents", { type: "supplier_contract", number: "QGW-09-26", date: "2026-09-10", counterpartyId: supplier.id, currency: "CNY", validUntil: "2027-12-31" })).json().document;
    // Нельзя привязать инвойс к договору комиссии.
    assert.equal((await call(s, "POST", "/documents", { type: "supplier_invoice", parentId: commission.id, counterpartyId: supplier.id })).statusCode, 400);

    // Инвойс поставщика → новая сделка с клиентом.
    const inv = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "PI-031", date: "2026-10-01", counterpartyId: supplier.id, currency: "CNY",
      data: { incoterms: "EXW (Shijiazhuang, Китай)", paymentTerms: "30% депозит 70% до отгрузки" },
      items: [
        { name: "Artificial grass", quantity: "14 600", unit: "кв. м.", price: "9,49" },
        { name: "Glue", quantity: 10, unit: "шт.", price: 50, amount: 500 },
      ],
      newShipment: { clientId: client.id, title: "Трава зелёная 30 мм", weightKg: 9000, volumeM3: 60 },
    });
    assert.equal(inv.statusCode, 200, inv.body);
    const no = inv.json().shipment.number as number;
    const invoiceId = inv.json().document.id as number;

    let deal = (await call(s, "GET", `/shipments/${no}`)).json();
    assert.equal(deal.shipment.title, "Трава зелёная 30 мм");
    assert.equal(deal.shipment.stage, 1, "сделка из инвойса ждёт депозит — поручение выпускаем до оплаты");
    assert.equal(deal.shipment.clientId, client.id);
    assert.equal(deal.shipment.supplierId, supplier.id, "поставщик подставился из инвойса");
    assert.equal(deal.shipment.clientContractId, commission.id, "договор комиссии подобран сам");
    assert.equal(deal.shipment.supplierContractId, contract.id, "контракт поставщика подобран сам");
    const invoice = (await call(s, "GET", `/documents/${invoiceId}`)).json();
    assert.equal(invoice.document.parentId, contract.id, "инвойс привязан к контракту");
    assert.equal(invoice.document.amount, 139054, "сумма = сумма позиций");
    assert.equal(invoice.document.paymentStatus, "unpaid");
    assert.equal(invoice.items[0].productName, "Artificial grass", "товар создан в справочнике");

    // Поручение: № 01 по договору комиссии, товары из инвойса, смета.
    const order = await call(s, "POST", `/shipments/${no}/order`);
    assert.equal(order.statusCode, 200, order.body);
    assert.equal(order.json().document.number, "01");
    assert.equal((await call(s, "POST", `/shipments/${no}/order`)).statusCode, 409, "одна сделка — одно поручение");
    const orderId = order.json().document.id as number;
    const orderDoc = (await call(s, "GET", `/documents/${orderId}`)).json();
    assert.deepEqual(orderDoc.items.map((i: { batchNo: string }) => i.batchNo), ["1", "2"]);
    assert.equal(orderDoc.document.parentId, commission.id);
    const costs = orderDoc.document.data.costs as { category: string; amount: number | null }[];
    assert.equal(costs[0].amount, 139054);
    costs.find((c) => c.category === "transport")!.amount = 60050;
    costs.find((c) => c.category === "broker")!.amount = 20000;
    assert.equal((await call(s, "PATCH", `/documents/${orderId}`, { data: { ...orderDoc.document.data, costs } })).statusCode, 200);

    // DOCX по шаблону.
    const docx = await app.inject({ method: "GET", url: `${API}/documents/${orderId}/docx`, headers: { cookie: s.cookie } });
    assert.equal(docx.statusCode, 200, docx.body);
    assert.equal(docx.rawPayload.subarray(0, 2).toString(), "PK");

    // Счёт перевозчика и ДТ → факт; оплаты.
    const carrierInv = (await call(s, "POST", "/documents", { type: "contractor_invoice", number: "TR-1", counterpartyId: carrier.id, shipmentId: deal.shipment.id, currency: "CNY", amount: 61000 })).json().document;
    await call(s, "POST", "/documents", { type: "customs_declaration", number: "10013160/011026/0000001", shipmentId: deal.shipment.id, currency: "RUB", amount: 900000 });
    // Сертификат на товар без привязки к сделке — всё равно виден в ней по товару.
    await call(s, "POST", "/documents", { type: "conformity", number: "ЕАЭС RU Д-CN.1", clientId: client.id, validUntil: "2028-01-01", items: [{ name: "artificial grass" }] });
    await call(s, "PATCH", `/documents/${invoiceId}`, { paymentStatus: "partial", paidAmount: 41716.2 });
    await call(s, "PATCH", `/documents/${carrierInv.id}`, { paymentStatus: "paid" });

    deal = (await call(s, "GET", `/shipments/${no}`)).json();
    assert.ok(deal.parties.some((p: { id: number }) => p.id === carrier.id), "перевозчик попал в участники сделки");
    assert.equal(deal.shipment.carrierId, carrier.id, "перевозчик сделки — из счёта");
    assert.equal(deal.shipment.carrierInvoiceId, carrierInv.id, "инвойс перевозчика — из счёта");
    assert.deepEqual(deal.items.map((i: { name: string }) => i.name), ["Artificial grass", "Glue"]);
    assert.equal(deal.certificates.length, 1);
    assert.equal(deal.certificates[0].number, "ЕАЭС RU Д-CN.1");
    const rows = Object.fromEntries((deal.finance.rows as { category: string; plan: unknown; fact: { amount: number; paid: number }[] }[]).map((r) => [r.category, r]));
    assert.deepEqual(rows.transport.plan, { amount: 60050, currency: "CNY" });
    assert.deepEqual(rows.transport.fact, [{ currency: "CNY", amount: 61000, paid: 61000 }]);
    assert.deepEqual(rows.goods.fact, [{ currency: "CNY", amount: 139054, paid: 41716.2 }]);
    assert.equal(rows.customs.fact[0].amount, 900000);
    assert.equal((deal.documents as unknown[]).length, 6, "инвойс, поручение, счёт, ДТ + договор комиссии и контракт");

    // Связи: карточка поставщика — товары и цены, клиенты; карточка клиента — поставщики.
    const supCard = (await call(s, "GET", `/counterparties/${supplier.id}`)).json();
    assert.equal(supCard.products[0].price, 9.49);
    assert.ok(supCard.related.some((r: { id: number }) => r.id === client.id));
    const supRow = (await call(s, "GET", "/counterparties?role=supplier")).json().counterparties.find((c: { id: number }) => c.id === supplier.id);
    assert.equal(supRow.dealCount, 1);
    assert.equal(supRow.documentCount, 2, "контракт и инвойс");
    const clientCard = (await call(s, "GET", `/counterparties/${client.id}`)).json();
    assert.ok(clientCard.related.some((r: { id: number }) => r.id === supplier.id));
    assert.ok(clientCard.documents.some((d: { type: string }) => d.type === "commission_contract"));

    // Товар: история цен у поставщика и поручения клиента.
    const prodRes = await call(s, "GET", `/products?q=grass`);
    assert.equal(prodRes.statusCode, 200, prodRes.body);
    const grass = prodRes.json().products[0];
    assert.equal(grass.lastPrice, 9.49);
    const prodCard = (await call(s, "GET", `/products/${grass.id}`)).json();
    assert.equal(prodCard.purchases[0].counterpartyName, supplier.name);
    assert.equal(prodCard.sales[0].clientName, client.name);

    // Реестр: долги и истекающие.
    const debts = (await call(s, "GET", "/documents?payment=debt")).json().documents.map((d: { id: number }) => d.id);
    assert.ok(debts.includes(invoiceId) && !debts.includes(carrierInv.id));
    await call(s, "POST", "/documents", { type: "power_of_attorney", number: "Д-1", validUntil: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
    const expiring = (await call(s, "GET", "/documents?expiring=30")).json().documents;
    assert.equal(expiring[0].type, "power_of_attorney");

    // Подписанный скан → статус «подписан».
    const boundary = "----crmdoc";
    const up = await app.inject({
      method: "POST",
      url: `${API}/documents/${orderId}/files?label=signed`,
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scan.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--${boundary}--\r\n`,
    });
    assert.equal(up.statusCode, 200, up.body);
    assert.equal((await call(s, "GET", `/documents/${orderId}`)).json().document.status, "signed");
  });
});

describe("Сделки (отгрузки) и календарь", () => {
  test("этап по фактам, контейнер обязателен к погрузке, сдвиг дат, флажки, закрытие", async () => {
    const s = await login("admin", "adminpass1");
    const mk = async (role: string, name: string, extra: object = {}) =>
      (await call(s, "POST", "/counterparties", { role, name, ...extra })).json().counterparty as { id: number };
    const client = await mk("client", "ООО «Тест-Отгрузка»");
    const carrier = await mk("contractor", "Перевозчик Тест", { contractorType: "carrier_cn" });
    const supplier = await mk("supplier", "Test Supplier Co");

    // Перевозчик на месте клиента — ошибка.
    const noCargo = await call(s, "POST", "/shipments", { title: "X", clientId: client.id });
    assert.equal(noCargo.statusCode, 400, "без веса и объёма сделку не создать");
    assert.match(noCargo.json().error, /вес/);
    const wrong = await call(s, "POST", "/shipments", { title: "X", clientId: carrier.id, weightKg: 1, volumeM3: 1 });
    assert.equal(wrong.statusCode, 400, wrong.body);
    assert.equal((await call(s, "POST", "/shipments", { clientId: client.id, weightKg: 1, volumeM3: 1 })).statusCode, 400, "без названия груза нельзя");

    const created = await call(s, "POST", "/shipments", {
      clientId: client.id,
      supplierId: supplier.id,
      carrierId: carrier.id,
      title: "Линолеум коричневый",
      transport: "rail",
      weightKg: 12000,
      volumeM3: 55,
      milestones: { deposit: { plan: "2026-10-03" }, ready: { plan: "2026-10-10" }, loading: { plan: "2026-10-14" }, departure: { plan: "2026-10-16" }, arrival: { plan: "2026-11-01" } },
    });
    assert.equal(created.statusCode, 200, created.body);
    const sh = created.json().shipment;
    assert.equal(sh.stage, 1, "заказ сформирован — ждём депозит");
    assert.equal(sh.title, "Линолеум коричневый");
    assert.equal(sh.label, `№ ${sh.number}`);
    assert.equal(sh.nextDate, "2026-10-03");

    // Депозит оплачен → производство.
    let res = await call(s, "PUT", `/shipments/${sh.number}/milestones/deposit`, { fact: "2026-10-02" });
    assert.equal(res.json().shipment.stage, 2);
    assert.equal(res.json().shipment.nextDate, "2026-10-10");

    // Производство окончено → готов к отгрузке, флажки остатка и фрахта ждут.
    res = await call(s, "PUT", `/shipments/${sh.number}/milestones/ready`, { fact: "2026-10-11" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().shipment.stage, 3);
    assert.deepEqual(res.json().shipment.pendingFlags, ["balance", "freight"]);

    // Погрузку без контейнера не отметить.
    res = await call(s, "PUT", `/shipments/${sh.number}/milestones/loading`, { fact: "2026-10-15" });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /контейнер/);

    // Перенос погрузки на 3 дня со сдвигом следующих.
    res = await call(s, "PUT", `/shipments/${sh.number}/milestones/loading`, { plan: "2026-10-17", shift: true });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().shifted, 2);
    assert.equal(res.json().shipment.milestones.departure.plan, "2026-10-19");
    assert.equal(res.json().shipment.milestones.arrival.plan, "2026-11-04");
    assert.equal(res.json().shipment.milestones.ready.plan, "2026-10-10", "прошлые не двигаются");

    await call(s, "PATCH", `/shipments/${sh.number}`, { containerNo: "tgbu 1234567" });
    res = await call(s, "PUT", `/shipments/${sh.number}/milestones/loading`, { fact: "2026-10-17" });
    assert.equal(res.json().shipment.stage, 4);
    assert.equal(res.json().shipment.containerNo, "TGBU1234567");
    res = await call(s, "PATCH", `/shipments/${sh.number}`, { containerNo: "" });
    assert.equal(res.statusCode, 400, "после погрузки контейнер не стереть");

    // Флажок фрахта.
    res = await call(s, "PUT", `/shipments/${sh.number}/flags/freight`, { done: true });
    assert.deepEqual(res.json().shipment.pendingFlags, ["balance"]);

    // Календарь: остаток поставщику висит на дате погрузки; фрахт — выполнен.
    const cal = (await call(s, "GET", "/calendar")).json().events as { id: string; date: string | null; done: boolean }[];
    const balance = cal.find((e) => e.id === `${sh.number}:f:balance`)!;
    assert.equal(balance.date, "2026-10-17");
    assert.equal(balance.done, false);
    assert.equal(cal.find((e) => e.id === `${sh.number}:f:freight`)!.done, true);
    assert.equal(cal.find((e) => e.id === `${sh.number}:m:departure`)!.date, "2026-10-19");

    // Поиск по контейнеру и номеру.
    const found = (await call(s, "GET", "/search?q=TGBU12")).json().shipments;
    assert.equal(found[0].number, sh.number);
    assert.equal((await call(s, "GET", "/shipments?q=линолеум")).json().shipments.length, 1);
    assert.equal((await call(s, "GET", `/shipments?q=${sh.number}`)).json().shipments[0].number, sh.number);

    // Карточка с историей; закрытие вручную убирает из календаря.
    const card = (await call(s, "GET", `/shipments/${sh.number}`)).json();
    assert.ok(card.events.some((e: { kind: string; field: string }) => e.kind === "plan" && e.field === "arrival"));
    assert.ok(card.events.some((e: { kind: string }) => e.kind === "stage"));
    // Доска: перенос на этап 6 ставит факты пройденных ключевых дат, обратно на 5 — снимает.
    res = await call(s, "POST", `/shipments/${sh.number}/stage`, { stage: 6 });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().shipment.stage, 6);
    assert.ok(res.json().shipment.milestones.arrival.fact);
    res = await call(s, "POST", `/shipments/${sh.number}/stage`, { stage: 5 });
    assert.equal(res.json().shipment.stage, 5);
    assert.equal(res.json().shipment.milestones.arrival.fact, null);

    // Поля груза правятся в сделке, с историей.
    res = await call(s, "PATCH", `/shipments/${sh.number}`, { hsCode: "5904100000", weightKg: "18 500", certificates: "in_progress" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().shipment.weightKg, 18500);
    assert.equal((await call(s, "PATCH", `/shipments/${sh.number}`, { certificates: "maybe" })).statusCode, 400);

    await call(s, "POST", `/shipments/${sh.number}/status`, { status: "closed" });
    const ours = (list: { shipment?: { number: number }; number?: number }[]) => list.filter((e) => (e.shipment?.number ?? e.number) === sh.number);
    assert.equal(ours((await call(s, "GET", "/calendar")).json().events).length, 0);
    assert.equal(ours((await call(s, "GET", "/shipments")).json().shipments).length, 0);
    assert.equal(ours((await call(s, "GET", "/shipments?status=closed")).json().shipments).length, 1);
  });
  test("своё название документа: «Претензия» вместо «Прочее» — в карточке, журнале и поиске", async () => {
    const s = await adminSession();
    const res = await call(s, "POST", "/documents", { type: "other", title: "Претензия", number: "1", date: "2026-08-26" });
    assert.equal(res.statusCode, 200, res.body);
    const id = res.json().document.id as number;
    assert.equal((await call(s, "GET", `/documents/${id}`)).json().document.title, "Претензия");
    assert.ok((await call(s, "GET", "/search?q=претензия")).json().documents.some((d: { id: number }) => d.id === id));
    assert.equal((await call(s, "PATCH", `/documents/${id}`, { title: "Претензия поставщику" })).statusCode, 200);
    assert.equal((await call(s, "GET", `/documents/${id}`)).json().document.title, "Претензия поставщику");
    assert.equal((await call(s, "PATCH", `/documents/${id}`, { title: "" })).statusCode, 200);
    assert.equal((await call(s, "GET", `/documents/${id}`)).json().document.title, null, "пусто — снова по типу");
    assert.equal((await call(s, "DELETE", `/documents/${id}`)).statusCode, 200);
  });

  test("свои события календаря: встреча, поездка, оплата — создать, изменить, выполнено, удалить", async () => {
    const s = await adminSession();
    // Ошибки ввода.
    assert.equal((await call(s, "POST", "/calendar/events", { type: "meeting", title: "", date: "2026-11-10" })).statusCode, 400);
    assert.equal((await call(s, "POST", "/calendar/events", { type: "meeting", title: "Встреча", date: "2026-11-10", time: "25:00" })).statusCode, 400);
    assert.equal((await call(s, "POST", "/calendar/events", { type: "trip", title: "Поездка", date: "2026-11-10", endDate: "2026-11-01" })).statusCode, 400);

    let res = await call(s, "POST", "/calendar/events", { type: "meeting", title: "Встреча с демо-клиентом", date: "2026-11-10", time: "14:30", notes: "образцы" });
    assert.equal(res.statusCode, 200, res.body);
    const meeting = res.json().event;
    assert.deepEqual([meeting.type, meeting.time, meeting.done], ["meeting", "14:30", false]);
    res = await call(s, "POST", "/calendar/events", { type: "payment", title: "Оплатить счёт СВХ", date: "2026-11-12", amount: "15 000,50", currency: "RUB" });
    const payment = res.json().event;
    assert.equal(payment.amount, 15000.5);
    res = await call(s, "POST", "/calendar/events", { type: "trip", title: "Поездка на демо-фабрику", date: "2026-11-15", endDate: "2026-11-20" });
    assert.equal(res.json().event.endDate, "2026-11-20");

    const cal = (await call(s, "GET", "/calendar")).json().events as { id: string; kind: string; payment: boolean; custom?: { id: number } }[];
    const mine = cal.filter((e) => e.kind === "custom");
    assert.ok(mine.some((e) => e.id === `c:${meeting.id}`));
    assert.equal(mine.find((e) => e.custom?.id === payment.id)?.payment, true, "оплата — в «Только оплаты»");

    res = await call(s, "PATCH", `/calendar/events/${meeting.id}`, { time: "15:00", done: true });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual([res.json().event.time, res.json().event.done], ["15:00", true]);

    // Чужое событие менеджер не удаляет; автор / админ — да.
    const ivan = await login("ivan", "managerpass", "10.0.0.51");
    assert.equal((await call(ivan, "DELETE", `/calendar/events/${payment.id}`)).statusCode, 404);
    assert.equal((await call(s, "DELETE", `/calendar/events/${payment.id}`)).statusCode, 200);
    assert.ok(!((await call(s, "GET", "/calendar")).json().events as { id: string }[]).some((e) => e.id === `c:${payment.id}`));
  });
});

describe("ИИ: разбор документов и чат", () => {
  test("без ключа ИИ выключен", async () => {
    const s = await adminSession();
    assert.deepEqual((await call(s, "GET", "/ai/status")).json(), { enabled: false });
    assert.equal((await call(s, "POST", "/ai/chat", { messages: [{ role: "user", content: "привет" }] })).statusCode, 503);
  });

  test("черновик сверяется с базой кодом: контрагент, договор, сделка, дубли", async () => {
    const { resolveDraft } = await import("../lib/ai-parse.ts");
    const s = await adminSession();
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Turf Factory Co., Ltd" })).json().counterparty;
    const carrier = (await call(s, "POST", "/counterparties", { role: "contractor", contractorType: "carrier_cn", name: "DEMO RAIL LOGISTICS LIMITED" })).json().counterparty;
    const contract = (await call(s, "POST", "/documents", { type: "supplier_contract", counterpartyId: supplier.id, number: "DTF-07/26" })).json().document;
    const sh = (await call(s, "POST", "/shipments", { title: "Трава демо", supplierId: supplier.id, weightKg: 5000, volumeM3: 40 })).json().shipment;
    const sh2 = (await call(s, "POST", "/shipments", { title: "Плитка демо", carrierId: carrier.id, weightKg: 5000, volumeM3: 40 })).json().shipment;
    await call(s, "PATCH", `/shipments/${sh2.number}`, { containerNo: "DEMU1000099" });

    const base = {
      docType: "supplier_invoice",
      number: " PI-DEMO-1 ",
      date: "2026-13-45",
      currency: "CNY",
      amount: 1000,
      counterparty: { name: "DEMO TURF FACTORY CO.,LTD.", fullName: null, inn: null, regNumber: null, country: "Китай", address: null },
      contractorType: null,
      clientName: null,
      contractNumber: "DTF 07-26",
      relatedNumbers: [],
      cargoTitle: "Трава",
      containerNo: null,
      weightKg: null,
      incoterms: "EXW",
      paymentTerms: null,
      validUntil: null,
      costCategory: "nonsense",
      items: [
        { name: "Grass 20mm", hsCode: "5703 30", quantity: 100, unit: "м²", price: 10, amount: 1000 },
        { name: "  ", hsCode: null, quantity: null, unit: null, price: null, amount: null },
      ],
      summary: "Инвойс",
    };
    const d = await resolveDraft(db, base);
    assert.equal(d.type, "supplier_invoice");
    assert.equal(d.number, "PI-DEMO-1");
    assert.equal(d.date, null, "кривая дата отброшена");
    assert.deepEqual(d.counterparty, { id: supplier.id, name: "Demo Turf Factory Co., Ltd" }, "найден по названию без «Co., Ltd» и знаков");
    assert.equal(d.parentId, contract.id, "договор найден по номеру без учёта пробелов и знаков");
    assert.equal(d.shipment?.number, sh.number, "сделка — по договору");
    assert.equal(d.costCategory, null);
    assert.equal(d.items.length, 1);
    assert.equal(d.items[0].hsCode, "570330");

    // Счёт перевозчика: контейнер важнее всего; название — частичное совпадение.
    const bill = await resolveDraft(db, {
      ...base,
      docType: "contractor_invoice",
      number: "DN-1",
      contractNumber: null,
      counterparty: { ...base.counterparty, name: "Demo Rail Logistics" },
      containerNo: "demu 100009-9",
      items: base.items,
    });
    assert.deepEqual(bill.counterparty, { id: carrier.id, name: "DEMO RAIL LOGISTICS LIMITED" });
    assert.equal(bill.containerNo, "DEMU1000099");
    assert.equal(bill.shipment?.number, sh2.number);
    assert.match(bill.shipmentReason ?? "", /контейнер/);
    assert.equal(bill.items.length, 0, "у счёта подрядчика позиций нет");

    // Новый контрагент — с реквизитами из документа; сделки нет.
    const unknown = await resolveDraft(db, {
      ...base,
      docType: "contractor_invoice",
      contractNumber: null,
      counterparty: { ...base.counterparty, name: "Совсем Новый Экспедитор" },
      contractorType: "carrier_cn",
    });
    assert.deepEqual(unknown.counterparty, { id: null, name: "Совсем Новый Экспедитор" });
    assert.deepEqual(unknown.newCounterparty, { country: "Китай", kind: "foreign", contractorType: "carrier_cn" });
    assert.equal(unknown.shipment, null);
    assert.equal((await resolveDraft(db, { ...base, docType: "bogus" })).type, "other");

    // Повторная загрузка того же инвойса — предупреждение.
    await call(s, "POST", "/documents", { type: "supplier_invoice", counterpartyId: supplier.id, number: "PI-DEMO-1", shipmentId: sh.id });
    const again = await resolveDraft(db, { ...base, number: "PI DEMO 1" });
    assert.match(again.warnings[0] ?? "", /уже есть/);
  });

  test("инструменты чата читают API от имени пользователя", async () => {
    const { runTool } = await import("../lib/ai-chat.ts");
    const s = await adminSession();
    const req = { headers: { cookie: s.cookie } } as unknown as Parameters<typeof runTool>[1];
    const list = JSON.parse(await runTool(app, req, "list_shipments", { q: "Трава демо" }));
    assert.equal(list.shipments.length, 1);
    assert.equal(list.shipments[0].title, "Трава демо");
    const card = JSON.parse(await runTool(app, req, "get_shipment", { number: list.shipments[0].number }));
    assert.equal(card.shipment.title, "Трава демо");
    await assert.rejects(runTool(app, req, "get_shipment", { number: 987654 }), /не найден/i);
    await assert.rejects(runTool(app, { headers: {} } as typeof req, "list_shipments", {}), /вход/i);
  });

  test("текст из Word и Excel", async () => {
    const { docxText, xlsxText } = await import("../lib/file-text.ts");
    const JSZip = (await import("jszip")).default;
    const docx = new JSZip();
    docx.file(
      "word/document.xml",
      `<w:document><w:body><w:p><w:r><w:t>Контракт № DTF-07/26</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Grass</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100 &amp; 5</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    );
    assert.equal(await docxText(await docx.generateAsync({ type: "nodebuffer" })), "Контракт № DTF-07/26\nGrass\t100 & 5");
    const xlsx = new JSZip();
    xlsx.file("xl/sharedStrings.xml", `<sst><si><t>Товар</t></si><si><t>Трава</t></si></sst>`);
    xlsx.file("xl/workbook.xml", `<workbook><sheets><sheet name="PI" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    xlsx.file("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
    xlsx.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>12.5</v></c></row><row r="2"><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>`);
    assert.equal(await xlsxText(await xlsx.generateAsync({ type: "nodebuffer" })), "=== Лист PI\nТовар\t\t12.5\n\tТрава");
  });
});

describe("Расчёт: пошлина по ТН ВЭД, КП, поручение", () => {
  test("таможенная стоимость, ставки «%» и «€ за м²/кг», НДС 22/10 %, сохранение, пересчёт", async () => {
    const { tnved } = await import("../db/schema.ts");
    const { docxText } = await import("../lib/file-text.ts");
    await db.insert(tnved).values([
      { code: "5703290009", name: "щетинистые (turf) → прочие", tariff: "0.3 EUR за 1 м2" },
      { code: "3918109000", name: "покрытия для пола из ПВХ → прочие", tariff: "6.5%, но не менее 0.096 EUR за 1 кг" },
    ]);
    const s = await adminSession();
    const tn = (await call(s, "GET", "/tnved?q=3918")).json();
    assert.equal(tn.codes[0].code, "3918109000");
    assert.equal(tn.codes[0].parsed.mode, "max");

    const client = (await call(s, "POST", "/counterparties", { role: "client", name: "ООО «Демо-Расчёт»" })).json().counterparty;
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Calc Factory" })).json().counterparty;
    await call(s, "POST", "/documents", { type: "commission_contract", number: "К-7", date: "2026-01-10", counterpartyId: client.id, validUntil: "2099-12-31" });
    const inv = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DCF-1", date: "2026-10-01", counterpartyId: supplier.id, currency: "CNY",
      items: [
        { name: "Demo calc grass 20 mm", hsCode: "5703290009", quantity: 1000, unit: "м²", price: 10 },
        { name: "Demo LVT 4 mm", hsCode: "3918109000", quantity: 500, unit: "м²", price: 20 },
      ],
      newShipment: { clientId: client.id, title: "Расчёт демо", weightKg: 1000, volumeM3: 10 },
    });
    assert.equal(inv.statusCode, 200, inv.body);
    const no = inv.json().shipment.number as number;
    await call(s, "PATCH", `/shipments/${no}`, { transport: "rail", pickupLocation: "Сиань, Китай", deliveryLocation: "Москва" });

    const before = (await call(s, "GET", `/shipments/${no}/calc`)).json();
    assert.equal(before.calc, null);
    assert.equal(before.defaults.broker, 20000, "брокер по умолчанию 20 000 ₽");
    assert.match(before.defaults.transportLabel, /ЖД перевозка 10 куб/);
    assert.equal(before.items.length, 2);

    // Курсы (фиксированы в тестах): USD 80, EUR 90, CNY 11. Товар 20 000 CNY = 220 000 ₽, перевозка 2 000 USD = 160 000 ₽.
    const res = await call(s, "POST", `/shipments/${no}/calc`, { transportAmount: 2000, transportCurrency: "USD", commission: 50000, lastMile: 10000, deliveryTerm: "20–25 дней" });
    assert.equal(res.statusCode, 200, res.body);
    const calc = res.json().calc;
    // Каждой позиции — половина товара и половина «½ перевозки»: 110 000 + 40 000 = 150 000 ₽.
    assert.deepEqual(calc.customs.lines.map((l: { customsValue: number }) => l.customsValue), [150000, 150000]);
    // Трава: 0,3 € × 1000 м² × 90 = 27 000. ПВХ: max(6,5 % × 150 000 = 9 750; 0,096 € × 500 кг × 90 = 4 320) = 9 750.
    assert.deepEqual(calc.customs.lines.map((l: { duty: number }) => l.duty), [27000, 9750]);
    assert.equal(calc.customs.duty, 36750);
    assert.equal(calc.customs.vat, Math.round((177000 * 0.22 + 159750 * 0.22) * 100) / 100);

    // НДС 10 % у товара — пересчёт по сохранённому курсу.
    const lvt = before.items.find((i: { name: string }) => i.name.includes("LVT")).productId;
    assert.equal((await call(s, "PATCH", `/products/${lvt}`, { vat10: true })).statusCode, 200);
    const calc2 = (await call(s, "POST", `/shipments/${no}/calc`, {})).json().calc;
    assert.equal(calc2.customs.vat, Math.round((177000 * 0.22 + 159750 * 0.1) * 100) / 100);
    assert.equal(calc2.commission, 50000, "параметры прошлого расчёта сохраняются");

    // «Деньги» сделки: план — из сохранённого расчёта (даже без сметы в поручении).
    const fin = (await call(s, "GET", `/shipments/${no}`)).json().finance;
    assert.equal(fin.planSource, "calc");
    const plan = (c: string) => fin.rows.find((r: { category: string }) => r.category === c)?.plan;
    assert.deepEqual(plan("customs"), { amount: Math.round((36750 + calc2.customs.vat) * 100) / 100, currency: "RUB" });
    assert.deepEqual(plan("transport"), { amount: 2000, currency: "USD" });
    assert.deepEqual(plan("fx"), { amount: 8550, currency: "RUB" });
    assert.deepEqual(plan("commission"), { amount: 50000, currency: "RUB" });
    assert.equal(fin.lastMile, 10000);

    // КП в Word.
    const kp = await app.inject({ method: "GET", url: `${API}/shipments/${no}/kp.docx`, headers: { cookie: s.cookie } });
    assert.equal(kp.statusCode, 200);
    const text = await docxText(kp.rawPayload);
    assert.match(text, /ЖД перевозка/);
    assert.match(text, /Сиань, Китай → Москва/);
    assert.match(text, /1\s000 кг \/ 10 куб\. м/);
    assert.match(text, /Таможенная пошлина\t36 750 руб\./);
    // Комиссия за перевод: 2,25 % от (товар 220 000 + перевозка 160 000) = 8 550 ₽.
    assert.match(text, /Комиссия за валютный перевод 2,25%\t8 550 руб\./);
    assert.doesNotMatch(text, /\{\{/);

    // Поручение: таможенные платежи, перевозка, брокер и вознаграждение — из расчёта.
    const order = await call(s, "POST", `/shipments/${no}/order`);
    assert.equal(order.statusCode, 200, order.body);
    const doc = (await call(s, "GET", `/documents/${order.json().document.id}`)).json().document;
    const cost = (cat: string) => doc.data.costs.find((c: { category: string }) => c.category === cat);
    assert.equal(cost("customs").amount, Math.round((36750 + calc2.customs.vat) * 100) / 100);
    assert.deepEqual([cost("transport").amount, cost("transport").currency], [2000, "USD"]);
    assert.equal(cost("broker").amount, 20000);
    assert.equal(cost("commission").amount, 50000);

    // Пересчёт перед таможней видит сумму из поручения; в истории сделки — событие.
    const after = (await call(s, "GET", `/shipments/${no}/calc`)).json();
    assert.equal(after.order.customs, cost("customs").amount);
    const events = (await call(s, "GET", `/shipments/${no}`)).json().events;
    assert.ok(events.some((e: { kind: string }) => e.kind === "calc"));
  });
});

describe("Упаковочный лист, спецификация для перевозчика, оплаты, пакет для таможни", () => {
  const multipart = (name: string, content: Buffer | string, type = "application/pdf") => {
    const boundary = "----crmpack";
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return { payload: Buffer.concat([head, Buffer.isBuffer(content) ? content : Buffer.from(content), tail]), type: `multipart/form-data; boundary=${boundary}` };
  };
  const upload = async (s: Session, url: string, name: string, content: Buffer | string, type?: string) => {
    const m = multipart(name, content, type);
    return app.inject({ method: "POST", url: `${API}${url}`, headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": m.type }, payload: m.payload });
  };

  test("схемы ответа ИИ проходят ограничения API (≤16 объединений, enum без null-типа)", async () => {
    const { DRAFT_SCHEMA, HS_SCHEMA } = await import("../lib/ai-parse.ts");
    const { MAPPING_SCHEMA } = await import("../lib/carrier-spec.ts");
    const { LEAD_REQUEST_SCHEMA } = await import("../lib/telegram-leads.ts");
    for (const schema of [DRAFT_SCHEMA, HS_SCHEMA, MAPPING_SCHEMA, LEAD_REQUEST_SCHEMA]) {
      let unions = 0;
      const walk = (n: unknown) => {
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        if (Array.isArray(o.type) || o.anyOf) unions++;
        assert.ok(!(Array.isArray(o.type) && o.enum), `enum при type-массиве: ${JSON.stringify(o).slice(0, 80)}`);
        for (const v of Object.values(o)) walk(v);
      };
      walk(schema);
      assert.ok(unions <= 16, `объединений ${unions}`);
    }
  });

  test("заполнение ячеек Excel: есть ячейка, нет ячейки, нет строки", async () => {
    const { setCell } = await import("../lib/xlsx-fill.ts");
    const xml = `<worksheet><sheetData><row r="2"><c r="A2" s="3"><v>1</v></c><c r="D2" s="4"/></row><row r="5"><c r="A5"/></row></sheetData></worksheet>`;
    let out = setCell(xml, "D2", "Текст & <знаки>");
    assert.match(out, /<c r="D2" s="4" t="inlineStr"><is><t xml:space="preserve">Текст &amp; &lt;знаки&gt;<\/t><\/is><\/c>/);
    out = setCell(out, "B2", 12.5);
    assert.match(out, /<c r="A2" s="3"><v>1<\/v><\/c><c r="B2"><v>12.5<\/v><\/c><c r="D2"/);
    out = setCell(out, "C3", "новая строка");
    assert.match(out, /<\/row><row r="3"><c r="C3" t="inlineStr">.*<\/row><row r="5">/);
  });

  test("упаковочный лист → спецификация (наш шаблон) → оплата → пакет для таможни", async () => {
    const { readGrid } = await import("../lib/xlsx-fill.ts");
    const s = await adminSession();
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Pack Factory", fullName: "DEMO PACK FACTORY CO., LTD", legalAddress: "No. 1 Demo Road, Hebei, China" })).json().counterparty;
    const contract = (await call(s, "POST", "/documents", { type: "supplier_contract", number: "DPF-01", date: "2026-03-10", counterpartyId: supplier.id })).json().document;
    const inv = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DPF-PI-7", date: "2026-10-09", counterpartyId: supplier.id, parentId: contract.id, currency: "CNY",
      data: { incoterms: "EXW" },
      items: [
        { name: "Demo grass 20 mm, 2×25 м (52 рул.)", hsCode: "5703390009", quantity: 2600, unit: "м²", price: 10, amount: 26000 },
        { name: "Demo grass 35 mm, 2×25 м (30 рул.)", hsCode: "5703390009", quantity: 1500, unit: "м²", price: 12, amount: 18000 },
        { name: "Demo glue", hsCode: "3506910000", quantity: 20, unit: "шт", price: 300, amount: 6000 },
      ],
      newShipment: { title: "Упаковка демо", weightKg: 1, volumeM3: 1 },
    });
    assert.equal(inv.statusCode, 200, inv.body);
    const no = inv.json().shipment.number as number;
    const shipmentId = (await call(s, "GET", `/shipments/${no}`)).json().shipment.id as number;
    await call(s, "PATCH", `/shipments/${no}`, { containerNo: "DEMU1000101" });

    // Упаковочный лист: строки по товарам — спецификация ровно по этим позициям (не по кодам ТН ВЭД).
    const lines = [
      { name: "Demo grass 20 mm, 2×25 м", quantity: 2600, unit: "м²", packages: 52, packageType: "рул.", netKg: 4000, grossKg: 4050, volumeM3: 12 },
      { name: "Demo grass 35 mm, 2×25 м (30 рул.)", quantity: 1500, unit: "м²", packages: 30, packageType: "рул.", netKg: 3000, grossKg: 3030, volumeM3: 9 },
      { name: "Demo glue", quantity: 20, unit: "шт", packages: 2, packageType: "кор.", netKg: 400, grossKg: 420, volumeM3: 1 },
    ];
    const pl = await call(s, "POST", "/documents", { type: "packing_list", number: "DPF-PL-7", counterpartyId: supplier.id, shipmentId, data: { packing: { lines, totals: { packages: 84, netKg: 7400, grossKg: 7500, volumeM3: 22 } } } });
    assert.equal(pl.statusCode, 200, pl.body);

    let spec = (await call(s, "GET", `/shipments/${no}/spec`)).json();
    assert.ok(spec.missing.includes("получатель (consignee)"));
    assert.deepEqual(spec.warnings, []);
    assert.equal(spec.lines.length, 3, "три позиции — как в листе и инвойсе, хотя у травы один код");
    const [grass20, grass35, glue] = spec.lines;
    assert.deepEqual([grass20.hsCode, grass20.qty, grass20.packages, grass20.netKg, grass20.grossKg, grass20.amount, grass20.price], ["5703390009", 52, 52, 4000, 4050, 26000, 500], "трава 20 мм: рулоны вместо м², веса из листа");
    assert.deepEqual([grass35.qty, grass35.netKg, grass35.amount], [30, 3000, 18000]);
    assert.deepEqual([glue.qty, glue.packages, glue.price], [20, 2, 300], "клей — штучный: кол-во в штуках");
    assert.equal(spec.fields.contract, "DPF-01 от 10.03.2026");

    await call(s, "PUT", `/shipments/${no}/spec`, { consignee: "ООО «Демо-СВХ», ИНН 7700000000", station: "Демо-Станция", descriptions: { "5703390009": "Искусственный газон / artificial grass", [glue.key]: "Клей / glue" } });
    spec = (await call(s, "GET", `/shipments/${no}/spec`)).json();
    assert.deepEqual(spec.missing, []);

    const xlsx = await app.inject({ method: "POST", url: `${API}/shipments/${no}/spec.xlsx`, headers: { cookie: s.cookie, "x-csrf-token": s.csrf } });
    assert.equal(xlsx.statusCode, 200, xlsx.body);
    const grid = (await readGrid(xlsx.rawPayload))[0];
    const at = (ref: string) => grid.cells.find((c) => c.ref === ref)?.text;
    assert.equal(at("B2"), "DPF-01 от 10.03.2026");
    assert.equal(at("F2"), "DPF-PI-7");
    assert.equal(at("C4"), "ООО «Демо-СВХ», ИНН 7700000000");
    assert.equal(at("C12"), "DEMU1000101");
    assert.equal(at("H12"), "Демо-Станция");
    assert.equal(at("B15"), "5703390009");
    assert.equal(at("D15"), "Искусственный газон / artificial grass");
    assert.equal(at("D16"), "Искусственный газон / artificial grass", "старое описание по коду подходит всем позициям с ним");
    assert.equal(at("D17"), "Клей / glue");
    assert.equal(at("F15"), "52");
    assert.equal(at("J15"), "26000");
    assert.equal(at("J16"), "18000");
    assert.equal(at("I14"), "Price per pcs / Цена за шт, CNY");
    assert.equal(at("E25"), "=SUM(E15:E24)", "итоги — формулами шаблона");
    const specDoc = (await call(s, "GET", `/documents?type=carrier_spec&shipment=${shipmentId}`)).json().documents;
    assert.equal(specDoc.length, 1, "спецификация сохранена в документах сделки");

    // Платёжка отдельным документом не сохраняется — прикрепляется к инвойсу.
    assert.equal((await call(s, "POST", "/documents", { type: "payment_order" })).statusCode, 400);
    const invoiceId = inv.json().document.id as number;
    assert.equal((await upload(s, `/documents/${invoiceId}/files?label=original`, "invoice.pdf", "%PDF-1.4 demo")).statusCode, 200);
    assert.equal((await upload(s, `/documents/${invoiceId}/files?label=payment`, "swift.pdf", "%PDF-1.4 swift")).statusCode, 200);
    const files = (await call(s, "GET", `/documents/${invoiceId}`)).json().files;
    assert.ok(files.some((f: { label: string }) => f.label === "payment"));

    // Пакет для таможни.
    const pack = (await call(s, "GET", `/shipments/${no}/customs-pack`)).json();
    assert.ok(pack.files >= 3, JSON.stringify(pack));
    assert.ok(pack.missing.some((m: string) => /Упаковочный лист.*нет файла/.test(m)));
    // Экспортная декларация и сертификат происхождения — обязательны после погрузки.
    assert.ok(pack.missing.includes("Экспортная декларация: нет") && pack.missing.includes("Сертификат происхождения: нет"), JSON.stringify(pack.missing));
    const shId = (await call(s, "GET", `/shipments/${no}`)).json().shipment.id;
    const exp = await call(s, "POST", "/documents", { type: "export_declaration", number: "000000000000000001", date: "2026-09-23", shipmentId: shId });
    assert.equal(exp.statusCode, 200, exp.body);
    const after = (await call(s, "GET", `/shipments/${no}/customs-pack`)).json();
    assert.ok(!after.missing.includes("Экспортная декларация: нет"));
    assert.ok(after.missing.some((m: string) => /Экспортная декларация № 000000000000000001: нет файла/.test(m)));
    const zipRes = await app.inject({ method: "GET", url: `${API}/shipments/${no}/customs-pack.zip`, headers: { cookie: s.cookie } });
    assert.equal(zipRes.statusCode, 200);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipRes.rawPayload);
    const names = Object.keys(zip.files);
    assert.ok(names.some((n) => n.startsWith("2 Инвойсы поставщика/") && n.includes("оплата")), names.join("\n"));
    assert.ok(names.some((n) => n.startsWith("4 Спецификация/")));
    assert.match(await zip.file("Опись.txt")!.async("string"), /Не хватает/);

    // Все документы сделки одним архивом — по папкам групп, с платёжками.
    const allRes = await app.inject({ method: "GET", url: `${API}/shipments/${no}/documents.zip`, headers: { cookie: s.cookie } });
    assert.equal(allRes.statusCode, 200);
    const all = Object.keys((await JSZip.loadAsync(allRes.rawPayload)).files);
    assert.ok(all.some((n) => n.startsWith("2 С поставщиком/") && n.includes("оплата")), all.join("\n"));
    assert.ok(all.some((n) => n.startsWith("2 С поставщиком/") && !n.includes("оплата") && n.endsWith("invoice.pdf")), all.join("\n"));
  });

  test("база фабрик: кандидатов видят админ и нашедший, дубли по WeChat, цены → товары, «сделать поставщиком»", async () => {
    const admin = await adminSession();
    assert.equal((await call(admin, "POST", "/users", { login: "petr", name: "Пётр", role: "manager", password: "managerpass" })).statusCode, 200);
    const petr = await login("petr", "managerpass", "10.0.0.21");
    const ivan = await login("ivan", "managerpass", "10.0.0.22");

    const created = await call(petr, "POST", "/factories", {
      name: "A-Demo草坪厂-小王",
      wechatId: "demo_grass_01",
      nameRu: "Демо — искусственная трава",
      location: "Демо-город, провинция Шаньдун",
      categories: "Искусственная трава, ковролин",
      profile: { leadTime: "3–5 дней", exportLicense: "yes", vtbShanghai: "no", russianClients: "да, газон", hsCode: "5703 30 800 0", bogus: "x" },
      offers: [
        { productName: "Демо-трава 20 мм", name: "Демо-трава 20 мм, 2×25 м, зелёная", price: "7,8", currency: "cny", unit: "м²", moq: 5000, perContainer: 15000, kgPerUnit: 0.4 },
        { name: "Демо-трава 20 мм, 4×25 м (10 рул.)", price: 8.1, unit: "м²" },
        { name: "" },
      ],
    });
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().factory.id as number;
    const card = (await call(petr, "GET", `/factories/${id}`)).json();
    assert.deepEqual(card.factory.categories, ["искусственная трава", "ковролин"]);
    assert.equal(card.factory.profile.exportLicense, "yes");
    assert.equal(card.factory.profile.bogus, undefined);
    assert.equal(card.foundBy.name, "Пётр");
    assert.equal(card.offers.length, 2, "пустая строка цены отброшена");
    assert.equal(card.offers[0].price, 7.8);
    assert.equal(card.offers[0].currency, "CNY");
    assert.equal(card.offers[0].productName, "Демо-трава 20 мм");
    assert.equal(card.offers[1].productId, card.offers[0].productId, "4×25 м — вариант того же товара, а не новый");

    // Кандидата видят нашедший и админ; другой сотрудник — нет (и про дубль знает только, кто нашёл).
    assert.equal((await call(ivan, "GET", `/factories/${id}`)).statusCode, 404);
    assert.equal((await call(ivan, "PATCH", `/factories/${id}`, { notes: "x" })).statusCode, 404);
    assert.ok(!(await call(ivan, "GET", "/factories")).json().factories.some((f: { id: number }) => f.id === id));
    assert.ok((await call(admin, "GET", "/factories?q=трава")).json().factories.some((f: { id: number }) => f.id === id), "поиск по товару");
    const dup = (await call(ivan, "GET", "/factories/duplicates?wechatId=DEMO_grass_01")).json().duplicates;
    assert.deepEqual(dup, [{ id: null, name: null, foundByName: "Пётр" }]);
    assert.equal((await call(petr, "GET", "/factories/duplicates?wechatId=demo_grass_01")).json().duplicates[0].id, id);
    assert.equal((await call(ivan, "GET", `/products/${card.offers[0].productId}/offers`)).json().offers.length, 0, "цены кандидата чужим не видны");
    assert.equal((await call(petr, "GET", `/products/${card.offers[0].productId}/offers`)).json().offers.length, 2);

    // Фильтры анкеты.
    assert.ok((await call(admin, "GET", "/factories?flag=export")).json().factories.some((f: { id: number }) => f.id === id));
    assert.ok(!(await call(admin, "GET", "/factories?flag=vtb")).json().factories.some((f: { id: number }) => f.id === id));
    assert.ok((await call(admin, "GET", "/factories?flag=russia")).json().factories.some((f: { id: number }) => f.id === id));

    // Файл фабрики; чужой сотрудник загрузить не может.
    assert.equal((await upload(petr, `/factories/${id}/files?label=photo`, "grass.png", "png-demo", "image/png")).statusCode, 200);
    assert.equal((await upload(ivan, `/factories/${id}/files?label=photo`, "x.png", "x", "image/png")).statusCode, 404);

    // Сотрудник не может переназначить «кто нашёл».
    await call(petr, "PATCH", `/factories/${id}`, { foundBy: null, status: "samples" });
    assert.equal((await call(petr, "GET", `/factories/${id}`)).json().factory.foundBy, card.factory.foundBy);

    // Договорились — поставщик; теперь фабрику видят все.
    const sup = await call(petr, "POST", `/factories/${id}/supplier`);
    assert.equal(sup.statusCode, 200, sup.body);
    const cp = (await call(ivan, "GET", `/counterparties/${sup.json().counterpartyId}`)).json();
    assert.equal(cp.counterparty.role, "supplier");
    assert.equal(cp.contacts[0].messengerHandle, "demo_grass_01");
    assert.equal((await call(ivan, "GET", `/factories/${id}`)).statusCode, 200);
    assert.equal((await call(ivan, "DELETE", `/factories/${id}`)).statusCode, 403);
    assert.equal((await call(petr, "DELETE", `/factories/${id}`)).statusCode, 403, "поставщика удаляет только админ");
  });

  test("галочки оплат ↔ оплата документов, платёжка к галочке", async () => {
    const s = await adminSession();
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Pay Factory" })).json().counterparty;
    const inv = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DPAY-1", date: "2026-10-01", counterpartyId: supplier.id, currency: "USD", amount: 1000,
      newShipment: { title: "Оплаты демо", weightKg: 1, volumeM3: 1 },
    });
    assert.equal(inv.statusCode, 200, inv.body);
    const no = inv.json().shipment.number as number;
    const invoiceId = inv.json().document.id as number;
    const shipmentId = (await call(s, "GET", `/shipments/${no}`)).json().shipment.id as number;
    const doc = async (id: number) => (await call(s, "GET", `/documents/${id}`)).json().document;
    const flags = async () => (await call(s, "GET", `/shipments/${no}`)).json().shipment.flags as Record<string, string>;

    // Галочку отметили датой — инвойс «Оплачен» той же датой; платёжка — к инвойсу.
    let res = await call(s, "PUT", `/shipments/${no}/flags/balance`, { done: true, date: "2026-10-05" });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual([(await doc(invoiceId)).paymentStatus, (await doc(invoiceId)).paidAt], ["paid", "2026-10-05"]);
    const proof = await upload(s, `/shipments/${no}/flags/balance/proof`, "mt103-demo.pdf", "%PDF-1.4 demo");
    assert.equal(proof.statusCode, 200, proof.body);
    assert.equal(proof.json().documentId, invoiceId);
    const deal = (await call(s, "GET", `/shipments/${no}`)).json();
    assert.equal(deal.documents.find((d: { id: number }) => d.id === invoiceId).paymentFileCount, 1);
    assert.equal(deal.documents.find((d: { id: number }) => d.id === invoiceId).fileCount, 0, "платёжка — не файл самого инвойса");
    assert.equal((await upload(s, `/shipments/${no}/flags/customs_docs/proof`, "x.pdf", "x")).statusCode, 400);
    assert.equal((await upload(s, `/shipments/${no}/flags/customs_payment/proof`, "x.pdf", "x")).statusCode, 400, "ДТ ещё нет");

    // Сняли галочку — инвойс снова не оплачен.
    await call(s, "PUT", `/shipments/${no}/flags/balance`, { done: false });
    assert.equal((await doc(invoiceId)).paymentStatus, "unpaid");

    // Оплатили инвойс в документе — галочка ставится датой оплаты.
    res = await call(s, "PATCH", `/documents/${invoiceId}`, { paymentStatus: "paid", paidAt: "2026-10-07" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await flags()).balance, "2026-10-07");

    // Новый неоплаченный инвойс поставщика — галочка снимается…
    const inv2 = (await call(s, "POST", "/documents", { type: "supplier_invoice", number: "DPAY-2", counterpartyId: supplier.id, shipmentId, currency: "USD", amount: 50 })).json().document;
    assert.equal((await flags()).balance, undefined);
    assert.equal((await doc(inv2.id)).paymentStatus, "unpaid");

    // …а таможню оплатили раньше, чем загрузили ДТ, — ДТ сразу «Оплачен» датой галочки.
    await call(s, "PUT", `/shipments/${no}/flags/customs_payment`, { done: true, date: "2026-10-10" });
    const dt = (await call(s, "POST", "/documents", { type: "customs_declaration", number: "10000000/101026/0000001", shipmentId, currency: "RUB", amount: 1 })).json().document;
    assert.deepEqual([(await doc(dt.id)).paymentStatus, (await doc(dt.id)).paidAt], ["paid", "2026-10-10"]);
    assert.equal((await flags()).customs_payment, "2026-10-10");
  });

  test("одна платёжка на несколько инвойсов, остаток инвойса в следующей сделке, пояснение для таможни", async () => {
    const s = await adminSession();
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Split Factory" })).json().counterparty;
    const a = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DSPL-1", date: "2026-10-01", counterpartyId: supplier.id, currency: "USD", amount: 25000,
      newShipment: { title: "Разнесение демо 1", weightKg: 1, volumeM3: 1 },
    });
    assert.equal(a.statusCode, 200, a.body);
    const no1 = a.json().shipment.number as number;
    const sh1 = (await call(s, "GET", `/shipments/${no1}`)).json().shipment.id as number;
    const b = (await call(s, "POST", "/documents", { type: "supplier_invoice", number: "DSPL-2", date: "2026-10-02", counterpartyId: supplier.id, shipmentId: sh1, currency: "USD", amount: 25000 })).json().document;
    const doc = async (id: number) => (await call(s, "GET", `/documents/${id}`)).json().document;

    // Обычная сделка без оплат на несколько счетов — блока нет, пояснения нет.
    let deal = (await call(s, "GET", `/shipments/${no1}`)).json();
    assert.deepEqual([deal.payments, deal.paymentNotes], [[], []]);

    // Больше суммы платежа разнести нельзя, в другой валюте — тоже.
    let res = await call(s, "POST", "/payments", { date: "2026-10-05", amount: 40000, currency: "USD", allocations: [{ documentId: a.json().document.id, amount: 25000 }, { documentId: b.id, amount: 25000 }] });
    assert.equal(res.statusCode, 400);
    res = await call(s, "POST", "/payments", { date: "2026-10-05", amount: 50000, currency: "CNY", allocations: [{ documentId: b.id, amount: 100 }] });
    assert.equal(res.statusCode, 400);

    // Два инвойса по 25 000 — одна платёжка 50 000: оба оплачены, галочка «Остаток поставщику» стоит.
    res = await call(s, "POST", "/payments", { number: "77", date: "2026-10-05", amount: 50000, currency: "USD", allocations: [{ documentId: a.json().document.id, amount: 25000 }, { documentId: b.id, amount: 25000 }] });
    assert.equal(res.statusCode, 200, res.body);
    const p1 = res.json().payment.id as number;
    assert.equal((await upload(s, `/payments/${p1}/files`, "mt103-split.pdf", "%PDF-1.4 split")).statusCode, 200);
    assert.deepEqual([(await doc(b.id)).paymentStatus, (await doc(b.id)).paidAt], ["paid", "2026-10-05"]);
    deal = (await call(s, "GET", `/shipments/${no1}`)).json();
    assert.equal(deal.shipment.flags.balance, "2026-10-05");
    assert.equal(deal.payments.length, 1);
    // Платёжка видна у каждого инвойса.
    for (const d of deal.documents.filter((x: { type: string }) => x.type === "supplier_invoice")) {
      assert.equal(d.paymentFileCount, 1);
      assert.equal(d.allocations[0].shared, true);
    }
    assert.deepEqual(deal.paymentNotes, [], "всё в этой сделке — пояснение таможне не нужно");

    // Оплатили 100 рулонов, в контейнер вошли 98: инвойс на 2 рулона — в следующей сделке, оплачен той же платёжкой.
    const c = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DSPL-3", date: "2026-10-20", counterpartyId: supplier.id, currency: "USD", amount: 10000,
      newShipment: { title: "Разнесение демо 2", weightKg: 1, volumeM3: 1 },
    });
    const no2 = c.json().shipment.number as number;
    const rest = (await call(s, "POST", "/documents", { type: "supplier_invoice", number: "DSPL-1/2", date: "2026-10-20", counterpartyId: supplier.id, shipmentId: (await call(s, "GET", `/shipments/${no2}`)).json().shipment.id, currency: "USD", amount: 500 })).json().document;
    res = await call(s, "POST", "/payments", { shipment: no1, number: "78", date: "2026-10-06", amount: 1200, currency: "USD", note: "аванс за следующую поставку", allocations: [{ documentId: rest.id, amount: 500 }] });
    assert.equal(res.statusCode, 200, res.body);
    const p2 = res.json().payment.id as number;
    assert.equal((await doc(rest.id)).paymentStatus, "paid");
    const deal2 = (await call(s, "GET", `/shipments/${no2}`)).json();
    assert.equal(deal2.payments.length, 1);
    assert.equal(deal2.payments[0].unallocated, 700);
    assert.ok(deal2.paymentNotes.some((l: string) => /№ 78/.test(l)));
    assert.ok(deal2.paymentNotes.some((l: string) => /не отнесено к инвойсам: 700,00 USD — аванс/.test(l)));
    assert.ok(deal2.documents.find((d: { id: number }) => d.id === rest.id).allocations[0].shared, "платёжка из другой сделки");
    assert.ok((await call(s, "GET", `/shipments/${no2}/customs-pack`)).json().explanation.length > 0);

    // Удалили оплату — счета снова не оплачены, галочка снята.
    assert.equal((await call(s, "DELETE", `/payments/${p1}`)).statusCode, 200);
    assert.equal((await doc(b.id)).paymentStatus, "unpaid");
    assert.equal((await call(s, "GET", `/shipments/${no1}`)).json().shipment.flags.balance, undefined);
    assert.equal((await call(s, "DELETE", `/payments/${p2}`)).statusCode, 200);
    assert.equal((await doc(rest.id)).paymentStatus, "unpaid");
  });
});

describe("Товары: варианты, объединение; ставки доставки; расчёт цены для клиента", () => {
  test("размер рулона и цвет — варианты одного товара; дубли объединяются вместе с ценами фабрик", async () => {
    const s = await adminSession();
    const a = (await call(s, "POST", "/products", { name: "Demo merge mat 0,5×25 м, серый" })).json().product;
    const b = (await call(s, "POST", "/products", { name: "Demo merge mat 1×25 м, синий/зелёный", hsCode: "3918109000" })).json().product;
    const group = (await call(s, "GET", "/products/duplicates")).json().groups.find((g: { baseName: string }) => g.baseName === "Demo merge mat");
    assert.ok(group, "группа дублей найдена");
    assert.equal(group.products.length, 2);
    const f = (await call(s, "POST", "/factories", { name: "Demo mat factory", offers: [{ productId: b.id, name: "1×25 м, синий", price: 18, unit: "м²" }] })).json().factory;
    const merged = await call(s, "POST", "/products/merge", { ids: [a.id, b.id], name: "Demo merge mat" });
    assert.equal(merged.statusCode, 200, merged.body);
    const product = (await call(s, "GET", `/products/${a.id}`)).json();
    assert.equal(product.product.name, "Demo merge mat");
    assert.equal(product.product.hsCode, "3918109000", "код взят у второго товара");
    assert.equal((await call(s, "GET", `/products/${b.id}`)).statusCode, 404);
    assert.equal((await call(s, "GET", `/factories/${f.id}`)).json().offers[0].productId, a.id, "цена фабрики перешла к товару");
    assert.equal((await call(s, "DELETE", `/products/${a.id}`)).statusCode, 409, "есть цены фабрик — не удалить");

    // Новая позиция инвойса с другим размером — к тому же товару, вариант виден в карточке.
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Mat Supplier" })).json().counterparty;
    const inv = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DMS-1", counterpartyId: supplier.id, currency: "CNY",
      items: [{ name: "Demo merge mat 2×25 м, жёлтый (10 рул.)", quantity: 500, unit: "м²", price: 18 }],
    });
    assert.equal(inv.statusCode, 200, inv.body);
    const card = (await call(s, "GET", `/products/${a.id}`)).json();
    assert.equal(card.purchases.length, 1);
    assert.ok(card.variants.some((v: { name: string }) => v.name.startsWith("Demo merge mat 2×25 м")));
    const row = (await call(s, "GET", "/products?q=жёлтый")).json().products.find((p: { id: number }) => p.id === a.id);
    assert.ok(row, "поиск по названию варианта");
    assert.equal(row.factoryCount, 1);
    assert.deepEqual(row.bestOffer, { price: 18, currency: "CNY", unit: "м²" });
  });

  test("ставки доставки, расчёт цены партии (сборный груз и контейнер), маржа, КП", async () => {
    const { docxText } = await import("../lib/file-text.ts");
    const s = await adminSession();
    assert.equal((await call(s, "POST", "/freight-rates", { origin: "Демо-Сиань" })).statusCode, 400, "без ставки нельзя");
    const lcl = (await call(s, "POST", "/freight-rates", {
      transport: "rail", mode: "cbm", origin: "Демо-Сиань", destination: "Москва", rate: "250", currency: "usd", kgPerCbm: 500, minCbm: 1, fee: 120, feeCurrency: "USD", transitDays: 20, etd: "по пятницам",
    })).json().rate;
    assert.deepEqual([lcl.mode, lcl.container, lcl.rate, lcl.currency, lcl.kgPerCbm], ["cbm", null, 250, "USD", 500]);
    const fcl = (await call(s, "POST", "/freight-rates", { transport: "rail", mode: "container", container: "40HQ", origin: "Демо-Цзинань", destination: "Москва", rate: 55000, currency: "CNY", kgPerCbm: 500 })).json().rate;
    assert.equal(fcl.kgPerCbm, null, "у контейнерной ставки нет «кг в м³»");
    assert.equal((await call(s, "GET", "/freight-rates")).json().rates.length, 2);
    assert.deepEqual((await call(s, "GET", "/cbr-rates")).json().rates, { RUB: 1, USD: 80, EUR: 90, CNY: 11 });

    const product = (await call(s, "POST", "/products", { name: "Demo quote LVT 4 мм", hsCode: "3918109000", unit: "м²" })).json().product;
    const params = { price: 4, currency: "CNY", unit: "м²", quantity: 5000, kgPerUnit: 4, m3PerUnit: 0.005, transportMode: "rate", freightRateId: lcl.id, fxPercent: 4, broker: 20000, margin: 100000, marginInKp: "line", clientName: "ООО «Демо-Клиент»" };
    const res = await call(s, "POST", `/products/${product.id}/quotes`, { params });
    assert.equal(res.statusCode, 200, res.body);
    const q = res.json().result;
    // Платный объём: max(25 м³, 20 000 кг / 500, 1) = 40 м³ → 40 × 250 + 120 = 10 120 USD × 80.
    assert.equal(q.chargeableCbm, 40);
    assert.equal(q.transportRub, 809600);
    assert.equal(q.goodsRub, 220000);
    // Пошлина: max(6,5 % от 220 000 + 809 600 / 2; 0,096 € × 20 000 кг × 90) = 172 800; НДС 22 % от (624 800 + 172 800).
    assert.equal(q.customs.duty, 172800);
    assert.equal(q.customs.vat, 175472);
    assert.equal(q.fxRub, 41184);
    assert.equal(q.costRub, 1439056);
    assert.equal(q.totalRub, 1539056);
    assert.equal(q.perUnitRub, 307.81);

    // Контейнер: 5000 м² при 15 000 в 40HQ — 1 контейнер.
    const fq = (await call(s, "POST", `/products/${product.id}/quotes`, { params: { ...params, freightRateId: fcl.id, perContainer: 15000 } })).json().result;
    assert.equal(fq.containers, 1);
    assert.equal(fq.transportRub, 605000);
    // Вес и объём всей партии заданы вручную — важнее «на единицу»: платный объём max(60 м³, 10 000 / 500).
    const tq = (await call(s, "POST", `/products/${product.id}/quotes`, { params: { ...params, weightKg: 10000, volumeM3: 60 } })).json().result;
    assert.deepEqual([tq.weightKg, tq.volumeM3, tq.chargeableCbm], [10000, 60, 60]);
    // Вручную.
    const mq = (await call(s, "POST", `/products/${product.id}/quotes`, { params: { ...params, transportMode: "manual", transportAmount: 5000, transportCurrency: "USD" } })).json().result;
    assert.equal(mq.transportRub, 400000);

    const list = (await call(s, "GET", `/products/${product.id}/quotes`)).json().quotes;
    assert.equal(list.length, 4);
    const kp = await app.inject({ method: "GET", url: `${API}/quotes/${list[3].id}/kp.docx`, headers: { cookie: s.cookie } });
    assert.equal(kp.statusCode, 200);
    const text = await docxText(kp.rawPayload);
    assert.match(text, /Коммерческое предложение: Demo quote LVT 4 мм/);
    assert.match(text, /Объём партии: 5\s000 м²/);
    assert.match(text, /Вознаграждение/);
    assert.match(text, /1\s539\s056 руб\. \(307,81 руб\. за м²\)/);
    assert.match(text, /Демо-Сиань — Москва/);
    assert.equal((await call(s, "DELETE", `/quotes/${list[0].id}`)).statusCode, 200);
  });
});

describe("Раздел «Расчёт»: заявка клиента на его товар", () => {
  test("единица пошлины закреплена за кодом ТН ВЭД: пары, м², кг", async () => {
    const { calcCustoms, dutyUnit, unitMatches } = await import("../../shared/customs.ts");
    const rates = { RUB: 1, USD: 80, EUR: 90 };
    const item = (tariff: string, quantity: number, unit: string, amount = 1000) => ({ productId: null, name: "Т", hsCode: "0000000000", tariff, vat10: false, quantity, unit, amount });
    const duty = (it: ReturnType<typeof item>, weightKg: number | null = null) => calcCustoms({ items: [it], goodsCurrency: "USD", transportAmount: null, transportCurrency: "RUB", weightKg, rates });
    assert.equal(dutyUnit("1.5 EUR за 1 пар"), "пар");
    assert.equal(dutyUnit("10%"), null);
    assert.ok(unitMatches("м2", "кв.м") && unitMatches("м2", "м²") && unitMatches("пар", "пары") && !unitMatches("м2", "рул."));
    assert.equal(duty(item("1.5 EUR за 1 пар", 100, "пары")).duty, 13500, "обувь: 100 пар × 1,5 € × 90");
    assert.equal(duty(item("0.2 EUR за 1 м2", 500, "кв.м")).duty, 9000, "ковролин: 500 м² × 0,2 € × 90");
    const roll = duty(item("0.2 EUR за 1 м2", 10, "рул."));
    assert.equal(roll.duty, 0);
    assert.match(roll.warnings.join(), /пошлина за м² — укажите количество в м²/);
    assert.equal(duty(item("6.5%, но не менее 0.096 EUR за 1 кг", 1000, "кг", 100)).duty, 8640, "за кг — вес из позиции в кг");
    assert.equal(duty(item("6.5%, но не менее 0.096 EUR за 1 кг", 3, "шт", 100), 500).duty, 4320, "иначе — общий вес");
  });

  test("комиссия: 4 % на товар + перевозку; ТЭУ: 4 % на фрахт и +6 % от общей суммы; КП", async () => {
    const s = await adminSession();
    // USD = 80 ₽ (CRM_RATES_FIXED). Товар 1000 $, перевозка 500 $, кода ТН ВЭД нет — пошлина 0, НДС 22 %.
    const params = {
      title: "Демо-стенд", clientName: "ООО «Демо»", scheme: "commission", currency: "USD",
      items: [{ name: "Стенд", hsCode: null, quantity: 1, unit: "шт", amount: 1000 }],
      pickup: "Dongguan", destination: "Москва", weightKg: 400, volumeM3: 2.67, places: 1,
      transportMode: "manual", transportAmount: 500, transportCurrency: "USD", transportLabel: "Авто перевозка Dongguan — Москва",
      fxPercent: 4, teuPercent: 6, broker: 20000, commission: 10000,
    };
    let res = await call(s, "POST", "/estimates", { params });
    assert.equal(res.statusCode, 200, res.body);
    const id = res.json().id as number;
    let r = res.json().result;
    assert.equal(r.fxRub, 4800, "4 % от (80 000 + 40 000)");
    assert.equal(r.customs.vat, 22000, "НДС 22 % от (товар + ½ перевозки)");
    assert.deepEqual([r.subtotal, r.teuRub, r.totalRub], [166800, 0, 176800]);

    res = await call(s, "PUT", `/estimates/${id}`, { params: { ...params, scheme: "teu" } });
    assert.equal(res.statusCode, 200, res.body);
    r = res.json().result;
    assert.equal(r.fxRub, 1600, "по ТЭУ — 4 % только от фрахта");
    assert.deepEqual([r.subtotal, r.teuRub, r.totalRub], [163600, 10416, 184016], "6 % от общей суммы вместе с комиссией компании");

    const list = (await call(s, "GET", "/estimates")).json().estimates;
    assert.equal(list.find((e: { id: number }) => e.id === id).totalRub, 184016);
    const kp = await app.inject({ method: "GET", url: `${API}/estimates/${id}/kp.docx`, headers: { cookie: s.cookie } });
    assert.equal(kp.statusCode, 200);
    const { docxText } = await import("../lib/file-text.ts");
    const text = await docxText(kp.rawPayload);
    assert.match(text, /Демо-стенд/);
    assert.match(text, /Dongguan — Москва/);
    assert.match(text, /оплачивается клиентом поставщику/);
    assert.match(text, /Транспортно-экспедиционное обслуживание 6%\t10\s416 руб\./);
    assert.match(text, /184\s016 руб\./);
    // Четыре главные цифры — в рублях и долларах (USD = 80): партия 184 016 ₽ = $2 300,20, товар 80 000 ₽ = $1 000.
    assert.match(text, /СТОИМОСТЬ ПАРТИИ\t184\s016 руб\. \/ \$2\s300,20/);
    assert.match(text, /ТОВАР\t80\s000 руб\. \/ \$1\s000,00/);
    assert.match(text, /ДОСТАВКА[^\t]*\t104\s016 руб\. \/ \$1\s300,20/);
    assert.match(text, /СТОИМОСТЬ ЕДИНИЦЫ — 1 шт\t184\s016 руб\. \/ \$2\s300,20/);
    assert.doesNotMatch(text, /\{\{/);
    assert.equal((await call(s, "DELETE", `/estimates/${id}`)).statusCode, 200);
  });

  test("наличные сверху расчёта: доставка для клиента, маржа / целевая цена → цена товара; только админам", async () => {
    const { computeMarkup } = await import("../../shared/estimate.ts");
    const s = await adminSession();
    // Товар $1000 (80 000 ₽), всё остальное 96 800 ₽ = $1210 (как в тесте выше, комиссия).
    const base = {
      title: "Демо-маты", scheme: "commission", currency: "USD",
      items: [{ name: "Маты", variant: "1 × 25 м", hsCode: null, quantity: 100, unit: "м²", amount: 1000, packages: 4, packageUnit: "рул.", breakdown: [{ label: "Серый", packages: 2 }, { label: "Синий", packages: 2 }] }],
      transportMode: "manual", transportAmount: 500, transportCurrency: "USD", fxPercent: 4, broker: 20000, commission: 10000,
    };
    const markup = { currency: "USD", deliveryClient: 1500, mode: "margin", margin: 1000, goodsCash: null, targetUnitPrice: null, targetUnitCurrency: "RUB" };
    const res = await call(s, "POST", "/estimates", { params: { ...base, markup } });
    assert.equal(res.statusCode, 200, res.body);
    const id = res.json().id as number;
    const saved = (await call(s, "GET", `/estimates/${id}`)).json().estimate;
    const rates = { RUB: 1, USD: 80, EUR: 90, CNY: 11 };
    let r = computeMarkup(saved.params, saved.result, rates)!;
    assert.deepEqual([r.goodsCost, r.deliveryCost, r.deliveryCash], [1000, 1210, 290], "наличные за доставку = 1500 − 1210");
    assert.deepEqual([r.goodsCash, r.items[0].clientPrice, r.totalClient, r.margin], [710, 17.1, 3210, 1000], "маржа 1000 − 290 → на товар 710 → $17,10 за м²");
    // Целевая цена 3000 ₽ за м² (всё вместе): 100 м² × 3000 = 300 000 ₽ = $3750 → на товар 3750 − 1500 − 1000 = 1250.
    r = computeMarkup({ ...saved.params, markup: { ...markup, mode: "unit", targetUnitPrice: 3000 } }, saved.result, rates)!;
    assert.deepEqual([r.goodsCash, r.items[0].clientPrice, r.unitClient], [1250, 22.5, 37.5]);

    // Две позиции — у каждой своя целевая цена (всё вместе); общая — тем, у кого своей нет.
    // Товар A $1000 (100 шт), B $1000 (50 шт); доставка клиенту $1500 делится по стоимости — по $750.
    const two = {
      ...saved.params,
      items: [
        { name: "A", hsCode: null, quantity: 100, unit: "шт", amount: 1000, vat10: false },
        { name: "B", hsCode: null, quantity: 50, unit: "шт", amount: 1000, vat10: false },
      ],
      currency: "USD",
      markup: { ...markup, mode: "unit", targetUnitCurrency: "USD", targetUnitPrice: 30, targetUnitPrices: [null, 50] },
    };
    r = computeMarkup(two, { ...saved.result, goodsRub: 160000, totalRub: 256000 }, rates)!;
    assert.deepEqual(r.items.map((i) => [i.clientPrice, i.unitClient]), [[22.5, 30], [35, 50]], "A: 30×100 − 750 → $22,50; B: 50×50 − 750 → $35");
    assert.equal(r.totalClient, 5500);
    assert.deepEqual(r.items.map((i) => i.targetUnit), [30, 50], "в таблице клиенту — цена за штуку с доставкой, как задана");

    // Менеджер наличных не видит и не стирает их при сохранении.
    const petr = await login("petr", "managerpass", "10.0.0.41");
    const asPetr = (await call(petr, "GET", `/estimates/${id}`)).json().estimate;
    assert.equal(asPetr.params.markup, null);
    assert.equal((await call(petr, "PUT", `/estimates/${id}`, { params: { ...asPetr.params, title: "Демо-маты 2" } })).statusCode, 200);
    const again = (await call(s, "GET", `/estimates/${id}`)).json().estimate;
    assert.equal(again.params.markup.deliveryClient, 1500);
    assert.equal(again.result.markup.deliveryCash, 290, "посчитанные наличные сохраняются с расчётом");

    // Сделка по расчёту: груз, вес, маршрут, наличные (админу) — за товар и за доставку.
    const created = await call(s, "POST", `/estimates/${id}/shipment`, { title: "Демо-маты", clientId: null });
    assert.equal(created.statusCode, 200, created.body);
    const no = created.json().shipment.number as number;
    const deal = (await call(s, "GET", `/shipments/${no}`)).json();
    assert.equal(deal.shipment.title, "Демо-маты");
    assert.deepEqual([deal.cash.currency, deal.cash.goods, deal.cash.delivery], ["USD", 710, 290]);
    assert.equal(deal.estimate.id, id);
    assert.equal((await call(s, "GET", `/estimates/${id}`)).json().shipments[0].number, no);
    assert.equal((await call(petr, "GET", `/shipments/${no}`)).json().cash, null, "менеджер наличных не видит");
    assert.equal((await call(petr, "PUT", `/shipments/${no}/cash`, { goods: 1 })).statusCode, 403);
    assert.equal((await call(s, "PUT", `/shipments/${no}/cash`, { currency: "USD", goods: 5000, delivery: 4000 })).statusCode, 200);
    assert.equal((await call(s, "GET", `/shipments/${no}`)).json().cash.goods, 5000);
    assert.equal((await call(s, "DELETE", `/estimates/${id}`)).statusCode, 200);
  });
});

describe("Клиент ↔ договор комиссии", () => {
  test("реквизиты: цифры чистятся, ИП определяется кодом", async () => {
    const { requisitesValues } = await import("../lib/requisites.ts");
    const v = requisitesValues({ name: "ИП Демова Д.Д.", inn: "7700 0000 0012", ogrn: "3 2100 0000 000001", bankAccount: "40802 810 1 0000 0000001", bankBik: "04 4525 000", kind: "ooo", signatoryName: "Демова Дарья Дмитриевна", kpp: "12" });
    assert.deepEqual(
      [v.inn, v.ogrn, v.bankAccount, v.bankBik, v.kind, v.signatoryTitle, v.kpp],
      ["770000000012", "321000000000001", "40802810100000000001", "044525000", "ip", "Индивидуальный предприниматель", undefined],
    );
  });

  test("договор комиссии из карточки клиента: номер по порядку, преамбула в родительном падеже, реквизиты, DOCX", async () => {
    const { docxText } = await import("../lib/file-text.ts");
    const s = await adminSession();
    const ooo = (await call(s, "POST", "/counterparties", {
      role: "client", kind: "ooo", name: "ООО «Демо-Комитент»", fullName: "Общество с ограниченной ответственностью «Демо-Комитент»",
      inn: "7700000001", kpp: "770001001", ogrn: "1027700000001", legalAddress: "125000, г. Москва, ул. Демо, д. 1",
      bankAccount: "40702810000000000001", bankName: "АО «Демо-Банк»", bankBik: "044525001", bankCorrAccount: "30101810000000000001",
      signatoryTitle: "Генеральный директор", signatoryName: "Демидова Анна Петровна", signatoryBasis: "Устава",
    })).json().counterparty;
    const hints = (await call(s, "GET", `/counterparties/${ooo.id}/commission-contract`)).json();
    assert.deepEqual(hints.missing, []);
    assert.match(hints.number, /^\d{2,}$/);
    const res = await call(s, "POST", `/counterparties/${ooo.id}/commission-contract`, { number: hints.number, date: "2026-03-09", city: "г. Красногорск", validUntil: "2027-03-08" });
    assert.equal(res.statusCode, 200, res.body);
    const doc = res.json().document;
    assert.deepEqual([doc.type, doc.counterpartyId, doc.status, doc.validUntil], ["commission_contract", ooo.id, "draft", "2027-03-08"]);
    const full = (await call(s, "GET", `/documents/${doc.id}`)).json();
    assert.equal(full.files.length, 1);
    assert.equal(full.files[0].label, "generated");
    const file = await app.inject({ method: "GET", url: `${API}/files/${full.files[0].id}`, headers: { cookie: s.cookie } });
    const text = await docxText(file.rawPayload);
    assert.match(text, new RegExp(`Договор комиссии №\\s+${hints.number}`));
    assert.match(text, / г\. Красногорск\s*09 марта 2026 г\./);
    assert.doesNotMatch(text, /г\. г\./);
    assert.match(text, /Общество с ограниченной ответственностью «Демо-Комитент», именуемое в дальнейшем Комитент, в лице генерального директора Демидовой А\.П\., действующей на основании Устава, с одной стороны, и/);
    assert.match(text, /действует до 08 марта 2027 года/);
    assert.match(text, /ИНН 7700000001\/КПП 770001001/);
    assert.match(text, /р\/с 40702810000000000001 в АО «Демо-Банк»/);
    assert.match(text, /Демидова А\.П\./);
    assert.doesNotMatch(text, /\{\{/);
    // Следующий номер — на единицу больше.
    assert.equal(Number((await call(s, "GET", `/counterparties/${ooo.id}/commission-contract`)).json().number), Number(hints.number) + 1);
    // DOCX документа — заново по текущим реквизитам.
    const again = await app.inject({ method: "GET", url: `${API}/documents/${doc.id}/docx`, headers: { cookie: s.cookie } });
    assert.equal(again.statusCode, 200);
    assert.match(await docxText(again.rawPayload), /Демидовой А\.П\./);

    // ИП: сам предприниматель, «именуемая»; не хватает реквизитов — подсказка.
    const ip = (await call(s, "POST", "/counterparties", { role: "client", kind: "ip", name: "ИП Демова Д.Д.", signatoryName: "Демова Дарья Дмитриевна", inn: "770000000012" })).json().counterparty;
    assert.deepEqual((await call(s, "GET", `/counterparties/${ip.id}/commission-contract`)).json().missing, ["ОГРНИП", "адрес", "банковские реквизиты"]);
    const ipDoc = (await call(s, "POST", `/counterparties/${ip.id}/commission-contract`, { date: "2026-04-01", validUntil: "2027-03-31" })).json().document;
    const ipText = await docxText((await app.inject({ method: "GET", url: `${API}/documents/${ipDoc.id}/docx`, headers: { cookie: s.cookie } })).rawPayload);
    assert.match(ipText, /Индивидуальный предприниматель Демова Дарья Дмитриевна, именуемая в дальнейшем Комитент, с одной стороны/);
    assert.match(ipText, /ОГРНИП/);

    // Договор только с клиентом; шаблон договора можно скачать в настройках.
    const sup = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Contract Supplier" })).json().counterparty;
    assert.equal((await call(s, "POST", `/counterparties/${sup.id}/commission-contract`, { date: "2026-04-01", validUntil: "2027-03-31" })).statusCode, 400);
    const tpl = await app.inject({ method: "GET", url: `${API}/settings/templates/commission_contract.docx`, headers: { cookie: s.cookie } });
    assert.equal(tpl.statusCode, 200);
    assert.match(await docxText(tpl.rawPayload), /\{\{contract\.clientPreamble\}\}/);
    assert.equal((await app.inject({ method: "GET", url: `${API}/settings/templates/nope.docx`, headers: { cookie: s.cookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `${API}/settings/templates/commission_order.docx`, headers: { cookie: s.cookie } })).statusCode, 200);
  });
});

describe("ИИ-разбор: стороны и тип счёта", () => {
  const base = {
    number: "DEMO-FF-1", date: "2026-09-14", currency: "CNY", amount: 1000, contractorType: null, clientName: null, contractNumber: null,
    relatedNumbers: [], cargoTitle: null, containerNo: null, weightKg: null, volumeM3: null, incoterms: null, paymentTerms: null,
    validUntil: null, costCategory: null, summary: "Инвойс за международную перевозку",
  };
  test("счёт от китайского экспедитора — не «счёт клиенту», а счёт подрядчика", async () => {
    const { resolveDraft } = await import("../lib/ai-parse.ts");
    const d = await resolveDraft(db, {
      ...base,
      docType: "client_invoice",
      counterparty: { name: "Demo Freight Forwarding Co., Ltd.", country: "Китай" },
      items: [{ name: "International transportation costs", hsCode: null, hsGuess: null, quantity: 1, unit: null, price: 1000, amount: 1000 }],
    } as never);
    assert.equal(d.type, "contractor_invoice");
    assert.equal(d.counterparty?.name, "Demo Freight Forwarding Co., Ltd.");
  });
  test("известный поставщик: позиция находит его товар по артикулу, даже если название на другом языке", async () => {
    const { resolveDraft } = await import("../lib/ai-parse.ts");
    const s = await adminSession();
    const sup = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Vast Plastic Co., Ltd" })).json().counterparty;
    const inv = await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DVP-1", counterpartyId: sup.id, currency: "CNY",
      items: [{ name: "Демо ПВХ покрытие M777-4", hsCode: "5904100000", quantity: 100, unit: "м²", price: 4, amount: 400 }],
    });
    assert.equal(inv.statusCode, 200, inv.body);
    const productId = (await call(s, "GET", `/documents/${inv.json().document.id}`)).json().items[0].productId as number;
    const d = await resolveDraft(db, {
      ...base,
      docType: "supplier_invoice",
      counterparty: { name: "Demo Vast Plastic Co., Ltd" },
      items: [
        { name: "PVC flooring M777-4, 3m×30m", hsCode: null, hsGuess: "3918", quantity: 90, unit: "рул.", price: null, amount: 900 },
        { name: "PVC flooring X1, 2m", hsCode: null, hsGuess: null, quantity: 1, unit: "рул.", price: null, amount: 1 },
      ],
    } as never);
    assert.equal(d.counterparty?.id, sup.id);
    assert.equal(d.items[0].productId, productId, "товар поставщика по артикулу M777-4");
    assert.equal(d.items[0].productGuess, true);
    assert.equal(d.items[0].hsCode, "5904100000", "код — как у товара");
    assert.equal(d.items[1].productId, null);
  });

  test("поручение из файла: смета «Порядок возмещаемых платежей» попадает в форму", async () => {
    const { resolveDraft } = await import("../lib/ai-parse.ts");
    const d = await resolveDraft(db, {
      ...base,
      docType: "commission_order",
      counterparty: { name: "ООО «Демо-Смета»" },
      items: [],
      costs: [
        { category: "transport", amount: 60050, currency: "CNY" },
        { category: "customs", amount: 644679.12, currency: "RUB" },
        { category: "broker", amount: 20000, currency: "RUB" },
        { category: "fx", amount: null, currency: null },
      ],
    } as never);
    const line = (c: string) => d.costs?.find((l) => l.category === c);
    assert.deepEqual([line("transport")?.amount, line("transport")?.currency], [60050, "CNY"]);
    assert.equal(line("customs")?.amount, 644679.12);
    assert.equal(line("broker")?.amount, 20000);
    assert.equal(line("fx")?.amount, null, "подтверждаемый расход — без суммы");
    assert.equal(d.costs?.length, 9, "все строки сметы шаблона");
  });

  test("декларация: изготовитель — сторона, товары — по артикулам из декларации, видна в карточке товара", async () => {
    const { resolveDraft } = await import("../lib/ai-parse.ts");
    const s = await adminSession();
    const sup = (await call(s, "POST", "/counterparties", { role: "supplier", name: "DEMO DECL PLASTIC CO., LTD." })).json().counterparty;
    await call(s, "POST", "/documents", {
      type: "supplier_invoice", number: "DDP-1", counterpartyId: sup.id, currency: "CNY",
      items: [
        { name: "Демо линолеум K777-1, 2×30 м", quantity: 100, unit: "м²", price: 4, amount: 400 },
        { name: "Демо линолеум 888-12, 3 м", quantity: 100, unit: "м²", price: 4, amount: 400 },
        { name: "Демо клей", quantity: 1, unit: "шт", price: 4, amount: 4 },
      ],
    });
    const d = await resolveDraft(db, {
      ...base,
      docType: "conformity", number: "RU-DEMO.01/26", amount: null, currency: null, validUntil: "2031-04-30",
      counterparty: { name: "DEMO DECL PLASTIC CO., LTD." },
      items: [{ name: "Покрытие напольное ПВХ", hsCode: "5904100000", hsGuess: null, quantity: null, unit: null, price: null, amount: null }],
      models: ["PVC K777-1", "K777-1", "888-12", "PVC Z999"],
    } as never);
    assert.equal(d.counterparty?.id, sup.id, "сторона — изготовитель");
    assert.deepEqual(d.items.filter((i) => i.productId).map((i) => i.name).sort(), ["Демо линолеум 888-12, 3 м", "Демо линолеум K777-1"]);
    assert.deepEqual(d.items.filter((i) => !i.productId).map((i) => i.name), ["PVC Z999"], "модель без товара — строкой");
    assert.ok(d.items.every((i) => i.hsCode === "5904100000"));
    const productsBefore = (await call(s, "GET", "/products")).json().products.length;
    // Сохранили — видна в карточке товара и у поставщика.
    const saved = await call(s, "POST", "/documents", { type: "conformity", number: d.number, validUntil: d.validUntil, counterpartyId: sup.id, items: d.items });
    assert.equal(saved.statusCode, 200, saved.body);
    const card = (await call(s, "GET", `/products/${d.items[0].productId}`)).json();
    assert.equal(card.certificates[0].number, "RU-DEMO.01/26");
    assert.equal(card.certificates[0].counterpartyName, "DEMO DECL PLASTIC CO., LTD.");
    assert.ok((await call(s, "GET", `/counterparties/${sup.id}`)).json().documents.some((x: { type: string }) => x.type === "conformity"));
    assert.equal((await call(s, "GET", "/products")).json().products.length, productsBefore, "декларация товары не заводит");
    // Товар с моделью из декларации появился позже — декларация подхватывается по артикулу.
    const later = await call(s, "POST", "/documents", { type: "supplier_invoice", number: "DDP-2", counterpartyId: sup.id, currency: "CNY", items: [{ name: "Демо линолеум Z999", quantity: 1, unit: "м²", price: 1, amount: 1 }] });
    const laterProduct = (await call(s, "GET", `/documents/${later.json().document.id}`)).json().items[0].productId;
    assert.equal((await call(s, "GET", `/products/${laterProduct}`)).json().certificates[0]?.number, "RU-DEMO.01/26");
    // Пустые товары (только в декларациях / нигде) удаляются, остальные — нет.
    const junk = (await call(s, "POST", "/products", { name: "Демо лишний товар из декларации" })).json().product;
    const unused = (await call(s, "GET", "/products/unused")).json();
    assert.ok(unused.names.includes("Демо лишний товар из декларации"));
    assert.ok(!unused.names.includes("Демо линолеум K777-1"));
    assert.ok((await call(s, "POST", "/products/unused/delete")).json().removed >= 1);
    assert.equal((await call(s, "GET", `/products/${junk.id}`)).statusCode, 404);
    assert.equal((await call(s, "GET", `/products/${laterProduct}`)).statusCode, 200);
  });

  test("стороной записали нас — сторона сбрасывается, тип не «счёт клиенту»", async () => {
    const { resolveDraft, isOurCompany } = await import("../lib/ai-parse.ts");
    assert.ok(isOurCompany({ name: "LIMITEDTRADE DEVELOPMENT BARS TRADING CO." }));
    assert.ok(isOurCompany({ inn: "5024 256988" }));
    assert.ok(!isOurCompany({ name: "ООО «Барс-Демо»" }));
    const d = await resolveDraft(db, {
      ...base,
      docType: "client_invoice",
      counterparty: { name: "LIMITEDTRADE DEVELOPMENT BARS TRADING CO.", inn: "5024256988" },
      items: [],
    } as never);
    assert.equal(d.type, "contractor_invoice");
    assert.equal(d.counterparty, null);
    assert.ok(d.warnings.some((w) => /не распознано/.test(w)));
  });
});

describe("Каталоги фабрик из рассылки", () => {
  /** Загрузка кусками, как в браузере: начать → куски → завершить. */
  const upload = async (s: Session, name: string, content: Buffer | string, chunk = 64) => {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const start = await call(s, "POST", "/catalogs/uploads", { name, size: data.length, lastModified: 1 });
    if (start.statusCode !== 200) return start;
    const { id } = start.json();
    let offset = start.json().offset as number;
    while (offset < data.length) {
      const res = await app.inject({
        method: "PUT",
        url: `${API}/catalogs/uploads/${id}?offset=${offset}`,
        headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/octet-stream" },
        payload: data.subarray(offset, offset + chunk),
      });
      assert.equal(res.statusCode, 200, res.body);
      offset = res.json().offset;
    }
    return call(s, "POST", `/catalogs/uploads/${id}/finish`, { name, size: data.length });
  };

  /** Простой PDF: страницы с текстом (Helvetica) или только с рисунком (как скан без текстового слоя). */
  function demoPdf(pages: string[]): Buffer {
    const objs: string[] = [];
    const kids: number[] = [];
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    let n = 4;
    for (const text of pages) {
      const stream = text ? `BT /F1 10 Tf 40 780 Td 12 TL ${text.split("\n").map((l) => `(${l}) '`).join(" ")} ET` : "0.2 0.4 0.8 rg 50 50 500 700 re f";
      objs[n] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      objs[n + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${n} 0 R >>`;
      kids.push(n + 1);
      n += 2;
    }
    objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = Buffer.byteLength(out);
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }

  const settle = async (s: Session) => {
    const { catalogQueueIdle } = await import("../lib/catalogs.ts");
    for (let i = 0; i < 100; i++) {
      await catalogQueueIdle();
      const data = (await call(s, "GET", "/catalogs")).json();
      const shotsBusy = data.shots.some((x: { status: string }) => x.status === "queued" || x.status === "processing");
      if (!data.counts.queued && !data.counts.processing && !shotsBusy) return data;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("очередь каталогов не разобралась");
  };

  test("сопоставление со скриншотами, выбор страниц, категории, схема ответа", async () => {
    const { matchSender, sizeMatches, pickPages, sampleText, normalizeCategories, companyCore, CATALOG_SCHEMA, sameSender } = await import("../lib/catalogs.ts");
    assert.ok(sizeMatches(Math.round(12.8 * 1024 * 1024), "12.8M"));
    assert.ok(sizeMatches(12_800_000, "12.8M"));
    assert.ok(!sizeMatches(13_500_000, "12.8M"));
    assert.ok(sizeMatches(512 * 1024, "512K"));
    const rows = [
      { filename: "2026 Green Valley Gym Series.pdf", size: "55.9M", sender: "Leah Lee 18375803260李", chat: "Leah Lee 18375803260李" },
      { filename: "产品名录（新）(1).pdf", size: "56.7M", sender: "净水器、配件", chat: "净水器、配件" },
      { filename: "目录.pdf", size: "2.1M", sender: "A-地板厂-小王", chat: null },
      { filename: "目录.pdf", size: "2.1M", sender: "B-地毯厂-小李", chat: null },
      { filename: "Catalog--Paint Vinyl Wallpaper.pdf", size: "95.0M", sender: "Las fugas", chat: "Las fugas" },
    ];
    const mb = (v: number) => Math.round(v * 1024 * 1024);
    assert.equal(matchSender({ filename: "2026 Green Valley Gym Series.pdf", size: mb(55.9) }, rows)?.sender, "Leah Lee 18375803260李");
    assert.equal(matchSender({ filename: "产品名录(新)(1).pdf", size: mb(56.7) }, rows)?.sender, "净水器、配件", "полуширинные скобки");
    assert.equal(matchSender({ filename: "产品名录(新).pdf", size: mb(56.7) }, rows)?.sender, "净水器、配件", "без «(1)»");
    assert.equal(matchSender({ filename: "目录.pdf", size: mb(2.1) }, rows), null, "два отправителя — не угадываем");
    assert.equal(matchSender({ filename: "Catalog--Paint Vinyl Wallpapr.pdf", size: mb(95) }, rows)?.sender, "Las fugas", "ИИ ошибся в букве");
    assert.equal(matchSender({ filename: "2026 Green Valley Gym Series.pdf", size: mb(20) }, rows)?.sender, undefined, "другой размер — другой файл… или нет совпадения");
    assert.deepEqual(pickPages(6, 6), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(pickPages(100, 6), [1, 2, 14, 39, 63, 88]);
    const text = sampleText(Array.from({ length: 100 }, (_, i) => `Раздел ${i + 1} ${"x".repeat(1000)}`));
    assert.ok(text.length <= 8000 + 2000 && text.includes("Раздел 1 ") && text.includes("Раздел 100") === false && /Раздел [5-9]\d /.test(text), "понемногу с разных страниц");
    assert.deepEqual(normalizeCategories(["Ковролин", " SPC-ламинат ", "ковролин", "Ковёр"], ["ковролин", "spc ламинат", "ковер"]), ["ковролин", "spc ламинат", "ковер"]);
    assert.deepEqual(normalizeCategories(["ковролин", "огнестойкий ковролин", "ковролин на пвх-основе", "линолеум"], []), ["ковролин", "линолеум"], "разновидности — одна категория");
    assert.deepEqual(normalizeCategories(["резиновая плитка"], ["плитка"]), ["резиновая плитка"], "с существующими сами не сливаем");
    assert.equal(companyCore("Dezhou Chengda Nonwoven Products Co., Ltd."), "dezhou chengda nonwoven products");
    assert.ok(sameSender("Leah Lee 18375803260李", "Leah Lee 18375803260"), "ИИ потерял иероглиф на одном скриншоте");
    assert.ok(!sameSender("A-地板厂", "A-地板厂-小王-123456"));
    const unions = JSON.stringify(CATALOG_SCHEMA).match(/"type":\[/g)?.length ?? 0;
    assert.ok(unions <= 16);
  });

  test("загрузка → разбор → проверка → фабрики; повтор и дубли; только админ", async () => {
    const admin = await adminSession();
    const ivan = await login("ivan", "managerpass", "10.0.0.41");
    assert.equal((await call(ivan, "GET", "/catalogs")).statusCode, 403);
    assert.equal((await upload(ivan, "x.pdf", "x")).statusCode, 403);

    // Обрыв связи: часть файла ушла, загрузка начата заново (тот же файл) — продолжается с того же места.
    const big = Buffer.from("Demo resumable catalog. ".repeat(40));
    const first = (await call(admin, "POST", "/catalogs/uploads", { name: "resume.txt", size: big.length, lastModified: 7 })).json();
    const put = (offset: number, part: Buffer) =>
      app.inject({ method: "PUT", url: `${API}/catalogs/uploads/${first.id}?offset=${offset}`, headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf, "content-type": "application/octet-stream" }, payload: part });
    const p0 = await put(0, big.subarray(0, 300));
    assert.equal(p0.json().offset, 300, p0.body);
    const again2 = (await call(admin, "POST", "/catalogs/uploads", { name: "resume.txt", size: big.length, lastModified: 7 })).json();
    assert.deepEqual(again2, { id: first.id, offset: 300 });
    const wrong = await put(100, big.subarray(100, 200));
    assert.equal(wrong.statusCode, 409);
    assert.equal(wrong.json().offset, 300, "повтор куска не с того места — сервер говорит, откуда продолжать");
    assert.equal((await call(admin, "POST", `/catalogs/uploads/${first.id}/finish`, { name: "resume.txt", size: big.length })).statusCode, 409, "не докачан");
    assert.equal((await put(300, big.subarray(300))).json().offset, big.length);
    const resumed = await call(admin, "POST", `/catalogs/uploads/${first.id}/finish`, { name: "resume.txt", size: big.length });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().catalog.size, big.length);
    await settle(admin);
    assert.equal((await call(admin, "DELETE", `/catalogs/${resumed.json().catalog.id}`)).statusCode, 200);
    assert.equal((await call(admin, "POST", "/catalogs/uploads", { name: "huge.pdf", size: 10 * 1024 * 1024 * 1024 })).statusCode, 413);

    // Строки «со скриншота» до загрузки файлов: отправитель подхватывается при загрузке.
    const { db: tdb } = await import("../db/client.ts");
    const { catalogSenders } = await import("../db/schema.ts");
    const textCatalog = `DEMO CARPET FACTORY CO., LTD.\nTel: +86 18300000001\n${"Plain carpet, velour carpet, jacquard exhibition carpet, polyester. ".repeat(12)}`;
    const scan = demoPdf(["", "", ""]);
    const textPdf = demoPdf(["DEMO NONWOVEN PRODUCTS CO LTD", ["Exhibition carpet catalog", ...Array.from({ length: 12 }, () => "Needle punched velour carpet for exhibitions and hotels")].join("\n")]);
    await tdb.insert(catalogSenders).values([
      { filename: "demo carpet catalog.txt", size: `${(Buffer.byteLength(textCatalog) / 1024).toFixed(1)}K`, sender: "Demo-地毯厂-小王", chat: "Demo-地毯厂-小王" },
      { filename: "demo scan 扫描版.pdf", size: `${(scan.length / 1024).toFixed(1)}K`, sender: "Demo-地毯厂-小王", chat: "Demo-地毯厂-小王" },
    ]);
    // Фабрика с таким именем WeChat уже есть (завёл менеджер) — каталог её найдёт.
    const known = (await call(ivan, "POST", "/factories", { name: "Demo Wallpaper 13800000002", categories: ["обои"] })).json().factory;

    const a = await upload(admin, "demo carpet catalog.txt", textCatalog);
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(a.json().catalog.sender, "Demo-地毯厂-小王");
    const b = (await upload(admin, "demo scan 扫描版.pdf", scan)).json().catalog;
    const c = (await upload(admin, "wallpaper.pdf", textPdf)).json().catalog;
    assert.equal(b.sender, "Demo-地毯厂-小王");
    assert.equal(c.sender, null);
    const again = (await upload(admin, "копия.txt", textCatalog)).json();
    assert.equal(again.duplicate, true, "тот же файл второй раз не берём");
    const check = (await call(admin, "POST", "/catalogs/check", { files: [{ name: "wallpaper.pdf", size: textPdf.length }, { name: "wallpaper.pdf", size: 1 }] })).json();
    assert.deepEqual(check.exists, [true, false]);

    const data = await settle(admin);
    const byId = new Map(data.items.map((i: { id: number }) => [i.id, i]));
    const ia = byId.get(a.json().catalog.id) as { status: string; method: string; note: string };
    const ib = byId.get(b.id) as { status: string; method: string; pages: number };
    const ic = byId.get(c.id) as { method: string; pages: number };
    assert.equal(ia.status, "review");
    assert.equal(ia.method, "text");
    assert.match(ia.note, /ИИ не подключён/);
    assert.equal(ib.method, "images", "скан — страницами-картинками");
    assert.equal(ib.pages, 3);
    assert.equal(ic.method, "text");
    assert.equal(ic.pages, 2);

    // Отправителя третьего файла указали вручную — по имени WeChat нашлась фабрика менеджера.
    assert.equal((await call(admin, "PATCH", `/catalogs/${c.id}`, { sender: "Demo Wallpaper 13800000002" })).statusCode, 200);
    const review = (await call(admin, "GET", "/catalogs")).json();
    const carpet = review.groups.find((g: { sender: string }) => g.sender === "Demo-地毯厂-小王");
    assert.deepEqual([...carpet.catalogIds].sort(), [a.json().catalog.id, b.id].sort(), "файлы одного контакта — одной группой");
    assert.equal(carpet.match, null);
    const wall = review.groups.find((g: { sender: string }) => g.sender === "Demo Wallpaper 13800000002");
    assert.equal(wall.match.id, known.id);
    assert.equal(wall.match.reason, "имя в WeChat");

    const confirmed = (
      await call(admin, "POST", "/catalogs/confirm", {
        groups: [
          { catalogIds: carpet.catalogIds, factoryId: null, nameRu: "Demo — ковролин", categories: ["Ковролин", "ковролин"] },
          { catalogIds: wall.catalogIds, factoryId: known.id, categories: ["обои", "Фотообои"] },
        ],
      })
    ).json();
    assert.deepEqual(confirmed, { created: 1, updated: 1, errors: [] });
    const list = (await call(admin, "GET", "/factories?q=velour")).json().factories;
    const made = list.find((f: { name: string }) => f.name === "Demo-地毯厂-小王");
    assert.ok(made, "поиск по тексту каталога");
    assert.deepEqual(made.categories, ["ковролин"]);
    const card = (await call(admin, "GET", `/factories/${made.id}`)).json();
    assert.equal(card.factory.nameRu, "Demo — ковролин");
    assert.equal(card.files.length, 2);
    assert.ok(card.files.every((f: { label: string }) => f.label === "catalog"));
    assert.equal(card.factory.phone, null);
    assert.deepEqual((await call(admin, "GET", `/factories/${known.id}`)).json().factory.categories, ["обои", "фотообои"]);
    assert.ok(!(await call(ivan, "GET", "/factories")).json().factories.some((f: { id: number }) => f.id === made.id), "фабрику из каталогов видит только админ");
    assert.equal((await call(admin, "POST", "/catalogs/confirm", { groups: [{ catalogIds: carpet.catalogIds, factoryId: null }] })).json().errors.length, 1, "второй раз не подтверждается");

    // Новый каталог того же контакта — сразу к его фабрике.
    const d = (await upload(admin, "demo new.txt", `${textCatalog} more`)).json().catalog;
    await call(admin, "PATCH", `/catalogs/${d.id}`, { sender: "Demo-地毯厂-小王" });
    const next = await settle(admin);
    assert.equal(next.groups.find((g: { catalogIds: number[] }) => g.catalogIds.includes(d.id)).match.reason, "этот контакт уже присылал каталог");
    assert.ok(next.categories.some((k: { c: string }) => k.c === "ковролин"));

    // Категории: переименовать и слить.
    assert.equal((await call(admin, "POST", "/factories/categories/rename", { from: "фотообои", to: "Обои" })).json().factories, 1);
    assert.deepEqual((await call(admin, "GET", `/factories/${known.id}`)).json().factory.categories, ["обои"]);
    assert.equal((await call(ivan, "POST", "/factories/categories/rename", { from: "обои", to: "x" })).statusCode, 403);

    // Удалить неподтверждённый — вместе с файлом.
    const fileId = next.items.find((i: { id: number }) => i.id === d.id).attachmentId;
    assert.equal((await call(admin, "DELETE", `/catalogs/${d.id}`)).statusCode, 200);
    assert.equal((await call(admin, "GET", `/files/${fileId}`)).statusCode, 404);
    assert.equal((await call(admin, "DELETE", `/catalogs/${a.json().catalog.id}`)).statusCode, 404, "подтверждённый не удаляется");

    // Скриншоты «Файлы» сохраняются сразу (ИИ читает в фоне); тот же второй раз не берётся; без ИИ — ошибка, не потеря.
    const shotForm = (names: string[]) => {
      const b = "----crmshots";
      const parts = names.map((n) => Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${n}"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from(`png-${n.slice(0, 5)}`), Buffer.from("\r\n")]));
      return { payload: Buffer.concat([...parts, Buffer.from(`--${b}--\r\n`)]), type: `multipart/form-data; boundary=${b}` };
    };
    const sendShots = (names: string[]) => {
      const f = shotForm(names);
      return app.inject({ method: "POST", url: `${API}/catalogs/senders`, headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf, "content-type": f.type }, payload: f.payload });
    };
    const shots1 = await sendShots(["shot1.png", "shot2.png"]);
    assert.deepEqual(shots1.json(), { saved: 2, same: 0, skipped: [] }, shots1.body);
    assert.deepEqual((await sendShots(["shot1.png"])).json(), { saved: 0, same: 1, skipped: [] });
    const afterShots = await settle(admin);
    assert.equal(afterShots.shots.length, 2);
    assert.ok(afterShots.shots.every((x: { status: string; note: string }) => x.status === "failed" && /ИИ не подключён/.test(x.note)));
    assert.ok((await call(admin, "POST", "/catalogs/all/retry")).json().queued >= 2, "«Повторить все с ошибкой» — и скриншоты");
    await settle(admin);

    // Отложенный без poppler-utils PDF после установки и перезапуска сервера — снова в очередь.
    const { catalogs: catalogsTable } = await import("../db/schema.ts");
    const { resetCatalogQueue } = await import("../lib/catalogs.ts");
    const { eq } = await import("drizzle-orm");
    const [late] = await tdb
      .insert(catalogsTable)
      .values({ filename: "late.pdf", size: 1, status: "failed", note: "На сервере нет poppler-utils (sudo apt-get install poppler-utils) — после установки и перезапуска разберётся сам" })
      .returning({ id: catalogsTable.id });
    await resetCatalogQueue();
    const [requeued] = await tdb.select({ status: catalogsTable.status, note: catalogsTable.note }).from(catalogsTable).where(eq(catalogsTable.id, late.id));
    assert.deepEqual(requeued, { status: "queued", note: null });
    await tdb.delete(catalogsTable).where(eq(catalogsTable.id, late.id));
  });
});

describe("Бот заявок в Telegram", () => {
  test("привязка, заявка → лид с клиентом и контактом, поиск клиента, дубль, отмена", async () => {
    const { handleUpdate, createLinkCode } = await import("../lib/telegram-bot.ts");
    const { leadDraft } = await import("../lib/telegram-leads.ts");
    const { deals: dealsTable, counterparties: cpTable, contacts: contactsTable } = await import("../db/schema.ts");
    const { eq } = await import("drizzle-orm");
    const s = await adminSession();

    // Без токена бот выключен.
    assert.deepEqual((await call(s, "GET", "/auth/telegram")).json(), { enabled: false, bot: null, linked: false });
    assert.equal((await call(s, "POST", "/auth/telegram/link")).statusCode, 503);

    // Черновик модели чистит код: почта из mailto, ИНН — цифры, неизвестный тип → «Другое», мы — не клиент.
    const raw = leadDraft({ type: "nonsense", email: "mailto:Petrov@Demo-Lab.test", inn: "77 0000 0001", companyName: "ООО «ТЛК БАРС»" });
    assert.equal(raw.type, "other");
    assert.equal(raw.email, "petrov@demo-lab.test");
    assert.equal(raw.inn, "");
    assert.equal(raw.companyName, "");

    const sent: { method: string; params: Record<string, unknown> }[] = [];
    let messageId = 100;
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      sent.push({ method, params });
      return method === "sendMessage" ? { message_id: ++messageId } : true;
    };
    const last = () => String(sent.at(-1)?.params.text ?? "");
    const drafts: Record<string, Partial<Record<string, string>>> = {};
    const parse = async (text: string) => ({ draft: leadDraft(drafts[text.split("\n")[0]] ?? {}), usage: null });
    const deps = { api, parse, mergeMs: 0 };
    const TG = 555_000_111;
    const msg = (text: string, from = TG) => ({ update_id: 1, message: { message_id: 1, chat: { id: from, type: "private" }, from: { id: from }, text } });

    // Чужой — отказ; код из профиля привязывает Telegram.
    await handleUpdate(deps, msg("Здравствуйте, нужна доставка из Китая"));
    assert.match(last(), /для сотрудников/);
    await handleUpdate(deps, msg("/start WRONG123"));
    assert.match(last(), /не подошёл/);
    const { code } = createLinkCode(1);
    await handleUpdate(deps, msg(`/start ${code}`));
    assert.match(last(), /Telegram привязан/);
    assert.equal((await call(s, "GET", "/auth/telegram")).json().linked, true);

    // Заявка 1: новый клиент и контакт, тип — меткой, исполнитель — кто прислал.
    const text1 = "Демо-заявка 1: ищем китайскую компанию-посредника\nВыкупить товар у производителя в КНР, CIP Москва, оплата в ВТБ Шанхай.\nС уважением, Петров Пётр, ООО «Демо Энерголаб»";
    drafts["Демо-заявка 1: ищем китайскую компанию-посредника"] = {
      title: "Выкуп товара в КНР через китайскую компанию, CIP Москва", product: "Посредник в КНР: выкуп и экспорт", type: "agent",
      summary: "Нужна китайская компания-посредник.\nОплата в ВТБ Шанхай, CNY.", companyName: "ООО «Демо Энерголаб»", companyPhone: "8 800 000-00-00",
      contactName: "Петров Пётр", position: "Менеджер по закупкам", phone: "+7 (495) 000-11-22", email: "mailto:petrov@demo-lab.test",
    };
    await handleUpdate(deps, msg(text1));
    assert.ok(sent.some((c) => c.params.text === "⏳ Разбираю заявку…"));
    const reply1 = sent.at(-1)!;
    assert.equal(reply1.method, "editMessageText");
    assert.match(last(), /✅ Лид <b>BARS-\d+<\/b>/);
    assert.match(last(), /ООО «Демо Энерголаб»<\/b> \(новый\)/);
    assert.match(last(), /Тип: Выкуп в КНР \/ агент/);
    const undo1 = (reply1.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0].callback_data;
    const key1 = /BARS-\d+/.exec(last())![0];
    const deal1 = (await call(s, "GET", `/deals/${key1}`)).json().deal;
    assert.equal(deal1.source, "telegram");
    assert.deepEqual(deal1.labels, ["Выкуп в КНР / агент"]);
    assert.equal(deal1.assigneeId, 1);
    assert.match(deal1.description, /Оплата в ВТБ Шанхай[\s\S]*Текст заявки \(Telegram, Админ\)[\s\S]*Демо-заявка 1/);
    const [client] = await db.select().from(cpTable).where(eq(cpTable.id, deal1.clientId));
    assert.equal(client.role, "client");
    assert.equal(client.phone, "8 800 000-00-00");
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal1.contactId));
    assert.deepEqual([contact.name, contact.email, contact.isPrimary], ["Петров Пётр", "petrov@demo-lab.test", true]);

    // Тот же текст ещё раз — не дублируем.
    await handleUpdate(deps, msg(text1));
    assert.match(last(), new RegExp(`уже в воронке: <b>${key1}`));

    // Заявка 2: другой человек с той же корпоративной почтой — тот же клиент, новый контакт.
    const text2 = "Демо-заявка 2: нужна искусственная трава 35 мм\nДва контейнера, доставка в Казань. Иванова Анна";
    drafts["Демо-заявка 2: нужна искусственная трава 35 мм"] = { title: "Искусственная трава 35 мм, 2 контейнера", type: "turnkey", companyName: "Энерголаб", contactName: "Иванова Анна", email: "ivanova@demo-lab.test" };
    await handleUpdate(deps, msg(text2));
    assert.match(last(), /уже в базе, нашёл по почте|уже в базе, нашёл по домену почты/);
    const deal2 = (await call(s, "GET", `/deals/${/BARS-\d+/.exec(last())![0]}`)).json().deal;
    assert.equal(deal2.clientId, deal1.clientId);
    assert.notEqual(deal2.contactId, deal1.contactId);
    const undo2 = (sent.at(-1)!.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0].callback_data;

    // Заявка 3: только телефон в другом формате — клиент и контакт найдены по телефону.
    const text3 = "Демо-заявка 3: повторный заказ плинтуса\nПозвоните, 8 495 000 11 22";
    drafts["Демо-заявка 3: повторный заказ плинтуса"] = { title: "Плинтус, повторный заказ", type: "turnkey", phone: "8 495 000 11 22" };
    await handleUpdate(deps, msg(text3));
    assert.match(last(), /нашёл по телефону/);
    const deal3 = (await call(s, "GET", `/deals/${/BARS-\d+/.exec(last())![0]}`)).json().deal;
    assert.deepEqual([deal3.clientId, deal3.contactId], [deal1.clientId, deal1.contactId]);
    const undo3 = (sent.at(-1)!.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0].callback_data;

    // «Отменить»: чужой Telegram — нет доступа; свой — лид удалён, новые клиент / контакт — если больше не нужны.
    const press = (data: string, from = TG) => handleUpdate(deps, { update_id: 2, callback_query: { id: "cb", from: { id: from }, data, message: { message_id: 7, chat: { id: from } } } });
    await press(undo1, 999);
    assert.equal(sent.at(-1)!.params.text, "Нет доступа");
    await press(undo3);
    assert.match(String(sent.at(-1)!.params.text), /Отменено: лид BARS-\d+ удалён\.$/);
    await press(undo2);
    assert.match(String(sent.at(-1)!.params.text), /удалены контакт «Иванова Анна»/);
    await press(undo1);
    assert.match(String(sent.at(-1)!.params.text), /удалены клиент «ООО «Демо Энерголаб»»/);
    assert.equal((await db.select().from(cpTable).where(eq(cpTable.id, deal1.clientId))).length, 0);
    assert.equal((await db.select().from(dealsTable).where(eq(dealsTable.source, "telegram"))).length, 0);
    await press(undo1);
    assert.equal(sent.at(-1)!.params.text, "Лид уже удалён");

    // Отвязка из профиля — бот снова не пускает.
    assert.equal((await call(s, "DELETE", "/auth/telegram")).statusCode, 200);
    await handleUpdate(deps, msg(text2));
    assert.match(last(), /для сотрудников/);
  });
});

describe("Импорт заявок по токену", () => {
  test("токен, пробный режим без записи, создание, этап, дубль", async () => {
    const post = (payload: unknown, token = "test-intake-token-0123456789abcdef") =>
      app.inject({ method: "POST", url: `${API}/intake/leads`, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
    const text = "Демо-импорт: сертификация ручных кофемолок для Ozon\nНужны образцы из Китая, испытания и декларация.";
    const lead = { text, title: "Сертификация ручных кофемолок (Ozon)", type: "certification", summary: "Образцы из Китая, испытания, декларация.", contactName: "Демо Покупатель", messenger: "telegram", messengerHandle: "@demo_buyer", stage: "offer" };

    assert.equal((await post({ leads: [lead] }, "wrong-token-wrong-token-wrong")).statusCode, 401);
    assert.equal((await post({ leads: [] })).statusCode, 400);

    const dry = await post({ dryRun: true, leads: [lead] });
    assert.equal(dry.statusCode, 200, dry.body);
    assert.equal(dry.json().results[0].status, "would_create");
    const { deals: dealsTable } = await import("../db/schema.ts");
    const { eq } = await import("drizzle-orm");
    assert.equal((await db.select().from(dealsTable).where(eq(dealsTable.source, "intake"))).length, 0, "пробный режим ничего не пишет");

    const res = (await post({ assignee: "admin", leads: [lead] })).json();
    assert.equal(res.results[0].status, "created");
    const created = res.results[0].lead;
    assert.equal(created.client.isNew, true);
    assert.equal(created.client.name, "Демо Покупатель");
    const s = await adminSession();
    const deal = (await call(s, "GET", `/deals/${created.deal.key}`)).json().deal;
    assert.deepEqual([deal.source, deal.statusKey, deal.labels[0], deal.assigneeId], ["intake", "offer", "Сертификация", 1]);
    assert.match(deal.description, /Текст заявки \(импорт заявок, Админ\)/);

    assert.equal((await post({ leads: [lead] })).json().results[0].status, "duplicate");
  });
});

const lg = await import("../../shared/leadgen.ts");
const { runJob } = await import("../lib/leadgen/job.ts");
const { parseCheckoContacts, parseDadata } = await import("../lib/leadgen/registry.ts");
const { extractContacts } = await import("../lib/leadgen/site.ts");
const { parseProducts, parseCardCountry } = await import("../lib/leadgen/wb.ts");
const { redact } = await import("../lib/leadgen/http.ts");
const schema = await import("../db/schema.ts");
const { eq, and } = await import("drizzle-orm");

describe("Лидогенерация WB", () => {

  /** Вымышленный ИНН с верными контрольными цифрами: 10 цифр — организация, 12 — ИП. */
  const makeInn = (seed: number, ip = false) => {
    const d = [...String((ip ? 77_0000_0000 : 7_7000_0000) + seed)].map(Number);
    const ck = (w: number[]) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
    if (!ip) return [...d, ck([2, 4, 10, 3, 5, 9, 4, 6, 8])].join("");
    d.push(ck([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]));
    d.push(ck([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]));
    return d.join("");
  };
  const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  /**
   * Вымышленный «WB» и реестры. Тип продавца — по последней цифре supplierId:
   * 1 — иностранный (без ИНН), 2 — мало SKU, 3 — Китай 30 %, 4 — моложе года, 5 — ликвидируется, 6 — без контактов,
   * 7 — email только с сайта, 8 — второй кабинет ИНН продавца sid−1, 0 — ИП, 9 и 0 — обычные (9 — email от WB).
   */
  type Call = { kind: string; arg: string };
  function fakeWorld(categories: { id: number; queries: string[]; stopWords: string[] }[], hooks: { onCall?: (c: Call, n: number) => Promise<void> } = {}) {
    const calls: Call[] = [];
    const log = async (kind: string, arg: string) => {
      const c = { kind, arg };
      calls.push(c);
      await hooks.onCall?.(c, calls.filter((x) => x.kind === kind).length);
    };
    const type = (sid: number) => sid % 10;
    const innOf = (sid: number): string => (type(sid) === 1 ? "" : type(sid) === 8 ? innOf(sid - 1) : makeInn(sid, type(sid) === 0));
    const make: import("../lib/leadgen/job.ts").MakeSources = () => ({
      async search(query, page) {
        await log("search", `${query}#${page}`);
        const ci = categories.findIndex((c) => c.queries.includes(query));
        if (ci < 0 || page > 3) return [];
        const qi = categories[ci].queries.indexOf(query);
        return Array.from({ length: 40 }, (_, k) => {
          const sid = (ci + 1) * 1000 + ((qi * 37 + page * 13 + k * 7) % 200) + 1;
          const stop = k % 9 === 0 && categories[ci].stopWords[0];
          return { nm: sid * 1000 + 500 + ((qi * 3 + page + k) % 400), name: `${stop ? `${stop} ` : ""}Товар ${query} демо, 30 см`, brand: `DemoBrand${sid}`, supplierId: sid, supplier: "", feedbacks: 10 };
        });
      },
      async sellerInfo(sid) {
        await log("sellerInfo", String(sid));
        return { supplierId: sid, name: `ООО «Демо ${sid}»`, fullName: "", inn: innOf(sid), ogrn: "", trademark: `DemoBrand${sid}`, address: "", emails: type(sid) === 9 ? [`WB${sid}@mail.ru`] : [], phones: [] };
      },
      async sellerCatalog(sid, page) {
        await log("catalog", `${sid}#${page}`);
        return { total: type(sid) === 2 ? 20 : 300, products: page > 1 ? [] : Array.from({ length: 100 }, (_, i) => ({ nm: sid * 1000 + i, name: `Товар ${i}`, brand: `DemoBrand${sid}`, supplierId: sid, supplier: "", feedbacks: 50 })) };
      },
      async sellerFeedbacks(sid) {
        await log("feedbacks", String(sid));
        return 5000;
      },
      async cardCountry(nm) {
        const sid = Math.floor(nm / 1000);
        return type(sid) === 3 ? (nm % 10 < 3 ? "Китай" : "Россия") : nm % 10 < 9 ? "Китай" : "Россия";
      },
      productUrl: (nm) => `https://www.wildberries.ru/catalog/${nm}/detail.aspx`,
      async dadata(inn) {
        await log("dadata", inn);
        const sid = Number(inn.slice(inn.length === 12 ? 6 : 5, inn.length === 12 ? 11 : 9));
        const t = type(sid);
        return { kind: inn.length === 12 ? "ip" : "ul", legalName: `ООО «Демо ${sid}»`, ogrn: "1027700000000", status: t === 5 ? "LIQUIDATING" : "ACTIVE", regDate: t === 4 ? "2026-09-01" : "2019-05-10", managerName: "Демо Иван Петрович", managerPost: "Генеральный директор", okved: "47.91", address: "г. Москва", region: "г Москва" };
      },
      checko: async (inn) => {
        await log("checko", inn);
        const sid = Number(inn.slice(inn.length === 12 ? 6 : 5, inn.length === 12 ? 11 : 9));
        const t = type(sid);
        if (t === 6) return { phones: ["+7 (999) ***-**-12"], emails: [], sites: [] };
        if (t === 7) return { phones: [], emails: [], sites: [`shop-${sid}.ru`] };
        return { phones: [`8 (495) ${String(sid).padStart(3, "0").slice(-3)}-45-67`, "+7 (999) ***-**-12"], emails: [`Info@Seller${sid}.RU`, "x@bad.example"], sites: [] };
      },
      async site(url) {
        await log("site", url);
        return { phones: [], emails: [`sales@${new URL(url).hostname}`], sites: [] };
      },
      mx: async (domain) => !domain.endsWith("bad.example"),
      counts: () => ({ wb: calls.filter((c) => ["search", "sellerInfo", "catalog", "feedbacks"].includes(c.kind)).length, dadata: calls.filter((c) => c.kind === "dadata").length, checko: calls.filter((c) => c.kind === "checko").length, site: calls.filter((c) => c.kind === "site").length }),
    });
    return { calls, make };
  }

  test("чистые функции: телефоны, email, ИНН, первая строка, раскладка, разбор ответов", () => {
    assert.equal(lg.normalizePhone("8 (495) 123-45-67"), "+74951234567");
    assert.equal(lg.normalizePhone("+7 999 123 45 67 доб. 12"), "+79991234567");
    assert.equal(lg.normalizePhone("+7 (999) ***-**-12"), null, "маска — не телефон");
    assert.equal(lg.normalizePhone("+86 138 0013 8000"), null);
    assert.equal(lg.normalizeEmail(" Info@Example.RU. "), "info@example.ru");
    assert.equal(lg.innKind(makeInn(12345)), "ul");
    assert.equal(lg.innKind(makeInn(12345, true)), "ip");
    assert.equal(lg.innKind("7700000001"), null);
    assert.equal(lg.shortProduct("Сковорода антипригарная 28 см с крышкой, Tefal", "Tefal"), "сковорода антипригарная");
    assert.match(lg.renderFirstLine(lg.TEMPLATE_PLAIN, { brand: "Demo", product: "гантели" }), /^Видел ваши гантели под брендом Demo на WB\./);
    const days = lg.planDays(65, "2027-03-06", { ...lg.DEFAULT_LEADGEN_SETTINGS }); // суббота → с понедельника
    assert.deepEqual([days[0], days[29], days[30], days[64]], ["2027-03-08", "2027-03-08", "2027-03-09", "2027-03-10"]);
    assert.deepEqual(lg.interleave([[1, 2], [3], [4, 5, 6]]), [1, 3, 4, 2, 5, 6]);
    assert.equal(redact("https://api.checko.ru/v2/company?key=SECRET&inn=1"), "https://api.checko.ru/v2/company?key=***&inn=1");

    assert.deepEqual(parseProducts({ products: [{ id: 5, name: "a", brand: "b", supplierId: 7, feedbacks: 3 }], total: 9 }), { products: [{ nm: 5, name: "a", brand: "b", supplierId: 7, supplier: "", feedbacks: 3 }], total: 9 });
    assert.equal(parseProducts({ data: { products: [{ id: 1, nmFeedbacks: 4 }] } }).products[0].feedbacks, 4);
    assert.equal(parseCardCountry({ options: [{ name: "Страна производства", value: "Китай" }] }, "Страна производства"), "Китай");
    const ck = parseCheckoContacts({ data: { Контакты: { Тел: ["+7 495 111-22-33"], Емэйл: ["a@b.ru"], ВебСайт: "b.ru", Телеграм: "https://t.me/demo" } }, meta: { status: "ok" } });
    assert.deepEqual(ck, { phones: ["+7 495 111-22-33"], emails: ["a@b.ru"], sites: ["b.ru"] });
    const dd = parseDadata({ suggestions: [{ value: "ООО «Демо»", data: { type: "LEGAL", ogrn: "1", state: { status: "ACTIVE", registration_date: Date.UTC(2020, 0, 15) }, management: { name: "Демо И.", post: "ДИРЕКТОР" }, okved: "47.91", address: { value: "г Москва", data: { region_with_type: "г Москва" } }, name: { short_with_opf: "ООО \"Демо\"" } } }] });
    assert.deepEqual([dd?.kind, dd?.regDate, dd?.managerName, dd?.region], ["ul", "2020-01-15", "Демо И.", "г Москва"]);
    const site = extractContacts(`<a href="tel:+7 (812) 555-66-77">звоните</a> <p>Почта: sales&#64;demo-shop.ru, logo@2x.png</p>`);
    assert.deepEqual(site, { emails: ["sales@demo-shop.ru"], phones: ["+7 (812) 555-66-77"] });
  });

  test("доступ: только с правом «Лидогенерация»", async () => {
    const admin = await adminSession();
    const created = await call(admin, "POST", "/users", { login: "lgmanager", name: "Лид Менеджер", role: "manager", password: "managerpass" });
    assert.equal(created.statusCode, 200, created.body);
    const m = await login("lgmanager", "managerpass", "10.0.0.77");
    assert.equal((await call(m, "GET", "/leadgen/categories")).statusCode, 403);
    assert.equal((await call(admin, "PATCH", `/users/${created.json().user.id}`, { permissions: ["leadgen", "unknown"] })).json().user.permissions.join(), "leadgen");
    const me = (await call(m, "GET", "/auth/me")).json().user;
    assert.deepEqual(me.permissions, ["leadgen"]);
    const cats = await call(m, "GET", "/leadgen/categories");
    assert.equal(cats.statusCode, 200);
    assert.equal(cats.json().categories.length, 6, "6 категорий засеяны миграцией");
    assert.ok(cats.json().categories.every((c: { quota: number; queries: string[] }) => c.quota === 150 && c.queries.length >= 6));
  });

  test("сбор в базу без отсева, остановки, отбор в работу по фильтру, повторные сбор и отбор, «Сегодня», статусы, итоги, экспорт", async () => {
    const s = await adminSession();
    const cats = (await call(s, "GET", "/leadgen/categories")).json().categories as { id: number; name: string; queries: string[]; stopWords: string[] }[];

    // Сбор 1 — с сервера (в тесте), с остановками посреди выдачи и посреди реквизитов.
    const started = await call(s, "POST", "/leadgen/jobs", { month: "2027-03", source: "direct" });
    assert.equal(started.statusCode, 200, started.body);
    const job1 = started.json().job.id as number;
    assert.equal((await call(s, "POST", "/leadgen/jobs", { month: "2027-04" })).statusCode, 409, "второй сбор, пока первый не закончен, — нельзя");
    const stopAt = (jobId: number, kind: string, n: number) => async (c: Call, count: number) => {
      if (c.kind === kind && count === n) await call(s, "POST", `/leadgen/jobs/${jobId}/stop`);
    };
    const w1 = fakeWorld(cats, { onCall: stopAt(job1, "search", 20) });
    assert.equal(await runJob(job1, w1.make, { rnd: lcg(1), today: "2026-11-04" }), "paused");
    const done1 = new Set(w1.calls.filter((c) => c.kind === "search").map((c) => c.arg));
    assert.equal((await call(s, "POST", `/leadgen/jobs/${job1}/resume`)).statusCode, 200);
    const w2 = fakeWorld(cats, { onCall: stopAt(job1, "dadata", 7) });
    assert.equal(await runJob(job1, w2.make, { rnd: lcg(2), today: "2026-11-04" }), "paused");
    assert.ok(w2.calls.filter((c) => c.kind === "search").every((c) => !done1.has(c.arg)), "страницы выдачи не запрашиваются повторно");
    await call(s, "POST", `/leadgen/jobs/${job1}/resume`);
    const w3 = fakeWorld(cats);
    assert.equal(await runJob(job1, w3.make, { rnd: lcg(3), today: "2026-11-04" }), "done");
    assert.equal(w3.calls.filter((c) => c.kind === "search").length, 0, "после выдачи поиск больше не нужен");
    const dadataInns = [...w2.calls, ...w3.calls].filter((c) => c.kind === "dadata").map((c) => c.arg);
    assert.equal(new Set(dadataInns).size, dadataInns.length, "ни один ИНН не проверен в DaData дважды");
    assert.equal([...w1.calls, ...w2.calls, ...w3.calls].filter((c) => c.kind === "checko" || c.kind === "catalog").length, 0, "при сборе Checko и каталог продавца не нужны");

    const candidates = await db.select().from(schema.leadCandidates).where(eq(schema.leadCandidates.jobId, job1));
    const stops = cats.flatMap((c) => c.stopWords.map((w) => w.toLowerCase()));
    assert.ok(candidates.every((c) => c.products.every((p) => !stops.some((w) => p.name.toLowerCase().includes(w)))), "товары со стоп-словами отброшены");
    assert.ok(candidates.every((c) => ["in_base", "merged", "no_inn"].includes(c.status)), "все кандидаты обработаны");
    const inBase = candidates.filter((c) => c.status === "in_base").length;
    assert.ok(candidates.some((c) => c.status === "merged" && c.reason === "дубль: другая категория или кабинет"), "второй кабинет ИНН склеен");

    const job = (await call(s, "GET", "/leadgen/jobs")).json().jobs.find((j: { id: number }) => j.id === job1);
    assert.deepEqual([job.status, job.stage, job.kind], ["done", "done", "collect"]);
    assert.ok(job.progress.categories[cats[0].id].rejected["нет российского ИНН"] > 0);
    assert.equal(cats.reduce((n, c) => n + job.progress.categories[c.id].passed, 0), inBase);

    // В базе — все с российским ИНН, без отсева: и молодые, и ликвидируемые; контакты Checko не запрашивались.
    const base = (await call(s, "GET", "/leadgen/sellers?month=2027-03&limit=500")).json();
    assert.equal(base.total, inBase);
    assert.ok(base.total > 100);
    assert.ok(base.sellers.every((x: { inn: string; pickedAt: string | null; contactsStatus: string | null }) => lg.innKind(x.inn) && x.pickedAt === null && x.contactsStatus === null));
    assert.ok(base.sellers.some((x: { egrStatus: string }) => x.egrStatus === "LIQUIDATING"));
    assert.ok(base.sellers.some((x: { regDate: string }) => x.regDate === "2026-09-01"));
    assert.ok(base.sellers.every((x: { contacts: { source: string }[] }) => x.contacts.every((c) => c.source === "wb")), "при сборе — только контакты из профиля WB");
    assert.ok(base.sellers.some((x: { contacts: unknown[] }) => x.contacts.length > 0));
    for (const seller of base.sellers.slice(0, 20)) {
      assert.ok(seller.feedbacksTotal === 5000 && seller.managerName && seller.products.length >= 1 && seller.products[0].url.includes("wildberries.ru/catalog/"));
      assert.match(seller.firstLine, /^Видел ваши .+ под брендом DemoBrand\d+ на WB\./);
    }

    // Фильтры базы: отзывы, возраст, действующие.
    const filter = { fbMin: "1000", fbMax: "50000", age: "12", active: "1" };
    const qs = new URLSearchParams(filter).toString();
    const filtered = (await call(s, "GET", `/leadgen/sellers?${qs}&limit=500`)).json();
    assert.ok(filtered.total < base.total && filtered.sellers.every((x: { egrStatus: string; regDate: string }) => x.egrStatus === "ACTIVE" && x.regDate <= "2025-11-04"));
    const preview = (await call(s, "GET", `/leadgen/pick/preview?${qs}`)).json().available;
    assert.equal(Object.values(preview as Record<string, number>).reduce((a, b) => a + b, 0), filtered.total);

    // Отбор в работу: 10 на категорию по фильтру; контакты Checko / сайт — только здесь.
    const pick1 = (await call(s, "POST", "/leadgen/pick", { filter, perCategory: 10 })).json().job.id as number;
    const wp = fakeWorld(cats, { onCall: stopAt(pick1, "checko", 15) });
    assert.equal(await runJob(pick1, wp.make, { rnd: lcg(4), today: "2026-11-04" }), "paused");
    await call(s, "POST", `/leadgen/jobs/${pick1}/resume`);
    const wp2 = fakeWorld(cats);
    assert.equal(await runJob(pick1, wp2.make, { rnd: lcg(5), today: "2026-11-04" }), "done");
    const checkoInns = [...wp.calls, ...wp2.calls].filter((c) => c.kind === "checko").map((c) => c.arg);
    assert.equal(new Set(checkoInns).size, checkoInns.length, "Checko по одному ИНН — один раз");
    assert.equal(wp2.calls.filter((c) => c.kind === "dadata" || c.kind === "search").length, 0);

    const work1 = (await call(s, "GET", "/leadgen/sellers?work=1&limit=500")).json();
    assert.equal(work1.total, 60);
    for (const seller of work1.sellers) {
      assert.equal(seller.egrStatus, "ACTIVE");
      assert.ok(seller.regDate <= "2025-11-04");
      assert.equal(seller.contactsStatus, "found");
      assert.ok(seller.contacts.some((c: { type: string; valid: boolean }) => c.type === "phone" || (c.type === "email" && c.valid)), "есть рабочий контакт");
      for (const c of seller.contacts) {
        assert.ok(["wb", "checko", "site"].includes(c.source), "источник контакта");
        if (c.type === "phone") assert.match(c.value, /^\+7\d{10}$/, "полный номер без маски");
        if (c.type === "email") assert.equal(c.value, c.value.toLowerCase());
      }
    }
    const bad = work1.sellers.flatMap((x: { contacts: { value: string; valid: boolean; note: string }[] }) => x.contacts).find((c: { value: string }) => c.value === "x@bad.example");
    assert.deepEqual([bad?.valid, bad?.note], [false, "у домена нет MX"], "невалидный email хранится с пометкой");
    assert.ok(work1.sellers.some((x: { contacts: { source: string }[] }) => x.contacts.some((c) => c.source === "site")), "email с сайта");
    const none = (await call(s, "GET", "/leadgen/sellers?contacts=none&limit=500")).json();
    assert.ok(none.total > 0 && none.sellers.every((x: { pickedAt: string | null }) => x.pickedAt === null), "без контактов — пометка, в работу не взяты");
    const pj = (await call(s, "GET", "/leadgen/jobs")).json().jobs.find((j: { id: number }) => j.id === pick1);
    assert.equal(pj.kind, "pick");
    for (const c of cats) assert.equal(pj.progress.categories[c.id].selected, 10, c.name);
    assert.deepEqual(pj.progress.scheduled, { sellers: 60, from: "2026-11-04", to: "2026-11-05" });

    // Сбор 2 — те же продавцы: не дублируются, лишь «уже в базе».
    const job2 = (await call(s, "POST", "/leadgen/jobs", { month: "2027-04", source: "direct" })).json().job.id as number;
    assert.equal(await runJob(job2, fakeWorld(cats).make, { rnd: lcg(6), today: "2026-11-04" }), "done");
    assert.equal((await call(s, "GET", "/leadgen/sellers?limit=1")).json().total, base.total, "ИНН не дублируются");
    const c2 = await db.select().from(schema.leadCandidates).where(eq(schema.leadCandidates.jobId, job2));
    assert.ok(c2.filter((c) => c.status !== "no_inn").every((c) => c.status === "merged"));
    // Отбор 2 — без уже взятых в работу; раскладка — после первого отбора.
    const pick2 = (await call(s, "POST", "/leadgen/pick", { filter, perCategory: 10 })).json().job.id as number;
    assert.equal(await runJob(pick2, fakeWorld(cats).make, { rnd: lcg(7), today: "2026-11-04" }), "done");
    const work2 = (await call(s, "GET", "/leadgen/sellers?work=1&limit=500")).json();
    assert.equal(work2.total, 120);
    assert.equal(new Set(work2.sellers.map((x: { inn: string }) => x.inn)).size, 120, "второй отбор не повторяет первый");
    const pj2 = (await call(s, "GET", "/leadgen/jobs")).json().jobs.find((j: { id: number }) => j.id === pick2);
    assert.deepEqual(pj2.progress.scheduled, { sellers: 60, from: "2026-11-06", to: "2026-11-09" });

    // «Сегодня»: 30 продавцов, по 5 из каждой категории.
    const today = (await call(s, "GET", "/leadgen/today?day=2026-11-04")).json();
    assert.equal(today.first.length, 30);
    const perCat = new Map<number, number>();
    for (const it of today.first) perCat.set(it.categoryId, (perCat.get(it.categoryId) ?? 0) + 1);
    assert.deepEqual([...perCat.values()], [5, 5, 5, 5, 5, 5]);
    assert.notEqual(today.first[0].categoryId, today.first[1].categoryId, "категории вперемешку");

    // Совместимость: повтор через 4 дня при явном включении; ответ снимает повтор.
    process.env.MAIL_FOLLOWUPS_ENABLED = "true";
    const inn = today.first[0].inn as string;
    const { setSellerStatus, todayList, getLeadgenSettings } = await import("../lib/leadgen/work.ts");
    const settings = await getLeadgenSettings(db);
    await db.transaction((tx) => setSellerStatus(tx, inn, "sent", 1, null, settings, new Date("2026-11-04T10:00:00Z")));
    const inn2 = today.first[1].inn as string;
    assert.equal((await call(s, "POST", `/leadgen/sellers/${inn2}/status`, { status: "bounced", comment: "адрес не существует" })).statusCode, 200);
    const later = await todayList(db, "2026-11-09", settings);
    assert.ok(later.followups.some((f) => f.inn === inn), "повтор — через 4 дня, на ближайший рабочий");
    assert.ok(!(await todayList(db, "2026-11-06", settings)).followups.some((f) => f.inn === inn), "раньше — нет");
    await db.transaction((tx) => setSellerStatus(tx, inn, "followup_sent", 1, null, settings, new Date("2026-11-09T10:00:00Z")));
    const answered = await call(s, "POST", `/leadgen/sellers/${inn}/status`, { status: "replied_pos", comment: "интересно" });
    assert.deepEqual(answered.json().events.map((e: { type: string }) => e.type).sort(), ["followup_sent", "replied_pos", "sent"]);
    assert.ok(answered.json().queue.every((q: { status: string }) => q.status !== "planned"), "после ответа касаний в плане нет");
    process.env.MAIL_FOLLOWUPS_ENABLED = "false";

    // Итоги — по взятым в работу.
    const st = (await call(s, "GET", "/leadgen/stats?month=2027-03")).json().rows as { categoryId: number; sellers: number; sent: number; bounced: number; replies: number; positive: number; positivePct: number }[];
    assert.equal(st.reduce((a, r) => a + r.sellers, 0), 120);
    const cat0 = st.find((r) => r.categoryId === today.first[0].categoryId)!;
    assert.deepEqual([cat0.sent, cat0.replies, cat0.positive, cat0.positivePct], [1, 1, 1, 100]);
    assert.equal(st.reduce((a, r) => a + r.bounced, 0), 1);

    // Экспорт: вся база по фильтру, все поля и все контакты.
    const csv = await call(s, "GET", "/leadgen/export.csv?month=2027-03");
    assert.equal(csv.statusCode, 200);
    const lines = csv.body.replace(/^\ufeff/, "").trim().split("\r\n");
    assert.equal(lines.length, base.total + 1);
    assert.match(lines[0], /^ИНН;Юрназвание;Тип;ОГРН/);
    const workCsv = (await call(s, "GET", "/leadgen/export.csv?work=1")).body.replace(/^\ufeff/, "").trim().split("\r\n");
    assert.equal(workCsv.length, 121);
    assert.ok(workCsv.slice(1).every((l) => /\+7\d{10}|@/.test(l)));
    const xlsx = await call(s, "GET", "/leadgen/export.xlsx?work=1");
    assert.equal(xlsx.statusCode, 200);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(xlsx.rawPayload);
    assert.match(await zip.file("xl/workbook.xml")!.async("string"), /Продавцы.*Контакты/);
    assert.equal(((await zip.file("xl/worksheets/sheet1.xml")!.async("string")).match(/<row /g) ?? []).length, 121);
    assert.equal((await call(s, "GET", "/leadgen/sellers?status=replied_pos")).json().total, 1);
  });
  test("сбор через расширение в браузере: ключ, задания, выдача прокруткой, дальше — сервер", async () => {
    const s = await adminSession();
    const cats = (await call(s, "GET", "/leadgen/categories")).json().categories as { id: number; name: string; queries: string[]; stopWords: string[] }[];
    const { setCardResolver } = await import("../lib/leadgen/collector.ts");
    const collector = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
      app.inject({ method, url: `${API}${url}`, headers: { authorization: `Bearer ${token}`, origin: "chrome-extension://abcdef" }, ...(payload ? { payload: payload as object } : {}) });

    assert.equal((await collector("GET", "/leadgen/collector/next", "irbis_wrong")).statusCode, 401, "без ключа — нельзя");
    const token = (await call(s, "POST", "/leadgen/collector/token")).json().token as string;
    assert.match(token, /^irbis_[0-9a-f]{48}$/);
    assert.equal((await collector("GET", "/leadgen/collector/next", token)).json().task.type, "idle", "сбора нет — ждём");

    const jobId = (await call(s, "POST", "/leadgen/jobs", { month: "2027-05" })).json().job.id as number;
    const world = fakeWorld(cats);
    const sources = world.make(lg.DEFAULT_LEADGEN_SETTINGS, () => false, () => {});
    // Сервер для режима браузера сам WB не ищет.
    const serverOnly: typeof world.make = (...a) => ({ ...world.make(...a), search: async () => assert.fail("поиск — только из браузера") });
    assert.equal(await runJob(jobId, serverOnly, { rnd: lcg(5), today: "2026-11-04" }), "collecting");

    let searches = 0;
    let usedItems = false;
    setCardResolver(async (nm) => ({ nm, name: `Товар ${nm}`, brand: `DemoBrand${Math.floor(nm / 1000)}`, supplierId: Math.floor(nm / 1000), supplier: "", feedbacks: 0 }));
    for (let guard = 0; guard < 500; guard++) {
      const job = (await call(s, "GET", "/leadgen/jobs")).json().jobs.find((j: { id: number }) => j.id === jobId);
      if (job.status === "done") break;
      if (job.status === "queued") {
        assert.equal(job.stage, "enrich");
        assert.equal(await runJob(jobId, serverOnly, { rnd: lcg(6), today: "2026-11-04" }), "done");
        continue;
      }
      const task = (await collector("GET", "/leadgen/collector/next", token)).json().task;
      if (task.type === "idle") continue;
      assert.equal(task.type, "search", "страницы продавцов больше не открываются");
      searches++;
      // WB не листает по ?page=N: одна страница на запрос, расширение прокручивает её.
      assert.ok(task.url.startsWith("https://www.wildberries.ru/catalog/0/search.aspx?sort=popular&search=") && !task.url.includes("page="));
      assert.equal(task.want, lg.DEFAULT_LEADGEN_SETTINGS.browserProducts);
      const products = [...(await sources.search(task.query, 1)), ...(await sources.search(task.query, 2)), ...(await sources.search(task.query, 3))];
      let payload: Record<string, unknown>;
      if (!usedItems && products.length) {
        // Как присылает расширение: артикулы со страницы; продавца сервер берёт из карточки.
        usedItems = true;
        payload = { ...task, items: products.map((p) => ({ nm: p.nm, name: p.name })) };
      } else {
        payload = { ...task, data: { products: products.map((p) => ({ id: p.nm, name: p.name, brand: p.brand, supplierId: p.supplierId, feedbacks: p.feedbacks })) } };
      }
      const res = await collector("POST", "/leadgen/collector/result", token, payload);
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().ok, true, res.body);
      if (searches === 1) assert.equal((await collector("POST", "/leadgen/collector/result", token, payload)).json().ok, false, "повтор той же страницы не засчитывается");
    }
    setCardResolver(null);
    const job = (await call(s, "GET", "/leadgen/jobs")).json().jobs.find((j: { id: number }) => j.id === jobId);
    assert.equal(job.status, "done");
    assert.equal(searches, cats.reduce((n, c) => n + c.queries.length, 0), "один заход на поисковый запрос");
    const cands = await db.select().from(schema.leadCandidates).where(eq(schema.leadCandidates.jobId, jobId));
    assert.ok(cands.length > 0 && cands.every((c) => ["merged", "no_inn", "in_base"].includes(c.status)), "продавцы из браузера дополнены сервером");
    const status = (await call(s, "GET", "/leadgen/status")).json();
    assert.equal(status.collector.hasKey, true);
    assert.ok(status.collector.lastSeenAt);
    const ext = await call(s, "GET", "/leadgen/collector/extension.zip");
    assert.equal(ext.statusCode, 200);
    const JSZip = (await import("jszip")).default;
    const manifest = JSON.parse(await (await JSZip.loadAsync(ext.rawPayload)).file("irbis-wb-extension/manifest.json")!.async("string"));
    assert.equal(manifest.manifest_version, 3);
  });
});

const mailShared = await import("../../shared/mail.ts");
const { planDay } = await import("../lib/mail/planner.ts");
const { getDailyRun, startDailyRun } = await import("../lib/mail/runs.ts");
const { sendDue, sendOne, setTransportFactory } = await import("../lib/mail/sender.ts");
const { pollMailbox, setImapFetcher } = await import("../lib/mail/inbound.ts");
const { decryptSecret } = await import("../lib/mail/crypto.ts");

describe("Рассылка (этап 1)", () => {
  const lcgMail = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  test("чистые функции: варианты, имя и отчество, подстановки, запрет tlkbars.ru, окно, отказ", () => {
    const a = mailShared.spin("{Добрый день|Здравствуйте|Привет}, {brand}! {А|Б}", "7700000001:first");
    assert.deepEqual(a, mailShared.spin("{Добрый день|Здравствуйте|Привет}, {brand}! {А|Б}", "7700000001:first"), "тот же лид — тот же вариант");
    assert.match(a.text, /^(Добрый день|Здравствуйте|Привет), \{brand\}! (А|Б)$/);
    assert.equal(a.choices.length, 2);
    assert.equal(mailShared.namePatronymic("Иванов Иван Иванович"), "Иван Иванович");
    assert.equal(mailShared.namePatronymic("АЛИЕВ РАШИД ГЕЙДАР ОГЛЫ"), "Рашид Гейдар оглы");
    assert.equal(mailShared.namePatronymic("ООО Ромашка"), "");
    assert.equal(mailShared.namePatronymic("Smith John"), "");
    const vars = { name_patronymic: "", brand: "Demo", product: "гантели", product_accusative: "ваши гантели", category: "фитнес-инвентаря", marking_note: "", link: "https://x.ru/wb/f?l=abc", signature: "Иван", first_subject: "Тема" };
    assert.equal(mailShared.fillVars("Здравствуйте, {name_patronymic}!\n\nВидел ваши {product}. {marking_note} Ок.\n\n{signature}", vars), "Добрый день!\n\nВидел ваши гантели. Ок.\n\nИван");
    assert.equal(mailShared.fillVars("{name_patronymic}, напомню о себе.", vars), "Напомню о себе.");
    assert.equal(mailShared.productAccusative("душевая система черная"), "вашу душевую систему черную");
    assert.equal(mailShared.productAccusative("скамья спортивная"), "вашу скамью спортивную");
    assert.equal(mailShared.productAccusative("смеситель"), "ваш смеситель");
    assert.equal(mailShared.productAccusative("сетевое зарядное устройство"), "ваше сетевое зарядное устройство");
    assert.equal(mailShared.productAccusative("гантели"), "ваши гантели");
    assert.equal(mailShared.productAccusative("садовая мебель"), "вашу садовую мебель");
    for (const bad of ["см. tlkbars.ru", "https://www.tlkbars.ru/x", "пишите info@tlkbars.ru", "TLKBARS.RU"]) assert.equal(mailShared.mentionsMainDomain(bad), true, bad);
    for (const ok of ["https://tlkbars-import.ru/wb/", "ivan@tlkbars-import.ru", "mytlkbars.ru"]) assert.equal(mailShared.mentionsMainDomain(ok), false, ok);
    const start = Date.UTC(2026, 10, 6, 6, 30);
    const end = Date.UTC(2026, 10, 6, 14, 30);
    const times = mailShared.spreadTimes(30, start, end, { minGapMs: 4 * 60_000, jitter: 0.4, rnd: lcgMail(1) });
    assert.equal(times.length, 30);
    assert.ok(times.every((t, i) => t >= start && t < end && (i === 0 || t - times[i - 1] >= 4 * 60_000)));
    assert.equal(mailShared.spreadTimes(200, start, end, { minGapMs: 4 * 60_000, jitter: 0.4, rnd: lcgMail(2) }).length <= 120, true, "в окно 8 ч — не больше 120 писем с ящика");
    assert.equal(mailShared.zonedTime("2026-11-06", "09:30", "Europe/Moscow").toISOString(), "2026-11-06T06:30:00.000Z");
    assert.equal(mailShared.looksLikeRefusal("Нет, спасибо.\n> Видел ваши"), true);
    assert.equal(mailShared.looksLikeRefusal("Не актуально"), true);
    assert.equal(mailShared.looksLikeRefusal("Да, интересно, пришлите расчёт"), false);
    assert.deepEqual(mailShared.WARMUP_STAGE_LIMITS, [5, 10, 15, 20, 25]);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(mailShared.warmupStageLimit), [5, 10, 15, 20, 25, 25], "только ступени, без ежедневного +5");
    const eligible = { stage: 1, sendingDays: 5, sent: 25, recentErrors: 0, bounceRate: 0, ready: true, active: true };
    assert.equal(mailShared.warmupHoldReason(eligible), null);
    assert.match(mailShared.warmupHoldReason({ ...eligible, sendingDays: 4 })!, /5 фактических live-дней/);
    assert.match(mailShared.warmupHoldReason({ ...eligible, sent: 24 })!, /25 live-писем/);
    assert.match(mailShared.warmupHoldReason({ ...eligible, recentErrors: 1 })!, /последние три/);
    assert.match(mailShared.warmupHoldReason({ ...eligible, bounceRate: 0.031 })!, /выше допустимых 3%/);
    assert.match(mailShared.warmupHoldReason({ ...eligible, ready: false })!, /SMTP и IMAP/);
    assert.match(mailShared.warmupHoldReason({ ...eligible, active: false })!, /на паузе/);
    assert.equal(mailShared.warmupHoldReason({ ...eligible, stage: 5, sent: 0, sendingDays: 0 }), null);
    assert.deepEqual(mailShared.normalizeRunMailboxIds([3, "2", 3, -1, 0, "bad"]), [3, 2]);
    assert.equal(mailShared.MAX_MAILBOXES_PER_RUN, 30);
  });

  test("ящики, шаблоны, план дня, dry-run / test / live, цепочка, входящие, стоп-лист", async () => {
    const s = await adminSession();
    // Домен и ящик. tlkbars.ru — никогда.
    assert.equal((await call(s, "POST", "/mail/domains", { domain: "tlkbars.ru" })).statusCode, 400);
    assert.equal((await call(s, "POST", "/mail/domains", { domain: "mail.tlkbars.ru" })).statusCode, 400);
    const dom = await call(s, "POST", "/mail/domains", { domain: "tlkbars-import.ru" });
    assert.equal(dom.statusCode, 200, dom.body);
    const domainId = dom.json().domain.id as number;
    assert.equal(dom.json().domain.landingBaseUrl, "https://tlkbars-import.ru/wb/");
    const mb = await call(s, "POST", "/mail/mailboxes", { email: "ivan@tlkbars-import.ru", fromName: "Иван Демо", domainId, password: "app-pass-123", signature: "Иван Демо\nИмпорт из Китая", dailyLimit: 30, warmupStart: "2026-11-01" });
    assert.equal(mb.statusCode, 200, mb.body);
    const mailboxId = mb.json().mailbox.id as number;
    const [row] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
    assert.match(row.passwordEnc, /^v1:/);
    assert.ok(!row.passwordEnc.includes("app-pass-123"), "пароль хранится зашифрованным");
    assert.equal(decryptSecret(row.passwordEnc), "app-pass-123");
    assert.deepEqual([row.smtpHost, row.smtpPort, row.imapHost, row.imapPort, row.status], ["smtp.yandex.ru", 465, "imap.yandex.ru", 993, "warming"]);
    const st0 = (await call(s, "GET", "/mail/status")).json();
    assert.equal(st0.settings.mode, "dry_run", "по умолчанию — dry-run");
    assert.equal(st0.run, null, "без явного запуска рассылки нет");
    assert.ok(st0.mailboxes.length === 1 && !("passwordEnc" in st0.mailboxes[0]) && !JSON.stringify(st0).includes("app-pass"), "пароль наружу не отдаётся");
    assert.equal((await call(s, "PATCH", `/mail/mailboxes/${mailboxId}`, { signature: "сайт: tlkbars.ru" })).statusCode, 400, "подпись с tlkbars.ru — нельзя");
    assert.equal((await call(s, "POST", "/mail/templates", { touch: "first", subject: "Привет", body: "Наш сайт https://tlkbars.ru" })).statusCode, 400);
    assert.equal((await call(s, "POST", "/mail/templates", { touch: "first", subject: "Привет", body: "Здравствуйте, {name}" })).statusCode, 400, "неизвестная подстановка");
    assert.equal((await call(s, "POST", "/mail/templates/ai", { operation: "create", touch: "first" })).statusCode, 503, "без ключа ИИ-редактор выключен, шаблоны работают без него");
    assert.equal((await call(s, "GET", "/mail/templates")).json().templates.length, 3, "3 шаблона засеяны");

    // Проверка подключения (SMTP — подменён).
    const sent: { to: string; subject: string; text: string; messageId: string; inReplyTo?: string; references?: string; headers: Record<string, string> }[] = [];
    let smtpError: Error | null = null;
    setTransportFactory(() => ({
      async send(mail) {
        if (smtpError) throw smtpError;
        sent.push(mail);
        return { response: "250 ok" };
      },
      async verify() {},
    }));
    setImapFetcher(async () => ({ uidValidity: 1, lastUid: 0, messages: [] }));

    // Предпросмотр: подстановки, варианты и новый текст без ссылки.
    const queued = await db.execute<{ inn: string }>(sql`select q.seller_inn as inn from lead_queue q where q.status = 'planned' and q.touch = 'first' order by q.planned_date, q.position limit 1`);
    const inn0 = queued.rows[0].inn;
    const pv = (await call(s, "POST", "/mail/preview", { inn: inn0, mailboxId })).json();
    assert.equal(JSON.stringify(pv), JSON.stringify((await call(s, "POST", "/mail/preview", { inn: inn0, mailboxId })).json()), "повторный рендер — то же письмо");
    assert.ok(!/[{}]/.test(pv.subject + pv.body), "все подстановки и варианты раскрыты");
    assert.match(pv.body, /^(Добрый день|Здравствуйте), Иван Петрович!/);
    assert.match(pv.body, /Всю цепочку можно передать одной команде/);
    assert.match(pv.body, /под брендом .+ на WB/);
    assert.match(pv.body, /пришлите артикул WB и параметры типичной партии/);
    assert.ok(!pv.body.includes("https://"), "в новом первом письме нет ссылки");
    assert.match(pv.body, /Иван Демо\nИмпорт из Китая$/);
    assert.equal(pv.from, "Иван Демо <ivan@tlkbars-import.ru>");

    // Явный запуск дня с выбранным ящиком (пятница 06.11.2026, 10:00 МСК), особый лимит для расширенного сценария.
    const now = new Date("2026-11-06T07:00:00Z");
    assert.equal((await call(s, "POST", `/mail/mailboxes/${mailboxId}/limit-override`, { limit: 30, reason: "интеграционная проверка очереди" })).statusCode, 200);
    const { run, plan } = await startDailyRun(now, null, [mailboxId], { rnd: lcgMail(3) });
    assert.deepEqual(run.mailboxIds, [mailboxId]);
    assert.deepEqual((await getDailyRun(db, "2026-11-06"))?.mailboxIds, [mailboxId]);
    await assert.rejects(startDailyRun(now, null, [mailboxId]), /уже запущена/);
    await assert.rejects(startDailyRun(now, null, Array.from({ length: 31 }, (_, i) => i + 1)), /не больше 30/);
    assert.equal(plan.planned, 30);
    assert.ok(plan.deferred > 0 && plan.deferredTo === "2026-11-09", JSON.stringify(plan));
    assert.equal((await planDay(db, now, { rnd: lcgMail(4), mailboxIds: run.mailboxIds })).planned, 0, "повторный план не дублирует");
    const msgs = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.planDay, "2026-11-06")).orderBy(schema.mailMessages.scheduledAt);
    assert.equal(msgs.length, 30);
    assert.ok(msgs.every((m, i) => m.scheduledAt >= now && m.scheduledAt < new Date("2026-11-06T14:30:00Z") && (i === 0 || m.scheduledAt.getTime() - msgs[i - 1].scheduledAt.getTime() >= 4 * 60_000)), "в окне, не чаще раза в 4 минуты");
    assert.ok(msgs.every((m) => !/[{}]/.test(m.subject + m.body) && m.messageId.endsWith("@tlkbars-import.ru>") && m.templateId && m.templateVersion === 5));
    assert.ok(msgs.every((m) => m.variants.subject.length === 1 && m.variants.body.length >= 1), "выбранные варианты сохранены");

    // dry-run: журнал, без отправки. Пустой выбор ящиков запрещает отправку.
    assert.deepEqual(await sendDue(msgs[0].scheduledAt, []), []);
    const r1 = await sendDue(msgs[0].scheduledAt, run.mailboxIds);
    assert.deepEqual(r1.map((r) => r.status), ["dry_run"]);
    assert.equal(sent.length, 0);
    assert.deepEqual(await sendDue(new Date(msgs[0].scheduledAt.getTime() + 60_000)), [], "не чаще раза в 4 минуты");
    // test: на тестовый адрес, воронка не меняется.
    assert.equal((await call(s, "PUT", "/mail/settings", { mode: "test", testAddress: "QA@Example.org" })).statusCode, 200);
    const r2 = await sendDue(new Date(msgs[1].scheduledAt.getTime() + 5 * 60_000));
    assert.deepEqual(r2.map((r) => r.status), ["sent"]);
    assert.equal(sent.at(-1)!.to, "qa@example.org");
    assert.equal(sent.at(-1)!.headers["List-Unsubscribe"], "<mailto:ivan@tlkbars-import.ru?subject=unsubscribe>");
    const [seller1] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, msgs[1].sellerInn));
    assert.equal(seller1.status, "new", "в тесте статусы не меняются");

    // Совместимость старых повторов проверяем при явном включении; по умолчанию они выключены.
    process.env.MAIL_FOLLOWUPS_ENABLED = "true";
    await db.update(schema.mailTemplates).set({ active: true }).where(eq(schema.mailTemplates.touch, "followup"));
    // live: продавцам; до проверки агентом SMTP не вызывается, dry-run и test прогрев не продвигают.
    await call(s, "PUT", "/mail/settings", { mode: "live" });
    assert.match((await sendOne(msgs[8].id)).error ?? "", /проверки SMTP и IMAP/);
    assert.equal(sent.length, 1);
    await db.update(schema.mailboxes).set({ smtpVerifiedAt: now, imapVerifiedAt: now, warmupStageStartedAt: new Date("2026-11-06T06:00:00Z") }).where(eq(schema.mailboxes.id, mailboxId));
    const live = msgs.slice(2, 6);
    for (const m of live) assert.equal((await sendOne(m.id, new Date("2026-11-06T12:00:00Z"))).status, "sent");
    const warmupAfterOneDay = (await import("../lib/mail/warmup.ts")).warmupStats;
    assert.deepEqual([(await warmupAfterOneDay(db, mailboxId))!.sendingDays, (await warmupAfterOneDay(db, mailboxId))!.sent, (await warmupAfterOneDay(db, mailboxId))!.stage], [1, 4, 1]);
    const liveSent = sent.slice(-4);
    assert.deepEqual(liveSent.map((x) => x.to), live.map((m) => m.toEmail), "каждое — одному получателю, на его адрес");
    assert.ok(liveSent.every((x) => !x.inReplyTo));
    const [sA] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, live[0].sellerInn));
    assert.equal(sA.status, "sent");
    const fq = await db.select().from(schema.leadQueue).where(and(eq(schema.leadQueue.sellerInn, live[0].sellerInn), eq(schema.leadQueue.touch, "followup")));
    assert.deepEqual(fq.map((q) => [q.status, q.plannedDate]), [["planned", "2026-11-10"]], "повтор — через 4 дня, на рабочий");

    // tlkbars.ru в письме — отправка блокируется.
    await db.update(schema.mailMessages).set({ body: `${msgs[6].body}\nhttps://tlkbars.ru` }).where(eq(schema.mailMessages.id, msgs[6].id));
    const blocked = await sendOne(msgs[6].id);
    assert.equal(blocked.status, "failed");
    assert.equal(blocked.error, mailShared.MAIN_DOMAIN_ERROR);
    assert.equal(sent.length, 5, "письмо с tlkbars.ru не ушло");

    // Стоп-лист: продавцу с запланированным письмом — не пишем ни с какого ящика.
    assert.equal((await call(s, "POST", "/mail/stoplist", { inn: msgs[7].sellerInn, reason: "просил не писать" })).statusCode, 200);
    assert.equal((await sendOne(msgs[7].id)).status, "skipped", "запланированное письмо снято сразу");
    const [m7] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, msgs[7].id));
    assert.equal(m7.status, "cancelled");
    assert.ok((await call(s, "GET", "/mail/stoplist")).json().stoplist.some((x: { inn: string; email: string | null }) => x.inn === msgs[7].sellerInn && x.email), "в стоп-лист — ИНН и его email");

    // Повтор (вторник 10.11): с того же ящика, Re: <тема первого>, In-Reply-To / References — Message-ID первого.
    const plan2 = await planDay(db, new Date("2026-11-10T07:00:00Z"), { rnd: lcgMail(5) });
    assert.equal(plan2.followups, 4);
    assert.ok(!(await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.planDay, "2026-11-10"))).some((m) => m.sellerInn === msgs[7].sellerInn), "стоп-лист — не в плане");
    const fus = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.planDay, "2026-11-10"), eq(schema.mailMessages.touch, "followup")));
    for (const f of fus) {
      const first = live.find((m) => m.sellerInn === f.sellerInn)!;
      assert.equal(f.mailboxId, first.mailboxId);
      assert.equal(f.inReplyTo, first.messageId);
      assert.equal(f.subject, `Re: ${first.subject}`);
      assert.equal(f.toEmail, first.toEmail);
    }
    const fuA = fus.find((f) => f.sellerInn === live[0].sellerInn)!;
    assert.equal((await sendOne(fuA.id, new Date("2026-11-10T08:00:00Z"))).status, "sent");
    assert.deepEqual([sent.at(-1)!.inReplyTo, sent.at(-1)!.references], [live[0].messageId, live[0].messageId], "повтор — в той же цепочке");
    assert.equal((await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, live[0].sellerInn)))[0].status, "followup_sent");

    // Входящие (IMAP подменён): ответ человека, возврат, автоответ, неизвестный.
    const raw = (h: Record<string, string>, text: string) => Buffer.from(`${Object.entries({ "MIME-Version": "1.0", Date: "Tue, 10 Nov 2026 12:00:00 +0300", "Content-Type": "text/plain; charset=utf-8", ...h }).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${text}\r\n`);
    const [B, C, D] = live.slice(1, 4);
    const bounce = Buffer.from(
      [
        "From: Mail Delivery System <mailer-daemon@yandex.ru>",
        "To: ivan@tlkbars-import.ru",
        "Subject: Undelivered Mail Returned to Sender",
        "MIME-Version: 1.0",
        'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"',
        "",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `<${C.toEmail}>: host mx said: 550 5.1.1 User unknown`,
        "--b1",
        "Content-Type: message/delivery-status",
        "",
        "Reporting-MTA: dns; mx.yandex.ru",
        "",
        `Final-Recipient: rfc822; ${C.toEmail}`,
        "Action: failed",
        "Status: 5.1.1",
        "--b1",
        "Content-Type: text/rfc822-headers",
        "",
        `Message-ID: ${C.messageId}`,
        `Subject: ${C.subject}`,
        "--b1--",
        "",
      ].join("\r\n"),
    );
    setImapFetcher(async () => ({
      uidValidity: 1,
      lastUid: 14,
      messages: [
        { uid: 10, source: raw({ From: `Продавец <${B.toEmail}>`, To: "ivan@tlkbars-import.ru", Subject: `Re: ${B.subject}`, "Message-ID": "<r1@seller.ru>", "In-Reply-To": B.messageId, References: B.messageId }, "Нет, не актуально, спасибо.\r\n\r\n> Видел ваши товары") },
        { uid: 11, source: bounce },
        { uid: 12, source: raw({ From: `Продавец <${D.toEmail}>`, Subject: `Автоматический ответ: ${D.subject}`, "Auto-Submitted": "auto-replied", "In-Reply-To": D.messageId, "Message-ID": "<a1@seller.ru>" }, "Я в отпуске до понедельника.") },
        { uid: 13, source: raw({ From: "Кто-то <someone@else.ru>", Subject: "Вопрос", "Message-ID": "<x1@else.ru>" }, "Здравствуйте, вы кто?") },
      ],
    }));
    const polled = await pollMailbox(mailboxId, new Date("2026-11-10T09:00:00Z"));
    assert.deepEqual(polled, { fetched: 4, processed: 4 });
    assert.deepEqual(await pollMailbox(mailboxId), { fetched: 4, processed: 0 }, "уже разобранные не дублируются");
    const inbound = (await call(s, "GET", "/mail/inbound?days=365")).json().inbound as { kind: string; sellerInn: string | null; refusalHint: boolean; text: string; bouncedEmail: string | null }[];
    const human = inbound.find((x) => x.kind === "human" && x.sellerInn === B.sellerInn)!;
    assert.ok(human && human.refusalHint && human.text === "Нет, не актуально, спасибо.", "ответ без цитаты, подсказка «похоже на отказ»");
    const [sB] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, B.sellerInn));
    assert.equal(sB.status, "replied", "ответил");
    const fuB = fus.find((f) => f.sellerInn === B.sellerInn)!;
    assert.equal((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, fuB.id)))[0].status, "cancelled", "повтор отменён");
    assert.ok((await db.select().from(schema.leadEvents).where(eq(schema.leadEvents.sellerInn, B.sellerInn))).some((e) => e.type === "replied" && e.comment?.includes("не актуально")), "ответ — в истории продавца");
    const bounced = inbound.find((x) => x.kind === "bounce")!;
    assert.deepEqual([bounced.sellerInn, bounced.bouncedEmail], [C.sellerInn, C.toEmail]);
    const [cContact] = await db.select().from(schema.leadContacts).where(and(eq(schema.leadContacts.sellerInn, C.sellerInn), eq(schema.leadContacts.value, C.toEmail)));
    assert.equal(cContact.valid, false, "адрес возврата — невалидный");
    const cOther = await db.select().from(schema.leadContacts).where(and(eq(schema.leadContacts.sellerInn, C.sellerInn), eq(schema.leadContacts.type, "email"), eq(schema.leadContacts.valid, true)));
    const [sC] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, C.sellerInn));
    if (cOther.length) assert.ok((await db.select().from(schema.leadQueue).where(and(eq(schema.leadQueue.sellerInn, C.sellerInn), eq(schema.leadQueue.status, "planned"), eq(schema.leadQueue.touch, "first")))).length === 1, "есть другой адрес — письмо на него");
    else assert.equal(sC.status, "bounced", "другого адреса нет — возврат");
    assert.equal((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, fus.find((f) => f.sellerInn === C.sellerInn)!.id)))[0].status, "cancelled", "повтор на вернувшийся адрес отменён");
    const [sD] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, D.sellerInn));
    assert.equal(sD.status, "sent", "автоответ статус не меняет");
    assert.equal(inbound.find((x) => x.kind === "auto")!.sellerInn, D.sellerInn);
    assert.equal(inbound.find((x) => x.text.includes("вы кто"))!.sellerInn, null);

    // Отказ — в стоп-лист по кнопке; такого продавца больше не берём в отбор.
    const humanRow = (await db.select().from(schema.mailInbound).where(eq(schema.mailInbound.sellerInn, B.sellerInn)))[0];
    assert.equal((await call(s, "POST", `/mail/inbound/${humanRow.id}/resolve`, { resolution: "stop" })).statusCode, 200);
    const [sB2] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, B.sellerInn));
    assert.equal(sB2.status, "replied_neg");
    assert.ok((await db.select().from(schema.doNotContact).where(eq(schema.doNotContact.inn, B.sellerInn))).length > 0);

    // Hard bounce исключает адрес и останавливает первые касания при 20%, но не блокирует весь ящик.
    const [afterBounce] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
    assert.equal(afterBounce.warmupFirstsPaused, true);
    assert.equal(afterBounce.status, "warming");
    assert.match(afterBounce.warmupHoldReason ?? "", /live-дней/);

    // SMTP-отказ «спам» — ящик на паузу на 48 часов и ступень ниже; повторы до отказа не считаются блокировкой.
    await db.update(schema.mailboxes).set({ warmupStage: 2 }).where(eq(schema.mailboxes.id, mailboxId));
    smtpError = Object.assign(new Error("554 5.7.1 Message rejected under suspicion of SPAM"), { responseCode: 554 });
    const [next] = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.status, "planned"), eq(schema.mailMessages.planDay, "2026-11-10"), eq(schema.mailMessages.touch, "followup")));
    assert.equal((await sendOne(next.id, new Date("2026-11-10T10:00:00Z"))).status, "failed");
    const [paused] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
    assert.equal(paused.status, "paused");
    assert.equal(paused.warmupStage, 1);
    assert.equal(paused.pausedUntil?.toISOString(), "2026-11-12T10:00:00.000Z");
    assert.deepEqual(await pollMailbox(mailboxId, new Date("2026-11-10T10:05:00Z")), { fetched: 4, processed: 0 }, "IMAP работает на SMTP-паузе");
    smtpError = null;

    // «Пауза всей рассылки».
    await call(s, "PUT", "/mail/settings", { mode: "dry_run" });
    assert.equal((await call(s, "POST", "/mail/pause", { paused: true })).json().settings.paused, true);
    assert.deepEqual(await sendDue(new Date("2026-11-13T08:00:00Z")), []);
    assert.equal((await planDay(db, new Date("2026-11-13T07:00:00Z"))).note, "рассылка на паузе");
    await call(s, "POST", "/mail/pause", { paused: false });
    setTransportFactory(null);
    setImapFetcher(null);
    process.env.MAIL_FOLLOWUPS_ENABLED = "false";
  });
});


describe("Рассылка: ступени, предохранители и локальный агент", () => {
  async function newMailbox(email: string, stage = 1) {
    const [domain] = await db.select().from(schema.mailDomains).where(eq(schema.mailDomains.domain, "tlkbars-import.ru"));
    const [source] = await db.select().from(schema.mailboxes).orderBy(schema.mailboxes.id).limit(1);
    const verified = new Date("2026-11-01T06:00:00Z");
    const [box] = await db.insert(schema.mailboxes).values({
      email,
      fromName: "Тест",
      domainId: domain.id,
      smtpHost: "smtp.yandex.ru",
      smtpUser: email,
      imapHost: "imap.yandex.ru",
      imapUser: email,
      passwordEnc: source.passwordEnc,
      signature: "Тест",
      dailyLimit: 25,
      warmupStage: stage,
      warmupStageStartedAt: new Date("2026-11-01T06:00:00Z"),
      smtpVerifiedAt: verified,
      imapVerifiedAt: verified,
    }).returning();
    return box;
  }

  function historyRow(mailboxId: number, sellerInn: string, key: string, at: Date, mode: "live" | "test" | "dry_run" = "live") {
    return {
      sellerInn,
      mailboxId,
      toEmail: `${key}@example.org`,
      touch: "first",
      subject: "Тест",
      body: "Тестовое письмо",
      messageId: `<${key}@tlkbars-import.ru>`,
      status: mode === "dry_run" ? "dry_run" : "sent",
      mode,
      planDay: mailShared.dayInZone(at, "Europe/Moscow"),
      scheduledAt: at,
      sentAt: at,
    };
  }

  test("5 дней и 25 live-писем открывают следующую ступень; четыре ящика независимы", async () => {
    const [seller] = await db.select().from(schema.leadSellers).limit(1);
    const boxes = [] as typeof schema.mailboxes.$inferSelect[];
    for (let i = 0; i < 4; i++) boxes.push(await newMailbox(`warm${i}@tlkbars-import.ru`));
    const box = boxes[0];
    const { evaluateWarmup, warmupStats } = await import("../lib/mail/warmup.ts");
    const { mailboxLimit } = await import("../lib/mail/planner.ts");

    for (let stage = 1; stage <= 4; stage++) {
      const values = [];
      for (let i = 0; i < 25; i++) {
        const at = new Date(Date.UTC(2026, 10 + Math.floor((stage * 7 + Math.floor(i / 5)) / 30), 1 + ((stage * 7 + Math.floor(i / 5)) % 30), 8 + (i % 5)));
        values.push(historyRow(box.id, seller.inn, `stage-${stage}-${i}`, at));
      }
      values.push(historyRow(box.id, seller.inn, `ignored-test-${stage}`, new Date("2027-01-02T08:00:00Z"), "test"));
      values.push(historyRow(box.id, seller.inn, `ignored-dry-${stage}`, new Date("2027-01-03T08:00:00Z"), "dry_run"));
      await db.insert(schema.mailMessages).values(values);
      const before = await warmupStats(db, box.id);
      assert.equal(before?.sendingDays, 5, "дни без live, dry-run и test не засчитываются");
      assert.equal(before?.sent, 25);
      const after = await evaluateWarmup(db, box.id, new Date(values[23].sentAt.getTime() + 3600_000));
      assert.equal(after?.stage, stage + 1);
      assert.equal(after?.stageLimit, mailShared.warmupStageLimit(stage + 1));
      assert.equal(after?.sent, 0, "письмо, завершившее прошлую ступень, не засчитывается новой");
      assert.equal(after?.sendingDays, 0);
      const [current] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, box.id));
      assert.equal(mailboxLimit(current), mailShared.warmupStageLimit(stage + 1));
    }
    const [finished] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, box.id));
    assert.equal(finished.status, "active");
    for (const other of boxes.slice(1)) {
      assert.equal((await warmupStats(db, other.id))?.stage, 1);
      assert.equal((await warmupStats(db, other.id))?.sendingDays, 0);
    }

    const limited = { ...finished, warmupStage: 5, warmupLimitOverride: null, dailyLimit: 7 };
    assert.equal(mailboxLimit(limited), 7, "ручной dailyLimit только уменьшает лимит");
    assert.equal(mailboxLimit({ ...limited, dailyLimit: 500 }), 25);
    assert.equal(mailboxLimit({ ...limited, warmupLimitOverride: 40 }), 40, "особое повышение — отдельное действие");

    const insufficient = boxes[1];
    await db.insert(schema.mailMessages).values(Array.from({ length: 20 }, (_, i) => historyRow(insufficient.id, seller.inn, `short-${i}`, new Date(Date.UTC(2026, 10, 2 + Math.floor(i / 4), 8)))));
    assert.equal((await evaluateWarmup(db, insufficient.id, new Date("2026-11-07T12:00:00Z")))?.stage, 1, "25 писем обязательны даже после пяти дней");

    const errors = boxes[2];
    await db.insert(schema.mailMessages).values(Array.from({ length: 25 }, (_, i) => historyRow(errors.id, seller.inn, `errors-${i}`, new Date(Date.UTC(2026, 10, 2 + Math.floor(i / 5), 8)))));
    await db.insert(schema.mailMessages).values({ ...historyRow(errors.id, seller.inn, "recent-error", new Date("2026-11-06T12:00:00Z")), status: "failed", error: "temporary SMTP error" });
    assert.equal((await evaluateWarmup(db, errors.id, new Date("2026-11-06T13:00:00Z")))?.stage, 1, "ошибка последнего отправочного дня удерживает ступень");
  });

  test("агент получает проверки и цепочку по Bearer-ключу; повтор результата и advisory lock безопасны", async () => {
    process.env.MAIL_FOLLOWUPS_ENABLED = "true";
    await db.update(schema.mailTemplates).set({ active: true }).where(eq(schema.mailTemplates.touch, "followup"));
    const s = await adminSession();
    await call(s, "PUT", "/mail/settings", { mode: "dry_run", testAddress: "qa@example.org" });
    const created = await call(s, "POST", "/mail/mailboxes", { email: "agent@tlkbars-import.ru", fromName: "Агент", domainId: (await db.select().from(schema.mailDomains).where(eq(schema.mailDomains.domain, "tlkbars-import.ru")))[0].id, password: "agent-test-password", dailyLimit: 25 });
    assert.equal(created.statusCode, 200, created.body);
    const mailboxId = created.json().mailbox.id as number;
    const issued = await call(s, "POST", "/mail/agent/token");
    const token = issued.json().token as string;
    assert.ok(token.startsWith("irbis_mail_"));
    const agent = (method: "next" | "result", payload: unknown, key = token) => app.inject({ method: "POST", url: `${API}/mail/agent/${method}`, headers: { authorization: `Bearer ${key}` }, payload: payload as object });
    assert.equal((await agent("next", { host: "test-pc" }, "wrong")).statusCode, 401);
    await db.update(schema.mailboxes).set({ checkRequestedAt: new Date(), checkTestTo: null }).where(eq(schema.mailboxes.id, mailboxId));
    const check = (await agent("next", { host: "test-pc" })).json().task;
    assert.equal(check.type, "check");
    assert.equal(check.mailbox.password, "agent-test-password");
    assert.equal((await agent("result", { type: "check", mailboxId, smtp: { ok: true }, imap: { ok: true }, host: "test-pc" })).statusCode, 200);
    const [verified] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
    assert.ok(verified.smtpVerifiedAt && verified.imapVerifiedAt);

    const [queued] = await db.select({ inn: schema.leadQueue.sellerInn }).from(schema.leadQueue).where(eq(schema.leadQueue.status, "planned")).limit(1);
    const chain = await call(s, "POST", "/mail/test-chain", { inn: queued.inn, mailboxId });
    assert.equal(chain.json().queued, true);
    const first = (await agent("next", { host: "test-pc" })).json().task;
    assert.equal(first.type, "send");
    assert.equal(first.mail.to, "qa@example.org");
    await agent("result", { type: "send", messageId: first.messageId, ok: true, host: "test-pc" });
    await agent("result", { type: "send", messageId: first.messageId, ok: true, host: "test-pc" });
    const { nextMailAgentTask } = await import("../lib/mail/agent.ts");
    const second = await nextMailAgentTask("test-pc", new Date(Date.now() + 2000));
    assert.equal(second.type, "send");
    assert.notEqual(second.type === "send" ? second.messageId : 0, first.messageId);
    assert.equal(second.type === "send" ? second.mail.inReplyTo : null, first.mail.messageId);
    await agent("result", { type: "send", messageId: second.type === "send" ? second.messageId : 0, ok: true, host: "test-pc" });
    const testMessages = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.mailboxId, mailboxId), eq(schema.mailMessages.mode, "test"))).orderBy(schema.mailMessages.id);
    assert.deepEqual(testMessages.map((m) => m.status), ["sent", "sent"]);
    const { warmupStats } = await import("../lib/mail/warmup.ts");
    assert.equal((await warmupStats(db, mailboxId))?.sent, 0, "test не продвигает прогрев");

    const single = await db.insert(schema.mailMessages).values({ sellerInn: queued.inn, mailboxId, toEmail: "qa@example.org", sentTo: "qa@example.org", touch: "first", subject: "Один", body: "Один", messageId: "<single-agent@tlkbars-import.ru>", planDay: mailShared.dayInZone(new Date(), "Europe/Moscow"), scheduledAt: new Date(), mode: "test" }).returning();
    const claims = await Promise.all([nextMailAgentTask("test-pc", new Date(Date.now() + 3000)), nextMailAgentTask("test-pc", new Date(Date.now() + 3000))]);
    assert.equal(claims.filter((task) => task.type === "send" && task.messageId === single[0].id).length, 1, "два опроса не получают одно письмо");
    const claim = claims.find((task) => task.type === "send" && task.messageId === single[0].id);
    if (claim?.type === "send") await agent("result", { type: "send", messageId: claim.messageId, ok: true, host: "test-pc" });

    const { tryMailWorkerLock, MAIL_WORKER_LOCK_ID } = await import("../lib/mail/worker.ts");
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      assert.equal(await tryMailWorkerLock(a), true);
      assert.equal(await tryMailWorkerLock(b), false);
    } finally {
      await a.query("select pg_advisory_unlock($1)", [MAIL_WORKER_LOCK_ID]);
      a.release();
      b.release();
    }
    process.env.MAIL_FOLLOWUPS_ENABLED = "false";
  });

  test("auth-ошибка ставит паузу без повторных SMTP-попыток; лимит общий и перенос не копит долг", async () => {
    const s = await adminSession();
    await call(s, "PUT", "/mail/settings", { mode: "live" });
    const box = await newMailbox("auth@tlkbars-import.ru");
    const [seller] = await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.status, "new")).limit(1);
    const insert = await db.insert(schema.mailMessages).values(historyRow(box.id, seller.inn, "auth-failure", new Date("2026-11-10T08:00:00Z"))).returning();
    await db.update(schema.mailMessages).set({ status: "planned", mode: null, sentAt: null }).where(eq(schema.mailMessages.id, insert[0].id));
    let attempts = 0;
    setTransportFactory(() => ({ async send() { attempts++; throw new Error("535 5.7.8 EAUTH authentication failed"); }, async verify() {} }));
    assert.equal((await sendOne(insert[0].id, new Date("2026-11-10T08:00:00Z"))).status, "failed");
    assert.equal((await sendOne(insert[0].id, new Date("2026-11-10T08:01:00Z"))).status, "skipped");
    assert.equal(attempts, 1);
    const [paused] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, box.id));
    assert.equal(paused.status, "paused");
    assert.equal(paused.pausedUntil, null);
    assert.equal(paused.smtpVerifiedAt, null);

    const bounceBox = await newMailbox("smtp-bounce@tlkbars-import.ru");
    const bounceInsert = await db.insert(schema.mailMessages).values(historyRow(bounceBox.id, seller.inn, "direct-bounce", new Date("2026-11-10T08:00:00Z"))).returning();
    await db.update(schema.mailMessages).set({ status: "planned", mode: null, sentAt: null }).where(eq(schema.mailMessages.id, bounceInsert[0].id));
    setTransportFactory(() => ({ async send() { throw new Error("550 5.1.1 user unknown"); }, async verify() {} }));
    assert.equal((await sendOne(bounceInsert[0].id, new Date("2026-11-10T08:00:00Z"))).status, "failed");
    const { warmupStats: bounceStats } = await import("../lib/mail/warmup.ts");
    assert.equal((await bounceStats(db, bounceBox.id))?.bounces, 1, "SMTP hard bounce входит в статистику даже без DSN");
    assert.equal((await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, bounceBox.id)))[0].status, "warming", "один bounce не блокирует ящик");
    setTransportFactory(null);
    await call(s, "PUT", "/mail/settings", { mode: "dry_run" });

    process.env.MAIL_FOLLOWUPS_ENABLED = "true";
    const plannedBox = await newMailbox("capacity@tlkbars-import.ru");
    const queueSellers = await db.select().from(schema.leadQueue).where(and(eq(schema.leadQueue.status, "planned"), eq(schema.leadQueue.touch, "first"))).orderBy(schema.leadQueue.id).limit(5);
    for (const [i, q] of queueSellers.entries()) {
      await db.update(schema.leadQueue).set({ status: "cancelled" }).where(eq(schema.leadQueue.sellerInn, q.sellerInn));
      await db.update(schema.mailMessages).set({ status: "cancelled" }).where(and(eq(schema.mailMessages.queueId, q.id), eq(schema.mailMessages.status, "planned")));
      if (i < 4) {
        await db.insert(schema.mailMessages).values(historyRow(plannedBox.id, q.sellerInn, `old-first-${i}`, new Date("2026-11-06T08:00:00Z")));
        await db.insert(schema.leadQueue).values({ sellerInn: q.sellerInn, plannedDate: "2026-11-09", touch: "followup", status: "planned" });
      } else {
        await db.insert(schema.leadQueue).values({ sellerInn: q.sellerInn, plannedDate: "2026-11-09", touch: "first", status: "planned" });
      }
    }
    const plan = await planDay(db, new Date("2026-11-09T07:00:00Z"), { mailboxIds: [plannedBox.id], rnd: () => 0.5 });
    assert.equal(plan.planned, 5);
    assert.equal(plan.followups, 4);
    assert.equal(plan.firsts, 1, "первые и повторы делят один лимит 5");
    const old = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.mailboxId, plannedBox.id), eq(schema.mailMessages.planDay, "2026-11-09"), eq(schema.mailMessages.status, "planned")));
    assert.equal(old.length, 5);
    const next = await planDay(db, new Date("2026-11-10T07:00:00Z"), { mailboxIds: [plannedBox.id], rnd: () => 0.5 });
    assert.equal(next.planned, 5, "на следующий день только новый дневной лимит, без долга");
    const oldAfter = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.mailboxId, plannedBox.id), eq(schema.mailMessages.planDay, "2026-11-09"), eq(schema.mailMessages.status, "planned")));
    assert.equal(oldAfter.length, 0, "старые слоты закрыты при переносе");
  });
});

describe("Рассылка без повторных касаний", () => {
  test("по умолчанию только первые письма: старые повторы отменены, новые не создаются", async () => {
    process.env.MAIL_FOLLOWUPS_ENABLED = "false";
    const s = await adminSession();
    await call(s, "PUT", "/mail/settings", { mode: "dry_run" });
    await db.update(schema.mailTemplates).set({ active: false }).where(eq(schema.mailTemplates.touch, "followup"));
    const domainId = (await db.select().from(schema.mailDomains).where(eq(schema.mailDomains.domain, "tlkbars-import.ru")))[0].id;
    const created = await call(s, "POST", "/mail/mailboxes", { email: "first-only@tlkbars-import.ru", fromName: "Тест", domainId, password: "test-password", dailyLimit: 25 });
    assert.equal(created.statusCode, 200, created.body);
    const mailboxId = created.json().mailbox.id as number;
    await db.update(schema.mailboxes).set({ smtpVerifiedAt: new Date("2026-11-01T06:00:00Z"), imapVerifiedAt: new Date("2026-11-01T06:00:00Z"), warmupStageStartedAt: new Date("2026-11-01T06:00:00Z") }).where(eq(schema.mailboxes.id, mailboxId));

    const queueSellers = await db.select().from(schema.leadQueue).where(and(eq(schema.leadQueue.status, "planned"), eq(schema.leadQueue.touch, "first"))).orderBy(schema.leadQueue.id).limit(6);
    assert.equal(queueSellers.length, 6);
    let oldFirstId = 0;
    let oldFollowupId = 0;
    let oldFollowupQueueId = 0;
    for (const [i, q] of queueSellers.entries()) {
      await db.update(schema.leadQueue).set({ status: "cancelled" }).where(eq(schema.leadQueue.sellerInn, q.sellerInn));
      await db.update(schema.mailMessages).set({ status: "cancelled" }).where(and(eq(schema.mailMessages.queueId, q.id), eq(schema.mailMessages.status, "planned")));
      if (i === 0) {
        const [first] = await db.insert(schema.mailMessages).values({ sellerInn: q.sellerInn, mailboxId, toEmail: "old-recipient@example.org", touch: "first", subject: "Первое", body: "История", messageId: "<first-only-history@tlkbars-import.ru>", status: "sent", mode: "live", planDay: "2026-11-06", scheduledAt: new Date("2026-11-06T08:00:00Z"), sentAt: new Date("2026-11-06T08:00:00Z") }).returning();
        oldFirstId = first.id;
        const [queue] = await db.insert(schema.leadQueue).values({ sellerInn: q.sellerInn, plannedDate: "2026-11-09", touch: "followup", status: "planned" }).returning();
        oldFollowupQueueId = queue.id;
        const [followup] = await db.insert(schema.mailMessages).values({ sellerInn: q.sellerInn, queueId: queue.id, mailboxId, toEmail: first.toEmail, touch: "followup", subject: `Re: ${first.subject}`, body: "Старый повтор", messageId: "<first-only-old-followup@tlkbars-import.ru>", inReplyTo: first.messageId, status: "planned", planDay: "2026-11-09", scheduledAt: new Date("2026-11-09T08:00:00Z") }).returning();
        oldFollowupId = followup.id;
      } else {
        await db.insert(schema.leadQueue).values({ sellerInn: q.sellerInn, plannedDate: "2026-11-09", touch: "first", status: "planned" });
      }
    }

    const plan = await planDay(db, new Date("2026-11-09T07:00:00Z"), { mailboxIds: [mailboxId], rnd: () => 0.5 });
    assert.deepEqual([plan.planned, plan.firsts, plan.followups], [5, 5, 0], "весь лимит 5 использован только на первые письма");
    assert.equal((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, oldFirstId)))[0].status, "sent", "история сохранена");
    assert.equal((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, oldFollowupId)))[0].status, "cancelled");
    assert.equal((await db.select().from(schema.leadQueue).where(eq(schema.leadQueue.id, oldFollowupQueueId)))[0].status, "cancelled");
    const afterFirstPlan = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.mailboxId, mailboxId));
    assert.equal((await planDay(db, new Date("2026-11-09T07:00:00Z"), { mailboxIds: [mailboxId], rnd: () => 0.5 })).planned, 0, "повторный worker ничего не дублирует");
    assert.equal((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.mailboxId, mailboxId))).length, afterFirstPlan.length);

    const [outgoing] = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.mailboxId, mailboxId), eq(schema.mailMessages.status, "planned"), eq(schema.mailMessages.touch, "first"))).limit(1);
    let smtpCalls = 0;
    setTransportFactory(() => ({ async send() { smtpCalls++; return { response: "250 test" }; }, async verify() {} }));
    await call(s, "PUT", "/mail/settings", { mode: "live" });
    assert.equal((await sendOne(outgoing.id, new Date("2026-11-09T08:00:00Z"))).status, "sent");
    assert.equal(smtpCalls, 1);
    setTransportFactory(null);
    assert.equal((await db.select().from(schema.leadSellers).where(eq(schema.leadSellers.inn, outgoing.sellerInn)))[0].status, "sent");
    assert.equal((await db.select().from(schema.leadQueue).where(and(eq(schema.leadQueue.sellerInn, outgoing.sellerInn), eq(schema.leadQueue.touch, "followup")))).length, 0, "после первого письма followup не создаётся");
    const { warmupStats } = await import("../lib/mail/warmup.ts");
    assert.equal((await warmupStats(db, mailboxId))?.sent, 2, "прогрев учитывает историческое и новое live-письма, но не повторы");
    assert.equal((await db.select().from(schema.mailTemplates).where(eq(schema.mailTemplates.touch, "followup"))).every((template) => !template.active), true);
    await call(s, "PUT", "/mail/settings", { mode: "dry_run" });
  });
});
