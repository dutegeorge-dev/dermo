/**
 * ИИ-чат по данным CRM: «что на этой неделе?», «сколько должны перевозчикам?»,
 * «где контейнер DEMU1234567?». Модель только читает: каждый инструмент — это
 * GET-запрос к нашему же API от имени пользователя (app.inject с его cookie),
 * поэтому права и логика те же, что в интерфейсе.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { DOC_GROUPS, DOC_TYPES } from "../../shared/documents.ts";
import { FLAGS, MILESTONES, SHIPMENT_STAGES } from "../../shared/shipments.ts";
import { config } from "../config.ts";
import { aiBase, aiClient, aiError } from "./ai.ts";
import { currentUser, HttpError } from "./http.ts";

type Input = Record<string, unknown>;

type ToolSpec = {
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  /** Путь API (без /crm/api) по входным параметрам. */
  path: (input: Input) => string;
  /** Ужать ответ перед отдачей модели. */
  shape?: (data: unknown, input: Input) => unknown;
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (s(v)) p.set(k, s(v));
  const q = p.toString();
  return q ? `?${q}` : "";
};
const id = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `${name}: нужно положительное число`);
  return n;
};

const TOOLS: Record<string, ToolSpec> = {
  search: {
    description: "Глобальный поиск по всему: сделки (груз, контейнер, ТН ВЭД, номер), лиды воронки, контрагенты, документы, товары, база знаний, справочник для звонков.",
    properties: { q: { type: "string", description: "Что искать" } },
    required: ["q"],
    path: (i) => `/search${qs({ q: i.q })}`,
  },
  list_shipments: {
    description: "Список сделок (отгрузок) с этапом, сторонами, контейнером, датами (milestones: plan/fact) и флажками. По умолчанию — в работе.",
    properties: {
      status: { type: "string", enum: ["active", "closed", "cancelled", "all"] },
      stage: { type: "integer", description: "Этап 1–8" },
      q: { type: "string", description: "Фильтр: груз, контейнер, ТН ВЭД, клиент, поставщик, перевозчик, номер" },
    },
    path: (i) => `/shipments${qs({ status: i.status, stage: i.stage, q: i.q })}`,
    shape: (d) => ({ shipments: (d as { shipments: unknown[] }).shipments }),
  },
  get_shipment: {
    description: "Полная карточка сделки по номеру: поля, стороны, ключевые даты, флажки, документы, план/факт по деньгам, товары, сертификаты, последние события истории.",
    properties: { number: { type: "integer", description: "Номер сделки (№ 12 → 12)" } },
    required: ["number"],
    path: (i) => `/shipments/${id(i.number, "number")}`,
    shape: (d) => {
      const r = d as { events?: unknown[] };
      return { ...r, events: (r.events ?? []).slice(0, 30) };
    },
  },
  calendar: {
    description: "Календарь сделок в работе: плановые и фактические даты ключевых точек и флажки (оплаты остатка, фрахта, таможни). date null — дата не назначена (текущий этап). done — уже выполнено.",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD, включительно" },
      to: { type: "string", description: "YYYY-MM-DD, включительно" },
      includeDone: { type: "boolean", description: "Включить выполненные события (по умолчанию нет)" },
    },
    path: () => "/calendar",
    shape: (d, i) => {
      const from = s(i.from);
      const to = s(i.to);
      const events = (d as { events: { date: string | null; done: boolean }[] }).events.filter(
        (e) => (i.includeDone || !e.done) && (!e.date || ((!from || e.date >= from) && (!to || e.date <= to))),
      );
      return { events };
    },
  },
  list_documents: {
    description: `Реестр документов. Типы: ${Object.entries(DOC_TYPES).map(([k, v]) => `${k} (${v.label})`).join(", ")}. Группы: ${Object.keys(DOC_GROUPS).join(", ")}.`,
    properties: {
      type: { type: "string", description: "Тип(ы) через запятую" },
      group: { type: "string", enum: Object.keys(DOC_GROUPS) },
      payment: { type: "string", enum: ["unpaid", "partial", "paid", "debt"], description: "debt — не оплачен или частично" },
      expiring: { type: "integer", description: "Истекают в ближайшие N дней" },
      counterparty: { type: "integer", description: "id контрагента (сторона или клиент)" },
      shipment: { type: "integer", description: "id сделки (не номер!) — поле id из карточки сделки" },
      q: { type: "string", description: "Номер, заметки, стороны, позиции" },
      limit: { type: "integer" },
    },
    path: (i) => `/documents${qs({ type: i.type, group: i.group, payment: i.payment, expiring: i.expiring, client: i.counterparty, shipment: i.shipment, q: i.q, limit: i.limit ?? 100 })}`,
  },
  get_document: {
    description: "Документ по id: поля, позиции, файлы, приложения.",
    properties: { id: { type: "integer" } },
    required: ["id"],
    path: (i) => `/documents/${id(i.id, "id")}`,
  },
  list_counterparties: {
    description: "Контрагенты: клиенты, поставщики, подрядчики (перевозчики, брокеры, СВХ).",
    properties: {
      role: { type: "string", enum: ["client", "supplier", "contractor"] },
      q: { type: "string", description: "Название, ИНН, контакт, телефон" },
    },
    path: (i) => `/counterparties${qs({ role: i.role, q: i.q, limit: 100 })}`,
  },
  get_counterparty: {
    description: "Карточка контрагента по id: реквизиты, контакты, сделки, документы, товары с ценами.",
    properties: { id: { type: "integer" } },
    required: ["id"],
    path: (i) => `/counterparties/${id(i.id, "id")}`,
  },
  list_leads: {
    description: "Лиды воронки продаж (переговоры с клиентами до депозита).",
    properties: {
      outcome: { type: "string", enum: ["open", "won", "lost", "all"] },
      q: { type: "string" },
    },
    path: (i) => `/deals${qs({ outcome: i.outcome ?? "open", q: i.q })}`,
  },
  get_lead: {
    description: "Лид воронки по ключу BARS-12: описание, комментарии, история.",
    properties: { key: { type: "string", description: "BARS-12 или 12" } },
    required: ["key"],
    path: (i) => `/deals/${encodeURIComponent(s(i.key))}`,
  },
  list_products: {
    description: "Справочник товаров: ТН ВЭД, последняя закупочная цена.",
    properties: { q: { type: "string" } },
    path: (i) => `/products${qs({ q: i.q })}`,
  },
  get_product: {
    description: "Товар по id: цены по поставщикам и клиентам, документы.",
    properties: { id: { type: "integer" } },
    required: ["id"],
    path: (i) => `/products/${id(i.id, "id")}`,
  },
  get_kb_page: {
    description: "Страница базы знаний по id (из результатов search).",
    properties: { id: { type: "integer" } },
    required: ["id"],
    path: (i) => `/kb/pages/${id(i.id, "id")}`,
  },
  call_script: {
    description: "Справочник для звонков: темы и ответы менеджера клиенту.",
    properties: {},
    path: () => "/calls",
  },
};

const TOOL_DEFS: Anthropic.Beta.BetaToolUnion[] = Object.entries(TOOLS).map(([name, t]) => ({
  name,
  description: t.description,
  input_schema: { type: "object", properties: t.properties, ...(t.required ? { required: t.required } : {}) },
}));

/** Убираем null и пустое — меньше токенов. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
      out[k] = compact(v);
    }
    return out;
  }
  return value;
}

const MAX_RESULT_CHARS = 60_000;

export async function runTool(app: FastifyInstance, request: FastifyRequest, name: string, input: Input): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) throw new HttpError(400, `Нет инструмента ${name}`);
  const res = await app.inject({
    method: "GET",
    url: `${config.basePath}/api${tool.path(input ?? {})}`,
    headers: { cookie: request.headers.cookie ?? "" },
  });
  const data = res.json();
  if (res.statusCode >= 400) throw new HttpError(res.statusCode, (data as { error?: string })?.error ?? `Ошибка ${res.statusCode}`);
  const text = JSON.stringify(compact(tool.shape ? tool.shape(data, input ?? {}) : data));
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… [обрезано — уточните запрос фильтром]` : text;
}

function systemPrompt(userName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Ты — помощник во внутренней CRM компании ООО «ТЛК БАРС»: закупка и доставка товаров из Китая «под ключ» (ж/д, море, авто; растаможка в России). Отвечаешь сотрудникам на вопросы по их данным. Сегодня ${today}. Пользователь: ${userName}.

Как устроена CRM:
- Воронка продаж — лиды (ключ BARS-12): переговоры с клиентом до депозита.
- Сделка (отгрузка, № 12) — реальный заказ = одна отгрузка, обычно один контейнер. Называется по грузу («Линолеум коричневый»). Схема: commission — комиссия (основная), supply — поставка, teu — ТЭУ.
- Этапы сделки (этап = первая ключевая дата без факта): ${SHIPMENT_STAGES.map((st) => `${st.no} ${st.name}`).join("; ")}.
- Ключевые даты (milestones, у каждой plan и fact): ${MILESTONES.map((m) => `${m.key} — ${m.label}`).join(", ")}.
- Флажки ожиданий (flags: ключ → дата отметки): ${Object.entries(FLAGS).map(([k, f]) => `${k} — ${f.label}`).join(", ")}.
- Документы: договоры, инвойсы поставщиков, счета подрядчиков (перевозчик, брокер, СВХ), ж/д накладные, ДТ, сертификаты. У платёжных — статус оплаты unpaid/partial/paid.
- Контрагенты: клиенты, поставщики, подрядчики. Валюты: CNY, USD, EUR, RUB.

Правила:
- Данные бери только через инструменты, ничего не выдумывай. Нужно несколько запросов — делай их сразу параллельно.
- Ты только читаешь данные. Если просят что-то изменить — объясни, где это сделать в интерфейсе (и дай ссылку).
- Отвечай по-русски, коротко и по делу: сначала ответ, потом детали. Списки — маркированные. Суммы — с валютой, даты — «20 окт», «пн 21 окт».
- Ссылки на объекты — markdown-ссылками, текст ссылки — имя объекта: [№ 12 «Трава»](/shipments/12), [BARS-5](/deals/BARS-5), [инвойс PI-0412](/documents/34), [ООО «Ромашка»](/clients/7). Пути: сделка /shipments/НОМЕР, лид /deals/КЛЮЧ, документ /documents/ID, клиент /clients/ID, поставщик /suppliers/ID, подрядчик /contractors/ID, товар /products/ID, календарь /calendar.
- Пиши человеческими словами: не показывай технические ключи и значения полей (certificates: no, stage, milestone) и не придумывай названия кнопок и вкладок интерфейса — просто дай ссылку на карточку.
- Если в сообщении указана страница, на которой сейчас пользователь, — «эта сделка», «этот документ» относятся к ней.`;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 12;

/** Один ответ чата: история (только текст) → цикл с инструментами → текст ответа. */
export async function chatReply(
  app: FastifyInstance,
  request: FastifyRequest,
  history: ChatMessage[],
  page: string | null,
): Promise<{ reply: string; tools: string[] }> {
  const user = currentUser(request);
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const last = messages[messages.length - 1];
  if (page && last?.role === "user") last.content = `${String(last.content)}\n\n(Пользователь сейчас на странице CRM: ${page})`;

  const used: string[] = [];
  const client = aiClient();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        ...aiBase(),
        max_tokens: 16000,
        output_config: { effort: "low" },
        system: systemPrompt(user.name),
        tools: TOOL_DEFS,
        messages,
      });
    } catch (error) {
      throw aiError(error);
    }
    if (response.stop_reason === "refusal") return { reply: "Не могу ответить на этот запрос.", tools: used };
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const reply = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      return { reply: reply || "Не получилось сформулировать ответ — переспросите иначе.", tools: used };
    }
    // Ответ модели — целиком (с блоками размышлений), затем все результаты одним сообщением.
    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        used.push(tu.name);
        try {
          return { type: "tool_result", tool_use_id: tu.id, content: await runTool(app, request, tu.name, tu.input as Input) };
        } catch (error) {
          return { type: "tool_result", tool_use_id: tu.id, content: error instanceof Error ? error.message : "Ошибка", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { reply: "Слишком много шагов — уточните вопрос.", tools: used };
}
