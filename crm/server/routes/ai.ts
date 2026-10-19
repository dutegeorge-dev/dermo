/** ИИ: статус, разбор документа в черновик формы, чат по данным CRM. */

import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { aiEnabled } from "../lib/ai.ts";
import { type ChatMessage, chatReply } from "../lib/ai-chat.ts";
import { recognizeFactory } from "../lib/ai-factory.ts";
import { recognizeRates } from "../lib/ai-rates.ts";
import { fileContent, parseDocumentFile } from "../lib/ai-parse.ts";
import { parseRequisites } from "../lib/requisites.ts";
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

  /** multipart, несколько файлов (скриншоты WeChat, фото, прайсы) → черновик карточки фабрики (ничего не сохраняет). */
  app.post("/recognize-factory", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    const files: { buffer: Buffer; filename: string; mime: string }[] = [];
    for await (const part of request.files({ limits: { files: 12 } })) {
      files.push({ buffer: await part.toBuffer(), filename: part.filename || "file", mime: part.mimetype || "application/octet-stream" });
    }
    if (!files.length) throw new HttpError(400, "Нет файлов");
    const { draft, usage } = await recognizeFactory(files);
    request.log.info({ ai: "factory", model: config.ai.model, files: files.length, usage }, "ИИ: карточка фабрики");
    return { draft };
  });

  /** multipart: поле text (вставленная переписка) и/или скриншоты → черновики ставок доставки. */
  app.post("/recognize-rates", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    const files: { buffer: Buffer; filename: string; mime: string }[] = [];
    let text = "";
    for await (const part of request.parts({ limits: { files: 6 } })) {
      if (part.type === "file") files.push({ buffer: await part.toBuffer(), filename: part.filename || "file", mime: part.mimetype || "application/octet-stream" });
      else if (part.fieldname === "text") text = String(part.value ?? "");
    }
    const { rates, usage } = await recognizeRates({ text, files });
    request.log.info({ ai: "rates", model: config.ai.model, files: files.length, usage }, "ИИ: ставки доставки");
    return { rates };
  });

  /** multipart: text (вставленные реквизиты) и/или файл (карточка предприятия) → поля контрагента. */
  app.post("/parse-requisites", async (request) => {
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    let text = "";
    const blocks = [];
    for await (const part of request.parts({ limits: { files: 2 } })) {
      if (part.type === "file") blocks.push(...(await fileContent(await part.toBuffer(), part.filename || "file", part.mimetype || "application/octet-stream")));
      else if (part.fieldname === "text") text = String(part.value ?? "");
    }
    const { values, usage } = await parseRequisites(text, blocks);
    request.log.info({ ai: "requisites", model: config.ai.model, usage }, "ИИ: реквизиты");
    return { values };
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
