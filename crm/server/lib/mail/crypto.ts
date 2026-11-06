/**
 * Пароли ящиков: AES-256-GCM, ключ — MAILBOX_SECRET_KEY (64 hex-символа = 32 байта, иначе — SHA-256 от строки).
 * В БД — «v1:<base64(iv | tag | шифротекст)>»; наружу (API, логи) пароль не отдаётся никогда.
 */

import crypto from "node:crypto";

import { config } from "../../config.ts";
import { HttpError } from "../http.ts";

function key(): Buffer {
  const raw = config.mail.secretKey;
  if (!raw) throw new HttpError(500, "Не задан MAILBOX_SECRET_KEY в crm/.env — пароли ящиков не зашифровать (openssl rand -hex 32)");
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const m = /^v1:(.+)$/.exec(stored);
  if (!m) throw new HttpError(500, "Пароль ящика в неизвестном формате — сохраните его заново");
  const buf = Buffer.from(m[1], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(500, "Пароль ящика не расшифровывается — сменился MAILBOX_SECRET_KEY? Сохраните пароль заново");
  }
}
