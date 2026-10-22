/** Наличные сверху по сделке — только администраторам: сколько за товар и за доставку (без расчётов). */

import { useState } from "react";
import { Link } from "react-router";

import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import type { ShipmentCash } from "../../../../shared/shipments.ts";
import { api, errorMessage } from "../../lib/api.ts";
import type { ShipmentResponse } from "../../lib/types.ts";
import { NumInput } from "../products/QuoteCalculator.tsx";
import { useShipmentActions } from "./common.tsx";

const EMPTY: ShipmentCash = { currency: "USD", goods: null, delivery: null, note: "" };

export function CashBlock({ data }: { data: ShipmentResponse }) {
  const sh = data.shipment;
  const { refresh } = useShipmentActions();
  const [form, setForm] = useState<ShipmentCash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cash = data.cash;
  const edit = form !== null;
  const save = async (value: ShipmentCash | null) => {
    setError(null);
    try {
      await api(`/shipments/${sh.number}/cash`, { method: "PUT", body: value ?? {} });
      setForm(null);
      refresh(sh.number);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const total = (c: ShipmentCash) => (c.goods ?? 0) + (c.delivery ?? 0);
  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Наличные</h2>
        <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">видно только админам</span>
        {data.estimate && (
          <Link to={`/estimates/${data.estimate.id}`} className="text-xs link">
            расчёт «{data.estimate.title}»
          </Link>
        )}
        <span className="flex-1" />
        {!edit && (
          <button type="button" className="btn btn-sm" onClick={() => setForm(cash ?? EMPTY)}>
            {cash ? "Изменить" : "Добавить"}
          </button>
        )}
      </div>
      {!edit && cash && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          {(
            [
              ["За товар", cash.goods ?? 0],
              ["За доставку", cash.delivery ?? 0],
              ["Всего наличными", total(cash)],
            ] as [string, number][]
          ).map(([label, v], i) => (
            <div key={label} className={`rounded-md px-3 py-2 ${i === 2 ? "bg-amber-50 dark:bg-amber-950/30" : "bg-slate-50 dark:bg-neutral-800/50"}`}>
              <div className="text-[11px] muted">{label}</div>
              <div className="font-semibold tabular-nums">{formatMoney(v, cash.currency)}</div>
            </div>
          ))}
        </div>
      )}
      {!edit && cash?.note && <p className="text-xs muted">{cash.note}</p>}
      {!edit && !cash && <p className="text-xs muted">Наличных сверху по этой сделке нет.</p>}
      {edit && form && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="label">За товар</span>
              <NumInput value={form.goods} onChange={(v) => setForm({ ...form, goods: v })} />
            </label>
            <label className="block">
              <span className="label">За доставку</span>
              <NumInput value={form.delivery} onChange={(v) => setForm({ ...form, delivery: v })} />
            </label>
            <label className="block">
              <span className="label">Валюта</span>
              <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="flex items-end pb-2 text-sm tabular-nums">всего {formatMoney(total(form), form.currency)}</div>
          </div>
          <label className="block">
            <span className="label">Заметка</span>
            <input className="input" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="кто передал, когда…" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save(form)}>Сохранить</button>
            <button type="button" className="btn btn-sm" onClick={() => setForm(null)}>Отмена</button>
            {cash && (
              <button type="button" className="btn btn-sm ml-auto" onClick={() => void save(null)}>Убрать наличные</button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </section>
  );
}
