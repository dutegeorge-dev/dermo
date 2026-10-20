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
    assert.deepEqual(plan("fx"), { amount: 15200, currency: "RUB" });
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
    // Комиссия за перевод: 4 % от (товар 220 000 + перевозка 160 000) = 15 200 ₽.
    assert.match(text, /Комиссия за валютный перевод 4%\t15 200 руб\./);
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
    for (const schema of [DRAFT_SCHEMA, HS_SCHEMA, MAPPING_SCHEMA]) {
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
    const zipRes = await app.inject({ method: "GET", url: `${API}/shipments/${no}/customs-pack.zip`, headers: { cookie: s.cookie } });
    assert.equal(zipRes.statusCode, 200);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipRes.rawPayload);
    const names = Object.keys(zip.files);
    assert.ok(names.some((n) => n.startsWith("2 Инвойсы поставщика/") && n.includes("оплата")), names.join("\n"));
    assert.ok(names.some((n) => n.startsWith("4 Спецификация/")));
    assert.match(await zip.file("Опись.txt")!.async("string"), /Не хватает/);
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
