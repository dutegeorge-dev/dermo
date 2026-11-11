import os from "node:os";

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

type Mailbox = {
  id: number;
  email: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  password: string;
};
type Mail = { from: { name: string; address: string }; to: string; subject: string; text: string; messageId: string; inReplyTo?: string; references?: string; headers: Record<string, string> };
type Task =
  | { type: "idle"; message: string }
  | { type: "check"; mailboxId: number; mailbox: Mailbox; testTo: string | null; testMail: Mail | null }
  | { type: "send"; messageId: number; mailbox: Mailbox; mail: Mail }
  | { type: "imap"; mailboxId: number; mailbox: Mailbox; cursor: { uidValidity: number | null; lastUid: number | null } };
type Fetched = { uid: number; source: Buffer };

const rawBase = (process.env.CRM_URL ?? "https://datapoint-sync.ru").trim().replace(/\/+$/, "");
const base = `${rawBase.replace(/\/crm$/, "")}/crm/api/mail/agent`;
const token = (process.env.CRM_MAIL_AGENT_TOKEN ?? "").trim();
const once = process.env.CRM_MAIL_AGENT_ONCE === "1" || process.argv.includes("--once");
const interval = Math.max(1000, Number(process.env.CRM_MAIL_AGENT_INTERVAL_MS) || 2000);
const stamp = () => `[${new Date().toISOString()}]`;
const info = (message: string) => process.stdout.write(`${stamp()} ${message}\n`);
const errorLog = (message: string) => process.stderr.write(`${stamp()} ${message}\n`);
let lastContactAt: string | null = null;
let lastIdleLog = 0;
let hadError = false;
if (!token) {
  errorLog("Задайте CRM_MAIL_AGENT_TOKEN — ключ выпускается в CRM: Рассылка → Ящики → Ключ локального агента.");
  process.exit(1);
}

async function api(path: "next" | "result", payload: unknown): Promise<{ task: Task } | { ok: true }> {
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let data: { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`CRM HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new Error(`CRM HTTP ${response.status}: ${data.error ?? "ошибка"}`);
  return data as { task: Task };
}

function smtp(mailbox: Mailbox) {
  return nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpSecure,
    requireTLS: !mailbox.smtpSecure,
    auth: { user: mailbox.smtpUser, pass: mailbox.password },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    logger: false,
    debug: false,
  });
}

const errorText = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & { code?: string; command?: string; rejectedFrom?: string; responseStatus?: string; responseText?: string; serverResponseCode?: string; cause?: { code?: string } };
  const causeCode = typeof e.cause === "object" && e.cause ? e.cause.code : undefined;
  return [
    e.message,
    causeCode && `причина ${causeCode}`,
    e.responseStatus && `статус ${e.responseStatus}`,
    e.responseText && `ответ: ${e.responseText}`,
    e.serverResponseCode && `код ${e.serverResponseCode}`,
    e.code && `ошибка ${e.code}`,
    e.command && `команда ${e.command}`,
    e.rejectedFrom && `этап ${e.rejectedFrom}`,
  ].filter(Boolean).join(" · ");
};

async function check(task: Extract<Task, { type: "check" }>) {
  const transport = smtp(task.mailbox);
  const result = { type: "check", mailboxId: task.mailboxId, smtp: { ok: false, error: "" }, imap: { ok: false, error: "" }, test: null as { ok: boolean; error?: string } | null };
  try {
    await transport.verify();
    result.smtp = { ok: true, error: "" };
  } catch (error) {
    result.smtp = { ok: false, error: errorText(error).slice(0, 1000) };
  }
  const client = new ImapFlow({ host: task.mailbox.imapHost, port: task.mailbox.imapPort, secure: task.mailbox.imapPort === 993, auth: { user: task.mailbox.imapUser, pass: task.mailbox.password }, logger: false });
  try {
    await client.connect();
    result.imap = { ok: true, error: "" };
  } catch (error) {
    result.imap = { ok: false, error: errorText(error).slice(0, 1000) };
  } finally {
    await client.logout().catch(() => client.close());
  }
  if (task.testMail && result.smtp.ok) {
    try {
      await transport.sendMail({ ...task.testMail, textEncoding: "quoted-printable" });
      result.test = { ok: true };
    } catch (error) {
      result.test = { ok: false, error: errorText(error).slice(0, 1000) };
    }
  }
  transport.close();
  await api("result", { ...result, host: os.hostname() });
  info(`${task.mailbox.email}: SMTP ${result.smtp.ok ? "OK" : result.smtp.error}; IMAP ${result.imap.ok ? "OK" : result.imap.error}${result.test ? `; тест ${result.test.ok ? "отправлен" : result.test.error}` : ""}`);
}

async function send(task: Extract<Task, { type: "send" }>) {
  const transport = smtp(task.mailbox);
  let accepted = false;
  try {
    try {
      await transport.sendMail({ ...task.mail, textEncoding: "quoted-printable" });
      accepted = true;
      await api("result", { type: "send", messageId: task.messageId, ok: true, host: os.hostname() });
      info(`${task.mailbox.email}: письмо ${task.messageId} отправлено`);
    } catch (error) {
      if (accepted) throw new Error(`SMTP принял письмо ${task.messageId}, но CRM не подтвердила результат. Не перезапускайте это письмо вручную: проверьте связь и журнал sending. ${errorText(error)}`);
      await api("result", { type: "send", messageId: task.messageId, ok: false, error: errorText(error).slice(0, 1000), responseCode: (error as { responseCode?: number }).responseCode, host: os.hostname() });
      errorLog(`${task.mailbox.email}: письмо ${task.messageId} — ${errorText(error)}`);
    }
  } finally {
    transport.close();
  }
}

async function fetchImap(task: Extract<Task, { type: "imap" }>) {
  const client = new ImapFlow({ host: task.mailbox.imapHost, port: task.mailbox.imapPort, secure: task.mailbox.imapPort === 993, auth: { user: task.mailbox.imapUser, pass: task.mailbox.password }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (!box) throw new Error("INBOX не открылся");
      const uidValidity = Number(box.uidValidity);
      const top = Number(box.uidNext) - 1;
      if (task.cursor.lastUid === null || task.cursor.uidValidity !== uidValidity) return { uidValidity, lastUid: top, messages: [] as Fetched[] };
      const messages: Fetched[] = [];
      if (top > task.cursor.lastUid) {
        for await (const msg of client.fetch(`${task.cursor.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= task.cursor.lastUid || !msg.source) continue;
          messages.push({ uid: msg.uid, source: msg.source.length > 3_000_000 ? msg.source.subarray(0, 3_000_000) : msg.source });
          if (messages.length >= 200) break;
        }
      }
      return { uidValidity, lastUid: messages.length ? Math.max(...messages.map((m) => m.uid)) : task.cursor.lastUid, messages };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function inbound(task: Extract<Task, { type: "imap" }>) {
  try {
    const result = await fetchImap(task);
    if (!result.messages.length) {
      await api("result", { type: "imap", mailboxId: task.mailboxId, ok: true, uidValidity: result.uidValidity, lastUid: result.lastUid, messages: [], done: true, host: os.hostname() });
    } else {
      for (let offset = 0; offset < result.messages.length; offset += 5) {
        const messages = result.messages.slice(offset, offset + 5);
        const done = offset + 5 >= result.messages.length;
        await api("result", { type: "imap", mailboxId: task.mailboxId, ok: true, uidValidity: result.uidValidity, lastUid: messages.at(-1)!.uid, messages: messages.map((m) => ({ uid: m.uid, source: m.source.toString("base64") })), done, host: os.hostname() });
      }
    }
    info(`${task.mailbox.email}: IMAP OK, новых входящих ${result.messages.length}`);
  } catch (error) {
    await api("result", { type: "imap", mailboxId: task.mailboxId, ok: false, error: errorText(error).slice(0, 1000), host: os.hostname() });
    errorLog(`${task.mailbox.email}: IMAP — ${errorText(error)}`);
  }
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
info(`Локальный агент рассылки запущен: ${os.hostname()} → ${rawBase}. Остановка: Ctrl+C.`);
while (!stopping) {
  try {
    const response = await api("next", { host: os.hostname() }) as { task: Task };
    lastContactAt = new Date().toISOString();
    if (hadError) info("Связь с CRM восстановлена: агент снова работает нормально");
    hadError = false;
    const task = response.task;
    if (task.type === "check") await check(task);
    else if (task.type === "send") await send(task);
    else if (task.type === "imap") await inbound(task);
    if (task.type === "idle") {
      if (Date.now() - lastIdleLog >= 60_000) {
        info(`Состояние: агент работает нормально; CRM доступна; заданий нет. Последний ответ CRM: ${lastContactAt}`);
        lastIdleLog = Date.now();
      }
      if (!once) await new Promise((resolve) => setTimeout(resolve, interval));
    }
  } catch (error) {
    hadError = true;
    errorLog(`Агент: ${errorText(error)}`);
    if (once) process.exitCode = 1;
    await new Promise((resolve) => setTimeout(resolve, Math.max(interval, 5000)));
  }
  if (once) break;
}
