/**
 * Договор комиссии из карточки клиента — по шаблону владельца (templates/commission_contract.docx; свой —
 * CRM_UPLOAD_DIR/templates/commission_contract.docx). Сторона ТЛК БАРС в шаблоне; подставляются номер, город,
 * дата, преамбула клиента («…, в лице директора Ивановой И.И., действующей на основании Устава»), срок и реквизиты.
 */

import fs from "node:fs";
import path from "node:path";

import { createReport } from "docx-templates";
import { and, eq } from "drizzle-orm";

import { CRM_ROOT } from "../config.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documents } from "../db/schema.ts";
import { shortName } from "./order.ts";

export const CONTRACT_TEMPLATE = path.join(CRM_ROOT, "templates", "commission_contract.docx");
export const customContractTemplate = (uploadDir: string) => path.join(uploadDir, "templates", "commission_contract.docx");

type Client = typeof counterparties.$inferSelect;

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** «2026-03-09» → «09 марта 2026». */
export const dateText = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** Пол по отчеству (…ич / …на); не знаем — мужской (как в шаблоне). */
export const isFemale = (fio: string | null | undefined) => /(вна|чна|кызы)$/i.test((fio ?? "").trim().split(/\s+/)[2] ?? "") || /(ова|ева|ина|ына|ская|цкая)$/i.test((fio ?? "").trim().split(/\s+/)[0] ?? "");

/** Фамилия в родительном падеже: Иванов → Иванова, Иванова → Ивановой, Петренко → Петренко. */
export function surnameGenitive(surname: string, female: boolean): string {
  const s = surname.trim();
  if (!s || /(о|е|и|у|ы|ю|э|ко|их|ых)$/i.test(s) && !/(ой)$/i.test(s)) return s;
  if (female) {
    if (/(ова|ева|ина|ына)$/i.test(s)) return `${s.slice(0, -1)}ой`;
    if (/(ская|цкая)$/i.test(s)) return `${s.slice(0, -2)}ой`;
    return s; // несклоняемые женские (Ким, Шевчук)
  }
  if (/(ский|цкий)$/i.test(s)) return `${s.slice(0, -2)}ого`;
  if (/ой$/i.test(s)) return `${s.slice(0, -2)}ого`;
  if (/й$/i.test(s)) return `${s.slice(0, -1)}я`;
  if (/ь$/i.test(s)) return `${s.slice(0, -1)}я`;
  if (/а$/i.test(s)) return `${s.slice(0, -1)}ы`;
  if (/я$/i.test(s)) return `${s.slice(0, -1)}и`;
  return `${s}а`;
}

/** Должность в родительном падеже: «Директор» → «директора», «Генеральный директор» → «генерального директора». */
export function titleGenitive(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/[жчшщ]ий$/.test(w) ? `${w.slice(0, -2)}его` : /(ый|ий)$/.test(w) ? `${w.slice(0, -2)}ого` : /ой$/.test(w) ? `${w.slice(0, -2)}ого` : /(ь)$/.test(w) ? `${w.slice(0, -1)}я` : /[бвгджзклмнпрстфхцчшщ]$/.test(w) ? `${w}а` : w))
    .join(" ");
}

/** «Иванова Ирина Игоревна» → «Ивановой И.И.» */
export function shortGenitive(fio: string): string {
  const [last, ...rest] = fio.trim().split(/\s+/);
  if (!last) return "";
  const initials = rest.length && !/\./.test(fio) ? rest.map((r) => `${r[0]}.`).join("") : rest.join(" ");
  return `${surnameGenitive(last, isFemale(fio))}${initials ? ` ${initials}` : ""}`;
}

/** Преамбула клиента: ООО — «в лице …, действующего на основании …»; ИП — сам предприниматель. */
export function clientPreamble(c: Client): string {
  const female = isFemale(c.signatoryName);
  if (c.kind === "ip") {
    const fio = c.signatoryName || (c.fullName ?? c.name).replace(/^(индивидуальный предприниматель|ИП)\s+/i, "");
    return `Индивидуальный предприниматель ${fio}, ${female ? "именуемая" : "именуемый"} в дальнейшем Комитент`;
  }
  const name = c.fullName || c.name;
  const who = c.signatoryName ? `${titleGenitive(c.signatoryTitle || "Директор")} ${shortGenitive(c.signatoryName)}` : `${titleGenitive(c.signatoryTitle || "Директор")} ____________`;
  return `${name}, именуемое в дальнейшем Комитент, в лице ${who}, ${female ? "действующей" : "действующего"} на основании ${c.signatoryBasis || "Устава"}`;
}

/** Чего не хватает в карточке клиента для договора. */
export function contractMissing(c: Client): string[] {
  const miss: string[] = [];
  if (!c.inn) miss.push("ИНН");
  if (!c.ogrn) miss.push(c.kind === "ip" ? "ОГРНИП" : "ОГРН");
  if (!c.legalAddress) miss.push("адрес");
  if (!c.bankAccount || !c.bankBik) miss.push("банковские реквизиты");
  if (!c.signatoryName) miss.push("подписант");
  return miss;
}

export type ContractInput = { number: string; date: string; city: string; validUntil: string };

export function contractTemplateData(c: Client, input: ContractInput) {
  return {
    contract: {
      number: input.number,
      // В шаблоне уже «г. » — убираем, если город записан с ним.
      city: input.city.replace(/^г\.?\s*/i, ""),
      dateText: dateText(input.date),
      validUntilText: dateText(input.validUntil),
      clientPreamble: clientPreamble(c),
    },
    client: {
      name: c.name,
      address: c.legalAddress ?? "",
      ogrnLabel: c.kind === "ip" ? "ОГРНИП" : "ОГРН",
      ogrn: c.ogrn ?? "",
      innKpp: c.kpp ? `${c.inn ?? ""}/КПП ${c.kpp}` : (c.inn ?? ""),
      account: c.bankAccount ?? "",
      bank: c.bankName ?? "",
      corr: c.bankCorrAccount ?? "",
      bik: c.bankBik ?? "",
      signTitle: c.kind === "ip" ? "ИП" : c.signatoryTitle || "Директор",
      signer: shortName(c.signatoryName) || c.name.replace(/^ИП\s+/, ""),
    },
  };
}

export async function renderContractDocx(c: Client, input: ContractInput, uploadDir: string): Promise<Buffer> {
  const custom = customContractTemplate(uploadDir);
  const template = await fs.promises.readFile(fs.existsSync(custom) ? custom : CONTRACT_TEMPLATE);
  const out = await createReport({ template, data: contractTemplateData(c, input), cmdDelimiter: ["{{", "}}"], failFast: false, rejectNullish: false });
  return Buffer.from(out);
}

/** Следующий номер договора комиссии: наибольший числовой + 1, как «01», «02». */
export async function nextContractNumber(tx: DbOrTx): Promise<string> {
  const rows = await tx.select({ number: documents.number }).from(documents).where(and(eq(documents.type, "commission_contract")));
  const max = rows.reduce((m, r) => Math.max(m, /^\d{1,6}$/.test((r.number ?? "").trim()) ? Number(r.number) : 0), 0);
  return String(max + 1).padStart(2, "0");
}
