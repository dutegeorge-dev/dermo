/** Форма контрагента: основное, реквизиты, банк, подписант, связь. */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { COMPANY_KINDS } from "../../../../shared/deal-fields.ts";
import { CONTRACTOR_TYPES, COUNTERPARTY_ROLES } from "../../../../shared/documents.ts";
import { api } from "../../lib/api.ts";
import type { Counterparty, CounterpartyRole } from "../../lib/types.ts";
import { ErrorBox, Modal } from "../ui.tsx";

type Form = Record<string, string>;

const FIELDS: { title: string; fields: [key: string, label: string, opts?: { foreign?: boolean; ru?: boolean; wide?: boolean; area?: boolean }][] }[] = [
  {
    title: "Реквизиты",
    fields: [
      ["fullName", "Полное наименование", { wide: true }],
      ["inn", "ИНН", { ru: true }],
      ["kpp", "КПП", { ru: true }],
      ["ogrn", "ОГРН / ОГРНИП", { ru: true }],
      ["regNumber", "Рег. номер (USCC и т.п.)", { foreign: true }],
      ["country", "Страна"],
      ["legalAddress", "Юридический адрес", { wide: true }],
      ["postalAddress", "Почтовый адрес", { wide: true }],
    ],
  },
  {
    title: "Банк",
    fields: [
      ["bankAccount", "Расчётный счёт"],
      ["bankName", "Банк"],
      ["bankBik", "БИК", { ru: true }],
      ["bankCorrAccount", "Корр. счёт", { ru: true }],
      ["bankInn", "ИНН банка", { ru: true }],
      ["bankSwift", "SWIFT", { foreign: true }],
      ["bankAddress", "Адрес банка", { wide: true }],
    ],
  },
  {
    title: "Подписант",
    fields: [
      ["signatoryTitle", "Должность"],
      ["signatoryName", "ФИО полностью"],
      ["signatoryBasis", "Действует на основании"],
    ],
  },
  {
    title: "Связь",
    fields: [
      ["email", "E-mail"],
      ["phone", "Телефон"],
      ["website", "Сайт"],
    ],
  },
];

export function CounterpartyForm({
  role,
  counterparty,
  initialName,
  onClose,
}: {
  role: CounterpartyRole;
  counterparty?: Counterparty;
  initialName?: string;
  onClose: (id?: number) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => {
    const base: Form = {
      name: initialName ?? "",
      kind: role === "supplier" ? "foreign" : "ooo",
      contractorType: role === "contractor" ? "carrier_cn" : "",
      country: role === "supplier" ? "Китай" : "Россия",
      signatoryTitle: "Директор",
      signatoryBasis: "Устава",
      notes: "",
      contactName: "",
      contactPhone: "",
    };
    if (counterparty) for (const [k, v] of Object.entries(counterparty)) if (typeof v === "string") base[k] = v;
    return base;
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const foreign = form.kind === "foreign";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { contactName, contactPhone, ...fields } = form;
    if (role !== "contractor") delete fields.contractorType;
    try {
      let id = counterparty?.id;
      if (counterparty) {
        await api(`/counterparties/${counterparty.id}`, { method: "PATCH", body: fields });
      } else {
        const res = await api<{ counterparty: { id: number } }>("/counterparties", {
          method: "POST",
          body: { ...fields, role, contact: contactName ? { name: contactName, phone: contactPhone } : undefined },
        });
        id = res.counterparty.id;
      }
      await queryClient.invalidateQueries({ queryKey: ["counterparties"] });
      await queryClient.invalidateQueries({ queryKey: ["counterparty", id] });
      onClose(id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={counterparty ? counterparty.name : `Новый ${COUNTERPARTY_ROLES[role].one.toLowerCase()}`} onClose={() => onClose()} wide>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div>
            <label className="label" htmlFor="cp-kind">Форма</label>
            <select id="cp-kind" className="input" value={form.kind} onChange={set("kind")}>
              {Object.entries(COMPANY_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cp-name">Название — как в документах</label>
            <input id="cp-name" className="input" required autoFocus value={form.name} onChange={set("name")} placeholder={role === "client" ? "ИП Иванова И.И. / ООО «Пример»" : ""} />
          </div>
          {role === "contractor" && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="cp-type">Вид подрядчика</label>
              <select id="cp-type" className="input" value={form.contractorType} onChange={set("contractorType")}>
                {Object.entries(CONTRACTOR_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
        </div>

        {FIELDS.map((group) => (
          <fieldset key={group.title}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{group.title}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.fields
                .filter(([, , o]) => !(o?.foreign && !foreign) && !(o?.ru && foreign))
                .map(([key, label, o]) => (
                  <div key={key} className={o?.wide ? "sm:col-span-2" : ""}>
                    <label className="label" htmlFor={`cp-${key}`}>{label}</label>
                    <input id={`cp-${key}`} className="input" value={form[key] ?? ""} onChange={set(key)} />
                  </div>
                ))}
            </div>
          </fieldset>
        ))}

        {!counterparty && (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Контактное лицо</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" placeholder="Имя" value={form.contactName} onChange={set("contactName")} aria-label="Имя контакта" />
              <input className="input" placeholder="Телефон" type="tel" value={form.contactPhone} onChange={set("contactPhone")} aria-label="Телефон контакта" />
            </div>
          </fieldset>
        )}
        <div>
          <label className="label" htmlFor="cp-notes">Заметки</label>
          <textarea id="cp-notes" className="input" rows={2} value={form.notes} onChange={set("notes")} />
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => onClose()}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
