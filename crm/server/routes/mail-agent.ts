import type { FastifyInstance } from "fastify";

import { applyMailAgentResult, checkMailAgentToken, nextMailAgentTask, type MailAgentResult } from "../lib/mail/agent.ts";
import { body } from "../lib/http.ts";

/** API рабочего компьютера. Только Bearer-ключ, без cookie и CSRF; тела писем и пароли доступны лишь этому ключу по HTTPS. */
export async function mailAgentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mail/agent/next", async (request) => {
    await checkMailAgentToken(request.headers.authorization);
    return { task: await nextMailAgentTask(body<{ host?: string }>(request).host) };
  });

  app.post("/mail/agent/result", { bodyLimit: 25 * 1024 * 1024 }, async (request) => {
    await checkMailAgentToken(request.headers.authorization);
    const input = body<MailAgentResult & { host?: string }>(request) as MailAgentResult & { host?: string };
    if (!["check", "send", "imap"].includes(input.type)) return { ok: false };
    return applyMailAgentResult(input, input.host);
  });
}
