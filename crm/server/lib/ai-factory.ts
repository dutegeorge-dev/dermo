/**
 * Карточка фабрики по скриншотам WeChat (профиль, переписка), фото, прайсам и каталогам: ИИ заполняет
 * анкету и цены, работник проверяет и сохраняет. Сканы PDF без текста не отправляем (дорого) — они просто
 * прикрепляются к фабрике.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { CURRENCIES } from "../../shared/documents.ts";
import { EMPTY_PROFILE, type FactoryProfile, type Offer } from "../../shared/factories.ts";
import { type AiUsage, aiBase, aiClient, aiError, usageOf } from "./ai.ts";
import { emptyToNull, fileContent } from "./ai-parse.ts";
import { pdfText } from "./file-text.ts";
import { HttpError } from "./http.ts";

/** Картинка больше — не отправляем (лимит API ~5 МБ на картинку в base64). */
const MAX_IMAGE_BYTES = 3_700_000;
const MAX_IMAGES = 8;

const STR = { type: "string" } as const;
const NUM = { type: ["number", "null"] } as const;
const YES_NO = { type: "string", enum: ["yes", "no", ""] } as const;

// Не больше 16 полей-объединений: «нет значения» у строк — "", null — только у чисел.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "nameRu", "wechatId", "contactName", "phone", "email", "website", "location", "categories", "profile", "offers", "notes"],
  properties: {
    name: STR,
    nameRu: STR,
    wechatId: STR,
    contactName: STR,
    phone: STR,
    email: STR,
    website: STR,
    location: STR,
    categories: { type: "array", items: { type: "string" } },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["leadTime", "prices", "lot", "moq", "exportLicense", "vtbShanghai", "russianClients", "samples", "hsCode"],
      properties: {
        leadTime: STR,
        prices: STR,
        lot: STR,
        moq: STR,
        exportLicense: YES_NO,
        vtbShanghai: YES_NO,
        russianClients: STR,
        samples: STR,
        hsCode: STR,
      },
    },
    offers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productName", "name", "price", "currency", "unit", "moq", "perContainer", "kgPerUnit", "conditions"],
        properties: {
          productName: STR,
          name: STR,
          price: NUM,
          currency: { type: "string", enum: [...CURRENCIES, ""] },
          unit: STR,
          moq: NUM,
          perContainer: NUM,
          kgPerUnit: NUM,
          conditions: STR,
        },
      },
    },
    notes: STR,
  },
} as const;

const PROMPT = `Ты помогаешь закупщику ООО «ТЛК БАРС» (закупка товаров в Китае для России) завести карточку фабрики. Тебе даны скриншоты WeChat (профиль контакта, переписка), фото, прайсы, каталоги, анкеты. Перепиши в карточку только то, что видно. Нет значения — пустая строка "" (у чисел — null). Ничего не придумывай.

- name — имя контакта в WeChat ровно как написано (часто название фабрики + имя менеджера: «A-某某地板厂-小王»). wechatId — «WeChat ID: …» / «微信号» без префикса. contactName — имя менеджера (小王, Lily Chen).
- nameRu — коротко по-русски: фабрика + что делает («Демо-фабрика — SPC-ламинат»). categories — 1–4 категории товара по-русски, строчными: «искусственная трава», «spc-ламинат», «ковролин», «пвх-покрытие».
- location — место производства по-русски («Линьи, провинция Шаньдун»).
- profile — анкета: leadTime — сроки производства; prices — цены с характеристиками текстом («300 г — 5 юаней, 200 г — 3,5 юаня»); lot — вес и объём партии (сколько в контейнере); moq — минимальный объём; exportLicense и vtbShanghai — есть ли экспортная лицензия и счёт в ВТБ Шанхай (yes / no / ""); russianClients — работали ли с российскими клиентами и с каким товаром; samples — что с образцами; hsCode — код ТН ВЭД, если назван.
- offers — каждая названная цена отдельно: productName — товар по-русски без размера рулона и цвета («Искусственная трава 20 мм»); name — позиция как у фабрики с характеристиками (плотность, ширина, цвет); price — число за единицу; currency — CNY (юань, RMB, ￥, 元), USD, EUR; unit — единица цены по-русски (м², м, шт, кг, рул.); moq — минимальный заказ в этих единицах; perContainer — сколько единиц входит в 40HQ, если сказано; kgPerUnit — вес единицы в кг, если сказано (400 г/м² → 0.4); conditions — условия коротко (EXW / FOB, город, «от 5000 м²»).
- Числа: «2,8» и «2.8» — 2.8; «15 000» — 15000.
- notes — 1–2 предложения по-русски: что важного в переписке, чего нет в полях.`;

export type FactoryDraft = {
  name: string | null;
  nameRu: string | null;
  wechatId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  location: string | null;
  categories: string[];
  profile: FactoryProfile;
  offers: Offer[];
  notes: string | null;
  /** Что не отправили ИИ (большие картинки, сканы PDF). */
  skipped: string[];
};

type RawDraft = Omit<FactoryDraft, "offers" | "skipped" | "profile"> & {
  profile: Partial<Record<keyof FactoryProfile, string | null>>;
  offers: (Omit<Offer, "productId" | "m3PerUnit" | "quotedAt" | "conditions" | "currency"> & { conditions: string | null; currency: string | null })[];
};

export async function recognizeFactory(files: { buffer: Buffer; filename: string; mime: string }[]): Promise<{ draft: FactoryDraft; usage: AiUsage }> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const skipped: string[] = [];
  let images = 0;
  for (const f of files) {
    const isImage = f.mime.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(f.filename);
    if (isImage) {
      if (f.buffer.length > MAX_IMAGE_BYTES) {
        skipped.push(`${f.filename} — картинка больше 3,7 МБ`);
        continue;
      }
      if (images >= MAX_IMAGES) {
        skipped.push(`${f.filename} — больше ${MAX_IMAGES} картинок за раз`);
        continue;
      }
      images++;
    }
    if (/\.pdf$/i.test(f.filename) || f.mime === "application/pdf") {
      const text = await pdfText(f.buffer).catch(() => "");
      if (text.replace(/\s/g, "").length < 40) {
        skipped.push(`${f.filename} — PDF без текста (скан), не разбирали`);
        continue;
      }
    }
    try {
      content.push(...(await fileContent(f.buffer, f.filename, f.mime)));
    } catch (error) {
      skipped.push(`${f.filename} — ${error instanceof HttpError ? error.message : "не прочитан"}`);
    }
  }
  if (!content.length) throw new HttpError(400, skipped.length ? `Нечего разбирать: ${skipped.join("; ")}` : "Пришлите скриншоты, фото или прайсы");
  content.push({ type: "text", text: "Заполни карточку фабрики по этим файлам." });

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 8000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  if (response.stop_reason === "refusal") throw new HttpError(502, "ИИ отказался разбирать эти файлы — заполните вручную");
  let raw: RawDraft;
  try {
    raw = emptyToNull(JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""))) as RawDraft;
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
  const profile: FactoryProfile = { ...EMPTY_PROFILE };
  for (const k of Object.keys(EMPTY_PROFILE) as (keyof FactoryProfile)[]) {
    const v = raw.profile?.[k];
    if (typeof v === "string") (profile as Record<string, string>)[k] = v;
  }
  const draft: FactoryDraft = {
    name: raw.name,
    nameRu: raw.nameRu,
    wechatId: raw.wechatId?.replace(/^(wechat\s*id|微信号)\s*[:：]?\s*/i, "") ?? null,
    contactName: raw.contactName,
    phone: raw.phone,
    email: raw.email,
    website: raw.website,
    location: raw.location,
    categories: (raw.categories ?? []).map((c) => c.toLowerCase()).slice(0, 6),
    profile,
    offers: (raw.offers ?? [])
      .filter((o) => o.name || o.productName)
      .map((o) => ({
        productId: null,
        productName: o.productName,
        name: o.name || o.productName || "",
        price: o.price,
        currency: o.currency || "CNY",
        unit: o.unit,
        moq: o.moq,
        perContainer: o.perContainer,
        kgPerUnit: o.kgPerUnit,
        m3PerUnit: null,
        conditions: o.conditions ?? "",
        quotedAt: new Date().toISOString().slice(0, 10),
      })),
    notes: raw.notes,
    skipped,
  };
  return { draft, usage: usageOf(response) };
}
