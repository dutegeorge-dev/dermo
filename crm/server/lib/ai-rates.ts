/** Ставки доставки из текста / скриншота переписки с перевозчиком (ИИ) — черновики, сохраняет человек. */

import type Anthropic from "@anthropic-ai/sdk";

import { CURRENCIES } from "../../shared/documents.ts";
import { FREIGHT_TRANSPORTS } from "../../shared/quote.ts";
import { type AiUsage, aiBase, aiClient, aiError, usageOf } from "./ai.ts";
import { emptyToNull, fileContent } from "./ai-parse.ts";
import { HttpError } from "./http.ts";

const STR = { type: "string" } as const;
const NUM = { type: ["number", "null"] } as const;
const CUR = { type: "string", enum: [...CURRENCIES] } as const;

// Не больше 16 полей-объединений: строки — "", null — только у чисел.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rates"],
  properties: {
    rates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["carrierName", "transport", "mode", "container", "origin", "destination", "rate", "currency", "kgPerCbm", "minCbm", "fee", "feeCurrency", "transitDays", "etd", "notes"],
        properties: {
          carrierName: STR,
          transport: { type: "string", enum: Object.keys(FREIGHT_TRANSPORTS) },
          mode: { type: "string", enum: ["container", "cbm"] },
          container: { type: "string", enum: ["40HQ", "40GP", "20GP", ""] },
          origin: STR,
          destination: STR,
          rate: { type: "number" },
          currency: CUR,
          kgPerCbm: NUM,
          minCbm: NUM,
          fee: NUM,
          feeCurrency: CUR,
          transitDays: NUM,
          etd: STR,
          notes: STR,
        },
      },
    },
  },
} as const;

const PROMPT = `Перепиши ставки доставки из Китая в Россию из переписки с перевозчиком в карточки. Нет значения — "" (у чисел — null). Ничего не придумывай.
- Каждый вариант доставки (ЖД сборный, авто сборный, контейнер 40HQ…) — отдельная ставка.
- transport: rail (ЖД, railway), truck (авто, LTL / FTL truck), sea (море), multimodal. mode: container — цена за контейнер (FCL, 40HQ, 20GP); cbm — сборный груз, цена за CBM / м³ (LCL, LTL).
- origin / destination — города коротко по-русски («Сиань», «Цзинань», «Москва»); маршрут через погранпереход — в notes.
- rate и currency — ставка (если дана в двух валютах — USD, а вторую валюту напиши в notes). RMB, CNY, ￥ — CNY.
- kgPerCbm — для сборного: «1CBM:500KG» → 500. minCbm — минимальный платный объём («Chargeable weight: 1CBM» → 1).
- fee / feeCurrency — разовые сборы за отправку (H/F & CUS, per BL), в той же валюте, что и ставка, если есть.
- transitDays — срок в пути в днях («About 20 days» → 20). etd — дни отправки или дата («Every FRI», «20 Aug»).
- carrierName — перевозчик или менеджер, если видно. notes — условия (FOB станция / склад, маршрут) коротко по-русски.`;

export type RateDraft = Record<string, unknown>;

export async function recognizeRates(input: { text: string; files: { buffer: Buffer; filename: string; mime: string }[] }): Promise<{ rates: RateDraft[]; usage: AiUsage }> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of input.files.slice(0, 6)) content.push(...(await fileContent(f.buffer, f.filename, f.mime)));
  if (input.text.trim()) content.push({ type: "text", text: input.text.slice(0, 8000) });
  if (!content.length) throw new HttpError(400, "Вставьте текст ставки или скриншот");
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 3000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  try {
    const raw = emptyToNull(JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""))) as { rates: RateDraft[] };
    const today = new Date().toISOString().slice(0, 10);
    return { rates: (raw.rates ?? []).map((r) => ({ ...r, quotedAt: today })), usage: usageOf(response) };
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
}
