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

async function login(loginName: string, password: string): Promise<Session> {
  const res = await app.inject({ method: "POST", url: `${API}/auth/login`, payload: { login: loginName, password } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === config.session.cookieName);
  assert.ok(cookie, "cookie выставлена");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(cookie.path, "/crm");
  return { cookie: `${cookie.name}=${cookie.value}`, csrf: res.json().csrfToken };
}

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
      newShipment: { clientId: client.id, title: "Трава зелёная 30 мм" },
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
    const wrong = await call(s, "POST", "/shipments", { title: "X", clientId: carrier.id });
    assert.equal(wrong.statusCode, 400, wrong.body);
    assert.equal((await call(s, "POST", "/shipments", { clientId: client.id })).statusCode, 400, "без названия груза нельзя");

    const created = await call(s, "POST", "/shipments", {
      clientId: client.id,
      supplierId: supplier.id,
      carrierId: carrier.id,
      title: "Линолеум коричневый",
      transport: "rail",
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
  // Один вход на весь блок — иначе упрёмся в лимит попыток входа с одного IP.
  let session: Session | null = null;
  const aiSession = async () => (session ??= await login("admin", "adminpass1"));

  test("без ключа ИИ выключен", async () => {
    const s = await aiSession();
    assert.deepEqual((await call(s, "GET", "/ai/status")).json(), { enabled: false });
    assert.equal((await call(s, "POST", "/ai/chat", { messages: [{ role: "user", content: "привет" }] })).statusCode, 503);
  });

  test("черновик сверяется с базой: контрагент, договор, сделка, числа и даты", async () => {
    const { resolveDraft } = await import("../lib/ai-parse.ts");
    const s = await aiSession();
    const supplier = (await call(s, "POST", "/counterparties", { role: "supplier", name: "Demo Turf Factory Co., Ltd" })).json().counterparty;
    const contract = (await call(s, "POST", "/documents", { type: "supplier_contract", counterpartyId: supplier.id, number: "DTF-07/26" })).json().document;
    const sh = (await call(s, "POST", "/shipments", { title: "Трава демо", supplierId: supplier.id })).json().shipment;

    const base = {
      docType: "supplier_invoice",
      number: " PI-DEMO-1 ",
      date: "2026-13-45",
      currency: "CNY",
      amount: 1000,
      counterparty: { matchId: 999999, name: "demo turf factory co., ltd", fullName: null, inn: null, regNumber: null, country: null, address: null },
      contractorType: null,
      clientMatchId: null,
      contractNumber: "DTF 07-26",
      shipmentMatchNumber: sh.number,
      shipmentReason: "тот же поставщик",
      cargoTitle: "Трава",
      containerNo: "demu 100009-9",
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
      warnings: [],
    };
    const d = await resolveDraft(db, base);
    assert.equal(d.type, "supplier_invoice");
    assert.equal(d.number, "PI-DEMO-1");
    assert.equal(d.date, null, "кривая дата отброшена");
    assert.deepEqual(d.counterparty, { id: supplier.id, name: "Demo Turf Factory Co., Ltd" }, "найден по названию, несуществующий id отброшен");
    assert.equal(d.parentId, contract.id, "договор найден по номеру без учёта пробелов и знаков");
    assert.equal(d.shipment?.number, sh.number);
    assert.equal(d.containerNo, "DEMU1000099");
    assert.equal(d.costCategory, null);
    assert.equal(d.items.length, 1);
    assert.equal(d.items[0].hsCode, "570330");

    const unknown = await resolveDraft(db, {
      ...base,
      docType: "contractor_invoice",
      counterparty: { ...base.counterparty, matchId: null, name: "Demo Rail Forwarding", country: "Китай" },
      contractorType: "carrier_cn",
      shipmentMatchNumber: 987654,
      items: base.items,
    });
    assert.deepEqual(unknown.counterparty, { id: null, name: "Demo Rail Forwarding" });
    assert.deepEqual(unknown.newCounterparty, { country: "Китай", kind: "foreign", contractorType: "carrier_cn" });
    assert.equal(unknown.shipment, null, "несуществующая сделка отброшена");
    assert.equal(unknown.items.length, 0, "у счёта подрядчика позиций нет");
    assert.equal((await resolveDraft(db, { ...base, docType: "bogus" })).type, "other");
  });

  test("инструменты чата читают API от имени пользователя", async () => {
    const { runTool } = await import("../lib/ai-chat.ts");
    const s = await aiSession();
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
    xlsx.file("xl/workbook.xml", `<workbook><sheets><sheet name="PI" sheetId="1"/></sheets></workbook>`);
    xlsx.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>12.5</v></c></row><row r="2"><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>`);
    assert.equal(await xlsxText(await xlsx.generateAsync({ type: "nodebuffer" })), "=== Лист PI\nТовар\t\t12.5\n\tТрава");
  });
});
