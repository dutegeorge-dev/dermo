/**
 * Сервис внутреннего раздела https://tlkbars.ru/crm/.
 * Запуск: `npm start` (из crm/) — слушает CRM_HOST:CRM_PORT (по умолчанию 127.0.0.1:3100).
 */

import fs from "node:fs";

import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/client.ts";
import { kickCatalogQueue, resetCatalogQueue, sweepPartialUploads } from "./lib/catalogs.ts";
import { purgeExpiredSessions } from "./lib/session.ts";
import { startLeadgenWorker } from "./lib/leadgen/worker.ts";
import { startMailWorker } from "./lib/mail/worker.ts";
import { startTelegramBot } from "./lib/telegram-bot.ts";

const app = await buildApp({ logger: true });

if (!fs.existsSync(config.webDist)) {
  app.log.warn(`Фронтенд не собран (${config.webDist}): выполните npm run build`);
}
await fs.promises.mkdir(config.uploadDir, { recursive: true });

const sweep = setInterval(() => {
  purgeExpiredSessions().catch((error) => app.log.error(error, "Не удалось удалить старые сессии"));
  sweepPartialUploads().catch((error) => app.log.error(error, "Не удалось удалить брошенные загрузки каталогов"));
}, 6 * 60 * 60 * 1000);
sweep.unref();

let stopBot = () => {};
let stopLeadgen: () => Promise<void> = async () => {};
let stopMail: () => Promise<void> = async () => {};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal}: останавливаемся`);
    stopBot();
    await stopLeadgen();
    await stopMail();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });

// Каталоги фабрик: прерванные перезапуском разборы — снова в очередь, очередь — в работу.
await resetCatalogQueue().catch((error) => app.log.error(error, "Каталоги: не удалось вернуть разборы в очередь"));
kickCatalogQueue();

// Бот заявок в Telegram (если задан CRM_TELEGRAM_BOT_TOKEN).
stopBot = startTelegramBot(app.log);

// Сбор базы для лидогенерации WB — обычно отдельная служба bars-crm-leadgen; внутри сервера — при CRM_LEADGEN_INLINE=true.
if (config.leadgen.inlineWorker) {
  stopLeadgen = startLeadgenWorker({ info: (m) => app.log.info(m), error: (m) => app.log.error(m) });
}

// Рассылка (только план дня) — обычно служба bars-crm-mail; внутри сервера — при CRM_MAIL_INLINE=true.
if (config.mail.inlineWorker) {
  stopMail = startMailWorker({ info: (m) => app.log.info(m), error: (m) => app.log.error(m) });
}
