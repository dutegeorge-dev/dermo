/** ИИ: статус, разбор документа в черновик формы, чат по данным CRM. */

import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { aiEnabled } from "../lib/ai.ts";
import { type ChatMessage, chatReply } from "../lib/ai-chat.ts";
import { parseDocumentFile } from "../lib/ai-parse.ts";
import { body, HttpError } from "../lib/http.ts";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/status", async () => ({ enabled: aiEnabled() }));

  /** multipart, поле file → черновик документа (ничего не сохраняет). */
  app.post("/parse-document", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    const file = await request.file();
    if (!file) throw new HttpError(400, "Нет файла");
    const buffer = await file.toBuffer();
    const { draft, usage } = await parseDocumentFile(db, buffer, file.filename, file.mimetype);
    request.log.info({ ai: "parse", model: config.ai.model, file: file.filename, usage }, "ИИ: разбор документа");
    return { draft };
  });

  /** { messages: [{ role, content }], page? } → { reply }. История — только текст, её хранит браузер. */
  app.post("/chat", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    const input = body<{ messages: unknown; page: unknown }>(request);
    const raw = Array.isArray(input.messages) ? input.messages : [];
    const messages: ChatMessage[] = raw
      .filter((m): m is ChatMessage => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && !!m.content.trim())
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") throw new HttpError(400, "Напишите вопрос");
    const page = typeof input.page === "string" && input.page.startsWith("/") ? input.page.slice(0, 200) : null;
    const { reply, tools, usage } = await chatReply(app, request, messages, page);
    request.log.info({ ai: "chat", model: config.ai.model, tools, usage }, "ИИ: ответ в чате");
    return { reply, tools };
  });
}
