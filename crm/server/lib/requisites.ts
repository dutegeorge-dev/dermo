/**
 * Реквизиты контрагента из текста: блок «Реквизиты сторон» договора, карточка предприятия, письмо, сообщение —
 * что вставили. Схема общая: разбор документа (ai-parse.ts — поле counterparty) и «вставить реквизиты» в форме
 * клиента. Модель только переписывает; цифры чистит и форму (ИП / ООО) уточняет код.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { type AiUsage, aiBase, aiClient, aiError, usageOf } from "./ai.ts";
import { HttpError } from "./http.ts";

const STR = { type: "string" } as const;

/** Поля контрагента в ответе модели (все строки: «нет» — пустая строка, без полей-объединений). */
export const REQUISITE_KEYS = [
  "name",
  "fullName",
  "kind",
  "inn",
  "kpp",
  "ogrn",
  "regNumber",
  "country",
  "address",
  "postalAddress",
  "bankAccount",
  "bankName",
  "bankBik",
  "bankCorrAccount",
  "bankInn",
  "bankAddress",
  "bankSwift",
  "signatoryTitle",
  "signatoryName",
  "signatoryBasis",
  "email",
  "phone",
] as const;

export const REQUISITES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...REQUISITE_KEYS],
  properties: Object.fromEntries(REQUISITE_KEYS.map((k) => [k, k === "kind" ? { type: "string", enum: ["ooo", "ip", "other", "foreign", ""] } : STR])),
} as const;

/** Правила для модели — и для разбора документа, и для вставленных реквизитов. */
export const REQUISITES_RULES = `Реквизиты стороны: name — коротко, как пишут в документах («ООО «Пример»», «ИП Иванова И.И.», «QINGDAO GREAT WAY CO., LTD»); fullName — полное наименование («Общество с ограниченной ответственностью «Пример»», «Индивидуальный предприниматель Иванова Ирина Игоревна»); kind — ooo (ООО, АО и др. юрлица РФ), ip (ИП), foreign (иностранная компания), other. inn — только российский ИНН; kpp; ogrn — ОГРН / ОГРНИП («ОРГН» — опечатка ОГРН); regNumber — рег. номер иностранной компании; address — юридический адрес, postalAddress — почтовый, если другой. Банк: bankAccount — расчётный счёт (р/с), bankName — банк, bankBik — БИК, bankCorrAccount — корр. счёт (к/с), bankInn — ИНН банка, bankAddress — адрес банка, bankSwift. Подписант: signatoryTitle — должность с заглавной («Директор», «Генеральный директор»; у ИП — «Индивидуальный предприниматель»), signatoryName — ФИО полностью в именительном падеже («Иванова Ирина Игоревна»; у ИП — сам предприниматель), signatoryBasis — основание в родительном падеже («Устава», «Доверенности № 5 от 01.02.2026»; у ИП — «ОГРНИП»). Наша компания (ООО «ТЛК БАРС», ИНН 5024256988) — никогда не эта сторона.`;

const digits = (v: string, len: number[]) => {
  const d = v.replace(/\D/g, "");
  return len.includes(d.length) ? d : "";
};

/** Ответ модели → поля контрагента (как в counterpartyValues): цифры без пробелов, форма уточнена кодом. */
export function requisitesValues(raw: Partial<Record<(typeof REQUISITE_KEYS)[number], string | null>> | null | undefined): Record<string, string> {
  const r = raw ?? {};
  const out: Record<string, string> = {};
  const text = (k: (typeof REQUISITE_KEYS)[number], max = 500) => (typeof r[k] === "string" ? r[k]!.trim().slice(0, max) : "");
  const put = (k: string, v: string) => {
    if (v) out[k] = v;
  };
  put("name", text("name", 300));
  put("fullName", text("fullName"));
  put("inn", digits(text("inn"), [10, 12]));
  put("kpp", digits(text("kpp"), [9]));
  put("ogrn", digits(text("ogrn"), [13, 15]));
  put("regNumber", text("regNumber", 60));
  put("country", text("country", 60));
  put("legalAddress", text("address"));
  put("postalAddress", text("postalAddress"));
  put("bankAccount", digits(text("bankAccount"), [20]) || text("bankAccount", 40));
  put("bankName", text("bankName", 300));
  put("bankBik", digits(text("bankBik"), [9]));
  put("bankCorrAccount", digits(text("bankCorrAccount"), [20]));
  put("bankInn", digits(text("bankInn"), [10]));
  put("bankAddress", text("bankAddress"));
  put("bankSwift", text("bankSwift", 20).toUpperCase());
  put("signatoryTitle", text("signatoryTitle", 100));
  put("signatoryName", text("signatoryName", 200));
  put("signatoryBasis", text("signatoryBasis", 200));
  put("email", text("email", 200));
  put("phone", text("phone", 60));
  // Форма: ИП по названию или 12-значному ИНН / 15-значному ОГРНИП; иначе — что сказала модель.
  const name = `${out.name ?? ""} ${out.fullName ?? ""}`;
  const kind = /(^|\s)(ИП|индивидуальный предприниматель)(\s|$)/i.test(name) || out.inn?.length === 12 || out.ogrn?.length === 15 ? "ip" : text("kind", 10);
  if (["ooo", "ip", "other", "foreign"].includes(kind)) out.kind = kind;
  if (out.kind === "ip" && !out.signatoryTitle) out.signatoryTitle = "Индивидуальный предприниматель";
  return out;
}

/** «Вставить реквизиты» в форме контрагента: текст и/или файл (карточка предприятия) → поля. */
export async function parseRequisites(text: string, files: Anthropic.Beta.BetaContentBlockParam[] = []): Promise<{ values: Record<string, string>; usage: AiUsage }> {
  if (!text.trim() && !files.length) throw new HttpError(400, "Вставьте реквизиты");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [...files];
  if (text.trim()) content.push({ type: "text", text: text.slice(0, 8000) });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: REQUISITES_SCHEMA as unknown as Record<string, unknown> } },
      system: `Перепиши реквизиты организации или ИП в карточку CRM. Нет значения — пустая строка. Ничего не придумывай.\n${REQUISITES_RULES.replace(" Наша компания (ООО «ТЛК БАРС», ИНН 5024256988) — никогда не эта сторона.", "")}`,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  try {
    const raw = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
    return { values: requisitesValues(raw), usage: usageOf(response) };
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
}
