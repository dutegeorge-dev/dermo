/**
 * Создание администратора из консоли (первый вход в систему):
 *
 *   npm run crm:create-admin -- --login admin --name "Иван Петров" [--email a@b.ru]
 *
 * Пароль спрашивается интерактивно (в историю shell не попадает) или берётся
 * из переменной CRM_ADMIN_PASSWORD. Если логин уже есть, команда откажет;
 * с флагом --reset — задаст новый пароль, роль admin и включит учётку
 * (на случай, если доступ к единственному админу потерян).
 */

import readline from "node:readline";
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { db, pool } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { hashPassword, validatePassword } from "../lib/password.ts";
import { destroyUserSessions } from "../lib/session.ts";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    reset: { type: "boolean", default: false },
  },
});

/** Читает строку из терминала, не показывая ввод. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const mutable = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    mutable._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<void> {
  const login = values.login?.trim().toLowerCase();
  if (!login || !/^[a-z0-9._@-]{3,64}$/.test(login)) {
    throw new Error('Укажите --login (3–64 символа: латиница, цифры, «.», «-», «_», «@»)');
  }

  let password = process.env.CRM_ADMIN_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) throw new Error("Нет терминала: передайте пароль в CRM_ADMIN_PASSWORD");
    password = await askHidden("Пароль: ");
    const repeat = await askHidden("Повторите пароль: ");
    if (password !== repeat) throw new Error("Пароли не совпадают");
  }
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);

  const [existing] = await db.select().from(users).where(eq(users.login, login));
  if (existing && !values.reset) {
    throw new Error(`Пользователь ${login} уже есть. Чтобы задать ему новый пароль и роль admin — добавьте --reset`);
  }

  const passwordHash = await hashPassword(password);
  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, role: "admin", isActive: true, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    await destroyUserSessions(existing.id);
    await audit(db, {
      userId: null,
      action: "update",
      entityType: "user",
      entityId: existing.id,
      summary: `CLI: сброшен пароль администратора ${login}`,
    });
    console.log(`✓ Пароль пользователя ${login} обновлён, роль — admin`);
    return;
  }

  const name = values.name?.trim() || login;
  const [created] = await db
    .insert(users)
    .values({ login, name, email: values.email?.trim() || null, role: "admin", passwordHash })
    .returning({ id: users.id });
  await audit(db, {
    userId: null,
    action: "create",
    entityType: "user",
    entityId: created.id,
    summary: `CLI: создан администратор ${name} (${login})`,
  });
  console.log(`✓ Администратор ${login} создан. Вход: https://tlkbars.ru/crm/`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
