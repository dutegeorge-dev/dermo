/**
 * Сервис внутреннего раздела https://tlkbars.ru/crm/.
 * Запуск: `npm start` (из crm/) — слушает CRM_HOST:CRM_PORT (по умолчанию 127.0.0.1:3100).
 */

import fs from "node:fs";

import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/client.ts";
import { purgeExpiredSessions } from "./lib/session.ts";

const app = await buildApp({ logger: true });

if (!fs.existsSync(config.webDist)) {
  app.log.warn(`Фронтенд не собран (${config.webDist}): выполните npm run build`);
}
await fs.promises.mkdir(config.uploadDir, { recursive: true });

const sweep = setInterval(() => {
  purgeExpiredSessions().catch((error) => app.log.error(error, "Не удалось удалить старые сессии"));
}, 6 * 60 * 60 * 1000);
sweep.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal}: останавливаемся`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
