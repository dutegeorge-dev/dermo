import type Anthropic from "@anthropic-ai/sdk";

import { mentionsMainDomain, unknownPlaceholders } from "../../../shared/mail.ts";
import { aiBase, aiClient, aiError, type AiUsage, usageOf } from "../ai.ts";
import { HttpError } from "../http.ts";

export type MailTemplateAiInput = {
  operation: "create" | "improve" | "unify";
  touch: "first" | "followup";
  category: string;
  marking: boolean;
  subject: string;
  body: string;
  instruction: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
};

const SYSTEM = `Ты редактор деловых писем российской логистической компании. Создай или отредактируй шаблон холодного письма продавцу Wildberries о белом ввозе товаров из Китая.

Пиши по-русски, коротко и конкретно, без канцелярита, давления, преувеличений и выдуманных фактов. Не обещай конкретную цену, срок или результат. Не упоминай tlkbars.ru. Только обычный текст, без Markdown и HTML.
Тема — до 100 символов, без «Re:» у первого письма. У повтора тема «Re: {first_subject}». Тело первого письма — примерно 700–1400 знаков, повтора — до 700 знаков. Один понятный следующий шаг для получателя.
Можно использовать только подстановки {name_patronymic}, {brand}, {product}, {category}, {marking_note}, {link}, {signature}, {first_subject} и варианты {фраза 1|фраза 2}. Не выдумывай другие переменные.
В первом письме используй {brand}, {product}, {category}, {link}; {marking_note} — только если категория с маркировкой. В конце ровно один раз {signature}. В повторе не повторяй первое письмо полностью и дай возможность просто ответить «нет».`;

export async function assistMailTemplate(input: MailTemplateAiInput): Promise<{ subject: string; body: string; usage: AiUsage }> {
  const operation = input.operation === "unify" ? "Приведи к единому спокойному деловому стилю, сохранив смысл." : input.operation === "improve" ? "Улучши существующий шаблон с учётом просьбы." : "Создай новый шаблон с учётом просьбы.";
  const content = `${operation}\nКасание: ${input.touch === "followup" ? "повтор" : "первое письмо"}\nКатегория: ${input.category || "все категории"}\nМаркировка: ${input.marking ? "нужна" : "не требуется или шаблон общий"}\nПросьба: ${input.instruction || "без дополнительных пожеланий"}\n\nТекущая тема:\n${input.subject || "—"}\n\nТекущий текст:\n${input.body || "—"}`.slice(0, 16000);
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 2500,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  if (response.stop_reason === "refusal") throw new HttpError(502, "ИИ отказался редактировать шаблон — измените формулировку запроса");
  let raw: { subject?: unknown; body?: unknown };
  try {
    raw = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — повторите");
  }
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n/g, "\n").trim() : "";
  if (!subject || !body) throw new HttpError(502, "ИИ вернул пустую тему или текст — повторите");
  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  if (unknown.length) throw new HttpError(502, `ИИ использовал неизвестные подстановки: ${unknown.map((x) => `{${x}}`).join(", ")}`);
  if (mentionsMainDomain(`${subject}\n${body}`)) throw new HttpError(502, "ИИ добавил запрещённый основной домен — отредактируйте шаблон вручную");
  if (/<[a-z][^>]*>/i.test(body)) throw new HttpError(502, "ИИ вернул HTML вместо обычного текста — повторите");
  return { subject, body, usage: usageOf(response) };
}
