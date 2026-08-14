/**
 * Уведомления о заявках в Telegram.
 *
 * Дублируют лид в чат менеджера: CRM — система учёта, Telegram — быстрый
 * сигнал «пришла заявка». Отправка намеренно не влияет на ответ клиенту:
 * упавший Telegram не должен превращать принятую заявку в ошибку формы,
 * поэтому функция никогда не бросает исключение.
 */

import { config } from "./config.ts";
import type { LeadInput } from "./lead.ts";

/** Экранирование под parse_mode: HTML (Telegram требует только эти три). */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Строка «Ключ: значение», если значение непустое. */
function line(label: string, value: string): string | null {
  return value ? `<b>${label}:</b> ${escapeHtml(value)}` : null;
}

/** Ссылка на карточку лида в портале. */
function leadUrl(leadId: number): string {
  const origin = new URL(config.bitrix.base).origin;
  return `${origin}/crm/lead/details/${leadId}/`;
}

/** Текст уведомления о заявке. */
function buildMessage(
  lead: LeadInput,
  result: { leadId: number | null; error?: string },
): string {
  const header = result.leadId
    ? "🔔 <b>Новая заявка с сайта</b>"
    : "⚠️ <b>Заявка с сайта — НЕ попала в CRM</b>";

  const contact = [
    lead.phone ? `<a href="tel:${escapeHtml(lead.phone)}">${escapeHtml(lead.phone)}</a>` : "",
    lead.email ? escapeHtml(lead.email) : "",
    lead.telegram ? escapeHtml(lead.telegram) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const utm = Object.entries(lead.utm)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");

  const rows = [
    header,
    "",
    contact ? `<b>Контакт:</b> ${contact}` : null,
    line("Как ввёл клиент", lead.contact),
    line("Имя", lead.name),
    line("Груз", lead.cargo),
    line("Объём/вес", lead.volume),
    line("Комментарий", lead.comment),
    "",
    line("Страница", lead.page),
    line("Форма", lead.form),
    line("Язык", lead.locale),
    utm ? line("UTM", utm) : null,
    "",
    result.leadId
      ? `✅ Лид <a href="${leadUrl(result.leadId)}">#${result.leadId}</a> в CRM`
      : `❌ Ошибка CRM: ${escapeHtml(result.error ?? "неизвестно")}\nЗаявка сохранена в logs/leads-failed.jsonl — свяжитесь с клиентом вручную.`,
  ];

  return rows.filter((row) => row !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Одна попытка отправки в конкретный чат. */
async function sendToChat(chatId: string, text: string): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(config.telegram.timeoutMs),
    },
  );

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };

  if (!body.ok) {
    throw new Error(body.description ?? `HTTP ${response.status}`);
  }
}

/**
 * Отправляет уведомление во все настроенные чаты.
 * Ошибки логируются, но наружу не пробрасываются.
 */
export async function notifyTelegram(
  lead: LeadInput,
  result: { leadId: number | null; error?: string },
): Promise<void> {
  if (!config.telegram.enabled) return;

  const text = buildMessage(lead, result);

  await Promise.all(
    config.telegram.chatIds.map(async (chatId) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await sendToChat(chatId, text);
          return;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (attempt === 1) {
            console.error(`[lead] Telegram (чат ${chatId}) недоступен: ${reason}`);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        }
      }
    }),
  );
}
