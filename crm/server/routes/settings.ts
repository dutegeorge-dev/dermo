/** Настройки: реквизиты компании и шаблоны поручения и договора комиссии (admin). */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { FastifyInstance } from "fastify";

import type { BankAccount, CompanySettings } from "../../shared/company.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { audit } from "../lib/audit.ts";
import { body, HttpError, requireAdmin } from "../lib/http.ts";
import { CONTRACT_TEMPLATE } from "../lib/contract.ts";
import { ORDER_TEMPLATE } from "../lib/order.ts";
import { getCompany, setCompany } from "../lib/settings.ts";

const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Шаблоны документов: встроенный и свой (CRM_UPLOAD_DIR/templates/<name>.docx). */
const TEMPLATES = {
  commission_order: { label: "поручение", builtin: ORDER_TEMPLATE },
  commission_contract: { label: "договор комиссии", builtin: CONTRACT_TEMPLATE },
} as const;

function template(name: string) {
  const t = TEMPLATES[name as keyof typeof TEMPLATES];
  if (!t) throw new HttpError(404, "Нет такого шаблона");
  return { ...t, name, custom: () => path.join(config.uploadDir, "templates", `${name}.docx`) };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings/company", async () => ({
    company: await getCompany(db),
    orderTemplate: fs.existsSync(template("commission_order").custom()) ? "custom" : "default",
    contractTemplate: fs.existsSync(template("commission_contract").custom()) ? "custom" : "default",
  }));

  app.put("/settings/company", async (request) => {
    const admin = requireAdmin(request);
    const input = body<Record<string, unknown>>(request);
    const accounts: BankAccount[] = (Array.isArray(input.accounts) ? input.accounts : []).slice(0, 10).map((raw) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      return {
        id: s(a.id, 40) || crypto.randomBytes(4).toString("hex"),
        label: s(a.label, 100),
        currency: s(a.currency, 3).toUpperCase() || "RUB",
        account: s(a.account, 40),
        bankName: s(a.bankName, 300),
        bik: s(a.bik, 20),
        corrAccount: s(a.corrAccount, 40),
        bankInn: s(a.bankInn, 20),
        bankAddress: s(a.bankAddress, 500),
      };
    });
    const company: CompanySettings = {
      name: s(input.name, 200),
      fullName: s(input.fullName),
      legalAddress: s(input.legalAddress),
      ogrn: s(input.ogrn, 20),
      inn: s(input.inn, 20),
      kpp: s(input.kpp, 20),
      okpo: s(input.okpo, 20),
      city: s(input.city, 100),
      signatoryTitle: s(input.signatoryTitle, 100),
      signatoryName: s(input.signatoryName, 200),
      signatoryShort: s(input.signatoryShort, 100),
      signatoryBasis: s(input.signatoryBasis, 200),
      email: s(input.email, 200),
      phone: s(input.phone, 60),
      accounts,
      orderAccountId: accounts.some((a) => a.id === input.orderAccountId) ? String(input.orderAccountId) : (accounts[0]?.id ?? null),
    };
    if (!company.name) throw new HttpError(400, "Укажите название компании");
    await setCompany(db, company, admin.id);
    await audit(db, { userId: admin.id, action: "update", entityType: "settings", summary: "Изменил реквизиты компании", ip: request.ip });
    return { company };
  });

  /** Текущий шаблон (поручение / договор комиссии) — чтобы поправить в Word и загрузить обратно. */
  app.get("/settings/templates/:name.docx", async (request, reply) => {
    const t = template((request.params as { name: string }).name);
    const file = fs.existsSync(t.custom()) ? t.custom() : t.builtin;
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", `attachment; filename="${t.name}_template.docx"`)
      .send(fs.createReadStream(file));
  });

  app.post("/settings/templates/:name", async (request) => {
    const admin = requireAdmin(request);
    const t = template((request.params as { name: string }).name);
    const file = await request.file();
    if (!file || !file.filename.toLowerCase().endsWith(".docx")) throw new HttpError(400, "Нужен файл .docx");
    const target = t.custom();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await pipeline(file.file, fs.createWriteStream(`${target}.tmp`));
    await fs.promises.rename(`${target}.tmp`, target);
    await audit(db, { userId: admin.id, action: "update", entityType: "settings", summary: `Загрузил свой шаблон: ${t.label}`, ip: request.ip });
    return { ok: true };
  });

  app.delete("/settings/templates/:name", async (request) => {
    const admin = requireAdmin(request);
    const t = template((request.params as { name: string }).name);
    await fs.promises.rm(t.custom(), { force: true });
    await audit(db, { userId: admin.id, action: "update", entityType: "settings", summary: `Вернул стандартный шаблон: ${t.label}`, ip: request.ip });
    return { ok: true };
  });
}
