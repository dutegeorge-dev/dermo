/**
 * Контакты с сайта компании (если Checko дал сайт, а email нет): главная + страница контактов, email и телефоны
 * регулярками. И проверка email: синтаксис + MX-запись домена.
 */

import dns from "node:dns";

import { emailSyntaxOk } from "../../../shared/leadgen.ts";
import type { Http } from "./http.ts";
import type { RawContacts } from "./registry.ts";

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const PHONE_IN_TEXT = /(?:\+7|(?<!\d)8)[\s -]*\(?\d{3}\)?[\s -]*\d{3}[\s -]*\d{2}[\s -]*\d{2}(?!\d)/g;
/** «Почты» из картинок, заглушек и сервисов сайта — не контакты. */
const JUNK_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|sentry|wixpress|domain|email|site)\.|^(no-?reply|noreply|mailer-daemon)@/i;

export function extractContacts(html: string): { emails: string[]; phones: string[] } {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&#64;|&commat;|\s*\[at\]\s*|\s*\(at\)\s*/gi, "@");
  const emails = [...new Set([...text.matchAll(EMAIL_IN_TEXT)].map((m) => m[0].toLowerCase()).filter((e) => !JUNK_EMAIL.test(e)))];
  const tel = [...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1]));
  const plain = text.replace(/<[^>]+>/g, " ");
  const phones = [...new Set([...tel, ...[...plain.matchAll(PHONE_IN_TEXT)].map((m) => m[0])])];
  return { emails, phones };
}

/** Ссылки на страницу контактов с главной (тот же домен), максимум 2. */
export function contactLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, " ").toLowerCase();
    if (!/contact|kontakt|контакт/i.test(href) && !/контакт|contact|связаться/.test(label)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, "") !== new URL(base).hostname.replace(/^www\./, "")) continue;
      if (!out.includes(u.href)) out.push(u.href);
    } catch {
      /* кривая ссылка */
    }
    if (out.length >= 2) break;
  }
  return out;
}

export async function siteContacts(http: Http, site: string): Promise<RawContacts> {
  const pages: string[] = [];
  const get = async (url: string) => {
    try {
      const res = await http.request(url, { headers: { accept: "text/html,application/xhtml+xml" }, maxBytes: 1_500_000 });
      return res.status >= 200 && res.status < 300 && /html|text/i.test(res.contentType || "text/html") ? res : null;
    } catch {
      return null; // сайт не открылся — не повод останавливать сбор
    }
  };
  const home = await get(site);
  if (!home) return { phones: [], emails: [], sites: [] };
  pages.push(home.text);
  let links = contactLinks(home.text, home.url);
  if (!links.length) links = [new URL("/contacts", home.url).href];
  for (const link of links) {
    const page = await get(link);
    if (page) pages.push(page.text);
  }
  const found = pages.map(extractContacts);
  return { emails: [...new Set(found.flatMap((f) => f.emails))], phones: [...new Set(found.flatMap((f) => f.phones))], sites: [] };
}

const mxCache = new Map<string, Promise<boolean | null>>();

/** Есть ли у домена MX-запись. null — DNS не ответил (не считаем ошибкой адреса). */
export function domainAcceptsMail(domain: string): Promise<boolean | null> {
  const key = domain.toLowerCase();
  let hit = mxCache.get(key);
  if (!hit) {
    hit = (async () => {
      const timeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), 8000))]);
      try {
        const mx = await timeout(dns.promises.resolveMx(key));
        return mx.some((r) => r.exchange && r.exchange !== ".");
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL" || code === "ENONAME") return false;
        return null;
      }
    })();
    mxCache.set(key, hit);
  }
  return hit;
}

/** Проверка email: синтаксис и MX. valid=false — хранится, но помечен. */
export async function checkEmail(email: string, mx: (domain: string) => Promise<boolean | null> = domainAcceptsMail): Promise<{ valid: boolean; note: string | null }> {
  if (!emailSyntaxOk(email)) return { valid: false, note: "ошибка в адресе" };
  const ok = await mx(email.split("@")[1]);
  if (ok === false) return { valid: false, note: "у домена нет MX" };
  return { valid: true, note: ok === null ? "MX не проверен (DNS не ответил)" : null };
}
