/**
 * «Расчёт» → цена для клиента и наличные (только администраторам): доставка для клиента суммой, на товар — вручную,
 * по целевой цене за единицу или по желаемой марже; ниже — таблица клиенту (как в Excel владельца) под скриншот.
 */

import { useEffect, useState } from "react";

import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import { computeMarkup, DEFAULT_MARKUP, type EstimateMarkup, type EstimateParams, type EstimateResult, MARKUP_MODES, type MarkupMode, type MarkupResult } from "../../../../shared/estimate.ts";
import { NumInput } from "../products/QuoteCalculator.tsx";

const HEADING_KEY = "crm.estimate.heading";
const DEFAULT_HEADING = "Торгово-логистическая компания ТЛК БАРС";

const savedHeading = () => {
  try {
    return localStorage.getItem(HEADING_KEY) || DEFAULT_HEADING;
  } catch {
    return DEFAULT_HEADING;
  }
};

export function ClientMarkup({ p, res, rates, onChange }: { p: EstimateParams; res: EstimateResult; rates: Record<string, number>; onChange: (markup: EstimateMarkup | null) => void }) {
  const m = p.markup ?? null;
  const set = (patch: Partial<EstimateMarkup>) => onChange({ ...(m ?? DEFAULT_MARKUP), ...patch });
  const r = m ? computeMarkup(p, res, rates) : null;
  const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatMoney(n, m?.currency ?? "USD"));

  if (!m) {
    return (
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Цена для клиента и наличные</h2>
          <p className="text-xs muted">Только для администраторов: наличные сверху расчёта за доставку и товар, целевая цена за единицу, таблица клиенту.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...DEFAULT_MARKUP })}>
          Добавить
        </button>
      </section>
    );
  }

  const unit = r?.unit ?? "ед.";
  // Позиции, как их считает computeMarkup (с названием или суммой) — с номером строки в items.
  const rows = p.items.map((item, index) => ({ item, index })).filter(({ item }) => item.name.trim() || item.amount);
  return (
    <section className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Цена для клиента и наличные</h2>
        <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">видно только админам</span>
        <span className="flex-1" />
        <button type="button" className="text-xs link" onClick={() => onChange(null)}>
          убрать
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="label">Валюта таблицы</span>
          <select className="input" value={m.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Доставка для клиента, {m.currency}</span>
          <NumInput value={m.deliveryClient} onChange={(v) => set({ deliveryClient: v })} placeholder={r ? String(Math.ceil(r.deliveryCost)) : undefined} />
          {r && (
            <span className="mt-0.5 block text-[11px] muted">
              наш расчёт {money(r.deliveryCost)} → наличные {money(r.deliveryCash)}
            </span>
          )}
        </label>
        <div className="sm:col-span-2">
          <span className="label">Наличные за товар</span>
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            {(Object.entries(MARKUP_MODES) as [MarkupMode, string][]).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="radio" checked={m.mode === k} onChange={() => set({ mode: k })} /> {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {m.mode === "manual" && (
          <label className="block">
            <span className="label">Наличные за товар, {m.currency}</span>
            <NumInput value={m.goodsCash} onChange={(v) => set({ goodsCash: v })} />
          </label>
        )}
        {m.mode === "unit" && (
          <>
            <label className="block">
              <span className="label">{rows.length > 1 ? "Общая цена за единицу (всем позициям без своей)" : `Цена для клиента за 1 ${unit} (всё вместе)`}</span>
              <NumInput value={m.targetUnitPrice} onChange={(v) => set({ targetUnitPrice: v })} placeholder="150" />
            </label>
            <label className="block">
              <span className="label">Валюта цены</span>
              <select className="input" value={m.targetUnitCurrency} onChange={(e) => set({ targetUnitCurrency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </>
        )}
        {m.mode === "margin" && (
          <label className="block">
            <span className="label">Желаемая маржа, {m.currency}</span>
            <NumInput value={m.margin} onChange={(v) => set({ margin: v })} placeholder="9000" />
            <span className="mt-0.5 block text-[11px] muted">наличные за доставку + за товар</span>
          </label>
        )}
      </div>

      {m.mode === "unit" && rows.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs muted">
                <th className="pb-1 font-medium">Позиция</th>
                <th className="pb-1 text-right font-medium">Кол-во</th>
                <th className="w-40 pb-1 font-medium">Цена клиенту за ед. (всё вместе), {m.targetUnitCurrency}</th>
                <th className="pb-1 text-right font-medium">Товар за ед.</th>
                <th className="pb-1 text-right font-medium">Всё вместе за ед.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, index }, n) => {
                const res = r?.items[n];
                return (
                  <tr key={index} className="border-t border-slate-100 dark:border-neutral-800">
                    <td className="py-1 pr-2">
                      {item.variant || item.name}
                      {item.variant && item.name && <span className="block text-[11px] muted">{item.name}</span>}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{item.quantity !== null ? `${item.quantity.toLocaleString("ru-RU")} ${item.unit}` : "—"}</td>
                    <td className="py-1 pr-2">
                      <NumInput
                        className="input py-1"
                        value={m.targetUnitPrices?.[index] ?? null}
                        placeholder={m.targetUnitPrice !== null ? String(m.targetUnitPrice) : "цена"}
                        onChange={(v) => {
                          const list = [...(m.targetUnitPrices ?? [])];
                          while (list.length <= index) list.push(null);
                          list[index] = v;
                          set({ targetUnitPrices: list });
                        }}
                      />
                    </td>
                    <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{money(res?.clientPrice)}</td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">{money(res?.unitClient)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {r && <Proposal r={r} money={money} rates={rates} />}
      {r && <ClientTable p={p} r={r} />}
    </section>
  );
}

/** Как разложилась маржа: сколько наличными сверху доставки и товара, цена за единицу. */
function Proposal({ r, money, rates }: { r: MarkupResult; money: (n: number | null) => string; rates: Record<string, number> }) {
  const rubUnit = r.unitClient !== null ? (r.currency === "RUB" ? r.unitClient : r.unitClient * (rates[r.currency] ?? 0)) : null;
  const cell = (label: string, value: string, hint?: string) => (
    <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-neutral-800/50">
      <div className="text-[11px] muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] muted">{hint}</div>}
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cell("Наличные за доставку", money(r.deliveryCash), `доставка клиенту ${money(r.deliveryClient)}`)}
        {cell("Наличные за товар", money(r.goodsCash), `товар клиенту ${money(r.goodsClient)}`)}
        {cell("Маржа наличными", money(r.margin))}
        {cell("Итого клиенту", money(r.totalClient))}
        {r.items.length === 1 && r.unitClient !== null && cell(`За 1 ${r.unit} всё вместе`, money(r.unitClient), rubUnit !== null ? formatMoney(rubUnit, "RUB") : undefined)}
        {r.items.length === 1 && r.items[0].clientPrice !== null && cell(`Цена товара за 1 ${r.items[0].unit}`, money(r.items[0].clientPrice))}
        {r.items.length > 1 && r.unitClient !== null && cell(`В среднем за 1 ${r.unit} всё вместе`, money(r.unitClient), rubUnit !== null ? formatMoney(rubUnit, "RUB") : undefined)}
      </div>
      {r.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-[11px] text-amber-800 dark:text-amber-300">
          {r.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }));

/** «1×20FT» → «Контейнер №1 (20FT)». */
function containerTitle(type: string | undefined): string | null {
  const t = (type ?? "").trim();
  if (!t) return null;
  const m = /^(\d+)\s*[x×х*]\s*(.+)$/i.exec(t);
  return m ? (Number(m[1]) > 1 ? `Контейнеры: ${m[1]} × ${m[2]}` : `Контейнер №1 (${m[2]})`) : `Контейнер №1 (${t})`;
}

/** Таблица клиенту — как в Excel владельца: под скриншот (белый фон, рамки, крупно). */
function ClientTable({ p, r }: { p: EstimateParams; r: MarkupResult }) {
  const [heading, setHeading] = useState(savedHeading);
  useEffect(() => {
    try {
      localStorage.setItem(HEADING_KEY, heading);
    } catch {
      // нет хранилища — заголовок по умолчанию
    }
  }, [heading]);
  const cur = r.currency;
  const sym = (n: number | null, decimals = false) =>
    n === null ? "" : `${cur === "USD" ? "$" : cur === "CNY" ? "¥" : cur === "EUR" ? "€" : ""}${n.toLocaleString("ru-RU", decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 })}${cur === "RUB" ? " ₽" : ""}`;
  const labels = [...new Set(r.items.flatMap((i) => (i.breakdown ?? []).map((b) => b.label)))];
  const units = [...new Set(r.items.map((i) => i.unit))];
  const packUnit = r.items.find((i) => i.packageUnit)?.packageUnit || "мест";
  const hasPackages = r.items.some((i) => i.packages);
  const hasVariant = r.items.some((i) => i.variant);
  const title = p.title || [...new Set(r.items.map((i) => i.name))].join(", ");
  const cols = 1 + labels.length + (hasPackages ? 1 : 0) + 4;
  const container = containerTitle(p.containerType);
  const total = (f: (i: (typeof r.items)[number]) => number | null | undefined) => r.items.reduce((s, i) => s + (f(i) ?? 0), 0);
  const B = "border border-slate-400 px-2 py-1";
  const H = `${B} bg-[#dce6f1] font-semibold`;
  const row = (label: string, value: string, cls = "") => (
    <tr className={cls}>
      <td colSpan={cols - 1} className={`${B} text-center font-semibold`}>{label}</td>
      <td className={`${B} text-right font-semibold tabular-nums`}>{value}</td>
    </tr>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Таблица клиенту</span>
        <span className="muted">— сделайте скриншот и отправьте клиенту. Заголовок:</span>
        <input className="input w-80 py-1 text-xs" value={heading} onChange={(e) => setHeading(e.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[640px] border-collapse bg-white text-[13px] text-black" style={{ fontFamily: "Arial, sans-serif" }}>
          <tbody>
            <tr>
              <td colSpan={cols} className={`${H} py-2 text-center text-base font-bold`}>{heading}</td>
            </tr>
            <tr>
              <td colSpan={cols} className={`${B} text-center font-bold`}>{title}</td>
            </tr>
            <tr className="text-center">
              <td className={H}>{hasVariant ? "Размер" : "Товар"}</td>
              {labels.map((l) => <td key={l} className={H}>{l}</td>)}
              {hasPackages && <td className={H}>Всего, {packUnit}</td>}
              <td className={H}>Кол-во{units.length === 1 ? `, ${units[0]}` : ""}</td>
              <td className={H}>Цена за {units.length === 1 ? units[0] : "ед."}</td>
              <td className={H}>Цена за {units.length === 1 ? units[0] : "ед."} с доставкой</td>
              <td className={H}>Стоимость</td>
            </tr>
            {container && (
              <tr>
                <td colSpan={cols} className={`${B} bg-[#e8eef7] text-center font-semibold`}>{container}</td>
              </tr>
            )}
            {r.items.map((i, n) => (
              <tr key={n} className="text-center tabular-nums">
                <td className={`${B} text-left font-semibold`}>{i.variant || i.name}</td>
                {labels.map((l) => <td key={l} className={B}>{num(i.breakdown?.find((b) => b.label === l)?.packages)}</td>)}
                {hasPackages && <td className={`${B} font-semibold`}>{num(i.packages)}</td>}
                <td className={B}>{i.quantity !== null ? `${num(i.quantity)} ${i.unit}` : ""}</td>
                <td className={B}>{sym(i.clientPrice, true)}</td>
                {/* С доставкой — заданная целевая цена, иначе посчитанная (товар + доля доставки). */}
                <td className={`${B} font-semibold`}>{sym(i.targetUnit ?? i.unitClient, true)}</td>
                <td className={B}>{sym(i.clientAmount)}</td>
              </tr>
            ))}
            <tr className="bg-[#dce6f1] text-center font-semibold tabular-nums">
              <td className={`${B} text-left`}>{container ? "Итого №1" : "Итого"}</td>
              {labels.map((l) => <td key={l} className={B}>{num(total((i) => i.breakdown?.find((b) => b.label === l)?.packages))}</td>)}
              {hasPackages && <td className={B}>{num(total((i) => i.packages))}</td>}
              <td className={B}>{units.length === 1 ? `${num(total((i) => i.quantity))} ${units[0]}` : ""}</td>
              <td className={B} />
              <td className={B} />
              <td className={B}>{sym(r.goodsClient)}</td>
            </tr>
            {row("Безналичные за товар", sym(r.goodsCost, true))}
            {row("Наличные за товар", sym(r.goodsCash, true))}
            {row("Доставка", sym(r.deliveryClient, true), "bg-[#ebf1de]")}
            {row("Безналичные за доставку", sym(r.deliveryCost, true), "bg-[#ebf1de]")}
            {row("Наличные за доставку", sym(r.deliveryCash, true), "bg-[#ebf1de]")}
            {row("ИТОГО клиенту", sym(r.totalClient, true), "bg-[#ffff00]")}
          </tbody>
        </table>
      </div>
    </div>
  );
}
