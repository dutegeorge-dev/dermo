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
      route: "auto",
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

    const patch = await call(s, "PATCH", `/deals/${key}`, { weightKg: "1 250,5", exportLicense: "we_arrange", labels: ["срочно", "срочно", " LVT "] });
    assert.deepEqual(patch.json().changed.sort(), ["exportLicense", "labels", "weightKg"]);
    assert.equal((await call(s, "PATCH", `/deals/${key}`, { route: "boat" })).statusCode, 400);

    // Перенос на завершающий этап → успешно; обратно → снова в работе.
    assert.equal((await call(s, "POST", `/deals/${key}/move`, { statusKey: "done" })).statusCode, 200);
    deal = (await call(s, "GET", `/deals/${key}`)).json();
    assert.equal(deal.deal.outcome, "won");
    await call(s, "POST", `/deals/${key}/move`, { statusKey: "offer" });
    deal = (await call(s, "GET", `/deals/${key}`)).json();
    assert.equal(deal.deal.outcome, null);
    assert.equal(deal.deal.weightKg, 1250.5);
    assert.equal((await call(s, "PATCH", `/deals/${key}`, { weightKg: 1250.5 })).json().changed.length, 0);
    assert.deepEqual(deal.deal.labels, ["срочно", "LVT"]);

    const kinds = (deal.events as { kind: string; field: string | null; newValue: unknown }[]).map((e) => e.kind);
    assert.ok(kinds.includes("created") && kinds.includes("status_changed") && kinds.includes("field_changed"));
    const lic = deal.events.find((e: { field: string | null }) => e.field === "exportLicense");
    assert.equal(lic.newValue, "Оформляем сами");

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
    assert.equal((await call(s, "POST", "/clients", { name: "ИП Петров", kind: "ip", inn: "123" })).statusCode, 400);
    const list = (await call(s, "GET", `/clients?q=${encodeURIComponent("пол-маркет")}`)).json().clients;
    assert.equal(list.length, 1);
    const card = (await call(s, "GET", `/clients/${list[0].id}`)).json();
    assert.equal(card.contacts[0].name, "Сергей");
    assert.equal(card.deals.length, 1);
    assert.equal((await call(s, "POST", `/clients/${list[0].id}/contacts`, { name: "Анна", email: "a@b.ru" })).statusCode, 200);
  });
});
