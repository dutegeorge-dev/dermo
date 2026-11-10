/**
 * Воркер рассылки: только план дня; SMTP и IMAP выполняет локальный HTTPS-агент.
 * Запуск: `npm run mail:worker` (в проде — systemd-служба bars-crm-mail, deploy/systemd/bars-crm-mail.service).
 */

import { pool } from "../db/client.ts";
import { startMailWorker } from "../lib/mail/worker.ts";

const stamp = () => new Date().toISOString();
const stop = startMailWorker({ info: (m) => console.log(`${stamp()} ${m}`), error: (m) => console.error(`${stamp()} ${m}`) });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`${stamp()} ${signal}: останавливаемся`);
    await stop();
    await pool.end();
    process.exit(0);
  });
}
