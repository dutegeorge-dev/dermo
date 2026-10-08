/** Настройки: реквизиты компании и шаблон поручения (admin). */

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
import { ORDER_TEMPLATE } from "../lib/order.ts";
import { getCompany, setCompany } from "../lib/settings.ts";

const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function customTemplatePath() {
  return path.join(config.uploadDir, "templates", "commission_order.docx");
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings/company", async () => ({
    company: await getCompany(db),
    orderTemplate: fs.existsSync(customTemplatePath()) ? "custom" : "default",
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

  /** Текущий шаблон поручения — чтобы поправить в Word и загрузить обратно. */
  app.get("/settings/templates/commission_order.docx", async (_request, reply) => {
    const file = fs.existsSync(customTemplatePath()) ? customTemplatePath() : ORDER_TEMPLATE;
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", 'attachment; filename="commission_order_template.docx"')
      .send(fs.createReadStream(file));
  });

  app.post("/settings/templates/commission_order", async (request) => {
    const admin = requireAdmin(request);
    const file = await request.file();
    if (!file || !file.filename.toLowerCase().endsWith(".docx")) throw new HttpError(400, "Нужен файл .docx");
    const target = customTemplatePath();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await pipeline(file.file, fs.createWriteStream(`${target}.tmp`));
    await fs.promises.rename(`${target}.tmp`, target);
    await audit(db, { userId: admin.id, action: "update", entityType: "settings", summary: "Загрузил свой шаблон поручения", ip: request.ip });
    return { ok: true };
  });

  app.delete("/settings/templates/commission_order", async (request) => {
    const admin = requireAdmin(request);
    await fs.promises.rm(customTemplatePath(), { force: true });
    await audit(db, { userId: admin.id, action: "update", entityType: "settings", summary: "Вернул стандартный шаблон поручения", ip: request.ip });
    return { ok: true };
  });
}
