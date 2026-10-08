/** Настройки (admin): реквизиты компании, счета, шаблон поручения. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { BankAccount, CompanySettings } from "../../../shared/company.ts";
import { IconPlus, IconX } from "../components/Icons.tsx";
import { Content } from "../components/Layout.tsx";
import { ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { api, BASE } from "../lib/api.ts";

const MAIN: [keyof CompanySettings, string][] = [
  ["name", "Краткое название"],
  ["fullName", "Полное наименование"],
  ["legalAddress", "Юридический адрес"],
  ["inn", "ИНН"],
  ["kpp", "КПП"],
  ["ogrn", "ОГРН"],
  ["okpo", "ОКПО"],
  ["city", "Город в документах"],
  ["signatoryTitle", "Должность подписанта"],
  ["signatoryName", "ФИО подписанта"],
  ["signatoryShort", "Под подписью («Фотин Е.П.»)"],
  ["signatoryBasis", "Действует на основании"],
  ["email", "E-mail"],
  ["phone", "Телефон"],
];

const ACCOUNT: [keyof BankAccount, string][] = [
  ["label", "Подпись"],
  ["currency", "Валюта"],
  ["account", "Расчётный счёт"],
  ["bankName", "Банк"],
  ["bik", "БИК"],
  ["corrAccount", "Корр. счёт"],
  ["bankInn", "ИНН банка"],
  ["bankAddress", "Адрес банка"],
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "company"],
    queryFn: () => api<{ company: CompanySettings; orderTemplate: "custom" | "default" }>("/settings/company"),
  });
  const [form, setForm] = useState<CompanySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data) setForm(data.company);
  }, [data]);

  if (isLoading || !form) return <Content><Spinner /><ErrorBox error={error} /></Content>;
  const setAcc = (i: number, k: keyof BankAccount, v: string) =>
    setForm({ ...form, accounts: form.accounts.map((a, j) => (j === i ? { ...a, [k]: v } : a)) });

  return (
    <Content>
      <PageHeader title="Реквизиты компании" meta="Подставляются в поручения и другие документы по шаблонам" />
      <form
        className="space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setSaved(false);
          try {
            await api("/settings/company", { method: "PUT", body: form });
            await queryClient.invalidateQueries({ queryKey: ["settings"] });
            setSaved(true);
          } catch (x) {
            setErr(x);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {MAIN.map(([k, l]) => (
            <label key={k} className={`block ${k === "fullName" || k === "legalAddress" ? "sm:col-span-2" : ""}`}>
              <span className="label">{l}</span>
              <input className="input" value={String(form[k] ?? "")} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Расчётные счета</h2>
          <div className="space-y-3">
            {form.accounts.map((a, i) => (
              <div key={a.id} className="rounded-md border border-slate-200 p-3 dark:border-neutral-700">
                <div className="mb-2 flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="orderAccount" checked={form.orderAccountId === a.id} onChange={() => setForm({ ...form, orderAccountId: a.id })} />
                    в поручения
                  </label>
                  <button type="button" className="icon-btn ml-auto" aria-label="Удалить счёт" onClick={() => setForm({ ...form, accounts: form.accounts.filter((_, j) => j !== i) })}>
                    <IconX size={12} />
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ACCOUNT.map(([k, l]) => (
                    <label key={k} className={`block ${k === "bankAddress" ? "sm:col-span-2" : ""}`}>
                      <span className="label">{l}</span>
                      <input className="input" value={a[k]} onChange={(e) => setAcc(i, k, e.target.value)} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2"
            onClick={() =>
              setForm({
                ...form,
                accounts: [...form.accounts, { id: `acc-${Date.now()}`, label: "", currency: "RUB", account: "", bankName: "", bik: "", corrAccount: "", bankInn: "", bankAddress: "" }],
              })
            }
          >
            <IconPlus size={12} /> Счёт
          </button>
        </section>

        <ErrorBox error={err} />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary">Сохранить</button>
          {saved && <span className="text-sm text-green-700 dark:text-green-400">Сохранено</span>}
        </div>
      </form>

      <section className="mt-10 border-t border-slate-200 pt-5 dark:border-neutral-800">
        <h2 className="mb-1 text-sm font-semibold">Шаблон поручения</h2>
        <p className="mb-3 text-sm muted">
          {data?.orderTemplate === "custom" ? "Используется загруженный вами шаблон." : "Используется стандартный шаблон ТЛК БАРС."} Скачайте его, поправьте текст в Word
          (поля в фигурных скобках {"{{…}}"} не трогайте) и загрузите обратно.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={`${BASE}/api/settings/templates/commission_order.docx`}>Скачать шаблон</a>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Загрузить свой</button>
          {data?.orderTemplate === "custom" && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await api("/settings/templates/commission_order", { method: "DELETE" });
                await queryClient.invalidateQueries({ queryKey: ["settings"] });
              }}
            >
              Вернуть стандартный
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const form = new FormData();
              form.append("file", f);
              try {
                await api("/settings/templates/commission_order", { method: "POST", form });
                await queryClient.invalidateQueries({ queryKey: ["settings"] });
              } catch (x) {
                setErr(x);
              }
            }}
          />
        </div>
      </section>
    </Content>
  );
}
