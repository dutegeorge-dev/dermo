/**
 * «Спецификация для перевозчика» в карточке сделки (внизу, свёрнута): после погрузки перевозчик
 * просит заполнить её по инвойсу и упаковочному листу. Получатель и станция — вводим тут,
 * остальное подтягивается само. Excel — по нашему шаблону или по шаблону перевозчика.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { SpecLine, SpecParams } from "../../../../shared/cargo.ts";
import { formatMoney } from "../../../../shared/documents.ts";
import { api, apiDownload, errorMessage } from "../../lib/api.ts";
import type { ShipmentResponse } from "../../lib/types.ts";
import { IconChevronDown, IconChevronRight } from "../Icons.tsx";

type SpecResponse = {
  params: SpecParams;
  fields: Record<string, string>;
  lines: SpecLine[];
  currency: string;
  missing: string[];
  packing: { packages: number; netKg: number; grossKg: number } | null;
  document: { id: number } | null;
};

const OPEN_KEY = "crm-spec-open";
/** Событие «раскрыть спецификацию» — из «Хода сделки». */
export const OPEN_SPEC_EVENT = "crm:open-spec";
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: 3 }));

export function SpecBlock({ data }: { data: ShipmentResponse }) {
  const sh = data.shipment;
  const queryClient = useQueryClient();
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {
      // приватный режим — не запоминаем
    }
  };
  useEffect(() => {
    const onOpen = () => setOpenState(true);
    window.addEventListener(OPEN_SPEC_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SPEC_EVENT, onOpen);
  }, []);
  const q = useQuery({ queryKey: ["spec", sh.number, data.documents.length], queryFn: () => api<SpecResponse>(`/shipments/${sh.number}/spec`), enabled: open });
  const [form, setForm] = useState<SpecParams | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setForm(q.data.params);
  }, [q.data]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["spec", sh.number] });
      void queryClient.invalidateQueries({ queryKey: ["shipment", sh.number] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const saveParams = () => api(`/shipments/${sh.number}/spec`, { method: "PUT", body: form ?? {} });
  const download = (template: File | null) =>
    act(template ? "custom" : "default", async () => {
      await saveParams();
      const fd = new FormData();
      if (template) fd.append("file", template);
      await apiDownload(`/shipments/${sh.number}/spec.xlsx`, { method: "POST", form: template ? fd : undefined });
    });

  const d = q.data;
  return (
    <section id="spec" className="panel scroll-mt-16 p-4">
      <div className={`flex flex-wrap items-center gap-2 ${open ? "mb-3" : ""}`}>
        <button type="button" className="mr-auto flex min-w-0 items-center gap-1.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span className="text-sm font-semibold">Спецификация для перевозчика</span>
          {!open && <span className="truncate text-xs muted">по инвойсу и упаковочному листу — после погрузки</span>}
        </button>
        {d?.document && (
          <Link to={`/documents/${d.document.id}`} className="text-xs link">
            сохранённая спецификация
          </Link>
        )}
      </div>
      {open && !d && <p className="text-sm muted">{q.error ? errorMessage(q.error) : "Загрузка…"}</p>}
      {open && d && form && (
        <div className="space-y-3">
          {d.missing.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Не хватает: {d.missing.join(", ")}.
              {d.missing.includes("упаковочный лист") && (
                <>
                  {" "}
                  <Link to={`/documents/new?type=packing_list&shipment=${sh.number}`} className="link">Загрузить упаковочный лист</Link>
                </>
              )}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">Получатель / Consignee — СВХ или терминал, ИНН, адрес (даёт перевозчик)</span>
              <textarea className="input" rows={2} value={form.consignee} onChange={(e) => setForm({ ...form, consignee: e.target.value })} placeholder="ООО «…», ИНН/КПП …, адрес …" />
            </label>
            <label className="block">
              <span className="label">Станция назначения</span>
              <input className="input" value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })} placeholder="Белый Раст" />
            </label>
            <label className="block">
              <span className="label">Страна назначения</span>
              <input className="input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Страна происхождения</span>
              <input className="input" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} />
            </label>
            <div className="text-xs muted sm:pt-6">
              Договор: {d.fields.contract || "—"} · Инвойс: {d.fields.invoiceNo || "—"} от {d.fields.invoiceDate || "—"} · Контейнер: {d.fields.container || "—"} · Условия: {d.fields.terms || "—"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs muted">
                  <th className="py-1 pr-2 font-medium">ТН ВЭД</th>
                  <th className="py-1 pr-2 font-medium">Описание (RU / EN)</th>
                  <th className="py-1 pr-2 text-right font-medium">Кол-во шт</th>
                  <th className="py-1 pr-2 text-right font-medium">Мест</th>
                  <th className="py-1 pr-2 text-right font-medium">Нетто</th>
                  <th className="py-1 pr-2 text-right font-medium">Брутто</th>
                  <th className="py-1 pr-2 text-right font-medium">Цена</th>
                  <th className="py-1 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                {d.lines.map((l) => {
                  const key = l.key;
                  return (
                    <tr key={l.no}>
                      <td className="py-1.5 pr-2 font-mono text-xs">{l.hsCode || "—"}</td>
                      <td className="py-1.5 pr-2">
                        <input
                          className="input px-1.5 py-0.5"
                          aria-label="Описание товара"
                          value={form.descriptions[key] ?? l.description}
                          onChange={(e) => setForm({ ...form, descriptions: { ...form.descriptions, [key]: e.target.value } })}
                          placeholder="Искусственный газон / artificial grass"
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{num(l.qty)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{num(l.packages)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{num(l.netKg)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{num(l.grossKg)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{l.price === null ? "—" : l.price.toLocaleString("ru-RU", { maximumFractionDigits: 4 })}</td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatMoney(l.amount, d.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs muted">
            Одна строка — один код ТН ВЭД. Кол-во шт: штучный товар — штуки из инвойса, иначе места (рулоны, коробки). Места и веса — из упаковочного листа{d.packing ? ` (всего ${num(d.packing.packages)} мест, нетто ${num(d.packing.netKg)}, брутто ${num(d.packing.grossKg)} кг)` : ""}.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void act("save", saveParams)}>
              {busy === "save" ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !d.lines.length} onClick={() => void download(null)}>
              {busy === "default" ? "Формируем…" : "Скачать Excel (наш шаблон)"}
            </button>
            <button type="button" className="btn btn-sm" disabled={!!busy || !d.lines.length} onClick={() => fileRef.current?.click()} title="Пришлите шаблон перевозчика (.xlsx) — ИИ найдёт, куда что вписать">
              {busy === "custom" ? "Заполняем…" : "Заполнить шаблон перевозчика…"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void download(f);
              }}
            />
          </div>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          <p className="text-xs muted">Сформированный файл сохраняется в документах сделки и попадает в пакет для таможни.</p>
        </div>
      )}
    </section>
  );
}
