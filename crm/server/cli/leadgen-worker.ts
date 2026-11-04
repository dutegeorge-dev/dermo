/**
 * Воркер лидогенерации WB: берёт задачи «Собрать базу на месяц» из lead_jobs и выполняет их (часами).
 * Запуск: `npm run leadgen:worker` (в проде — systemd-служба bars-crm-leadgen, deploy/systemd/bars-crm-leadgen.service).
 * Остановка (SIGTERM) не теряет прогресс: задача продолжится с места остановки при следующем запуске.
 */

import { pool } from "../db/client.ts";
import { startLeadgenWorker } from "../lib/leadgen/worker.ts";

const stamp = () => new Date().toISOString();
const stop = startLeadgenWorker({
  info: (m) => console.log(`${stamp()} ${m}`),
  error: (m) => console.error(`${stamp()} ${m}`),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`${stamp()} ${signal}: останавливаемся`);
    await stop();
    await pool.end();
    process.exit(0);
  });
}
