/** Пароли: argon2id (параметры по рекомендации OWASP). */

import { hash, verify } from "@node-rs/argon2";

// Алгоритм по умолчанию в @node-rs/argon2 — Argon2id (хэш начинается с $argon2id$).
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

/** Хэш-пустышка: проверяем пароль и для несуществующего логина, чтобы время ответа не выдавало, есть ли такой пользователь. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль — не короче ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (password.length > 200) return "Пароль слишком длинный";
  return null;
}
