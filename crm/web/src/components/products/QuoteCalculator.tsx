/**
 * «Рассчитать для клиента» в карточке товара: цена фабрики × объём + доставка (сохранённая ставка или вручную) +
 * таможня + маржа на партию → цена за единицу в рублях. Считается сразу в браузере (shared/quote.ts), при
 * сохранении сервер пересчитывает по тем же курсам. КП — Word по шаблону владельца.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import { computeQuote, DEFAULT_QUOTE, type QuoteParams, type QuoteResult } from "../../../../shared/quote.ts";
import { formatDay } from "../docs/common.tsx";
import { useTariff } from "../docs/ItemsEditor.tsx";
import { IconFile, IconTrash } from "../Icons.tsx";
import { freightTitle, useFreightRates } from "../../pages/factories/FreightRatesPage.tsx";
import { api, apiDownload, errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { Link } from "react-router";

export type ProductOffer = {
  id: number;
  name: string;
  price: number | null;
  currency: string;
  unit: string | null;
  moq: number | null;
  perContainer: number | null;
  kgPerUnit: number | null;
  m3PerUnit: number | null;
  conditions: string;
  quotedAt: string | null;
  factoryId: number;
  factoryName: string;
  factoryNameRu: string | null;
  factoryLocation: string | null;
  supplierId: number | null;
};

type SavedQuote = {
  id: number;
  clientName: string;
  params: QuoteParams;
  result: QuoteResult;
  ratesDate: string | null;
  createdAt: string;
  createdBy: number | null;
  createdByName: string | null;
};

const rub = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatMoney(n, "RUB"));
const parseNum = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

/** Числовое поле, которое не «съедает» запятую и ноль при вводе. */
function NumInput({ value, onChange, placeholder, className = "input" }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    if (parseNum(text) !== value) setText(value === null ? "" : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNum(e.target.value));
      }}
    />
  );
}

export function QuoteCalculator({ product, offers }: { product: { id: number; name: string; nameRu: string | null; hsCode: string | null; vat10: boolean; unit: string | null }; offers: ProductOffer[] }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tariff = useTariff(product.hsCode);
  const freight = useFreightRates();
  const cbr = useQuery({ queryKey: ["cbr-rates"], queryFn: () => api<{ date: string; rates: Record<string, number> }>("/cbr-rates"), staleTime: 60 * 60_000 });
  const saved = useQuery({ queryKey: ["product-quotes", product.id], queryFn: () => api<{ quotes: SavedQuote[] }>(`/products/${product.id}/quotes`) });
  const [p, setP] = useState<QuoteParams>(() => {
    const best = offers.find((o) => o.price !== null);
    return best ? fromOffer({ ...DEFAULT_QUOTE, unit: product.unit ?? DEFAULT_QUOTE.unit }, best) : { ...DEFAULT_QUOTE, unit: product.unit ?? DEFAULT_QUOTE.unit };
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<QuoteParams>) => setP((x) => ({ ...x, ...patch }));
  useEffect(() => {
    if (p.transportMode === "rate" && !p.freightRateId && freight.data?.rates.length) set({ freightRateId: freight.data.rates[0].id });
  }, [freight.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = freight.data?.rates.find((r) => r.id === p.freightRateId) ?? null;
  const result = useMemo(
    () =>
      cbr.data
        ? computeQuote(p, { rates: { RUB: 1, ...cbr.data.rates }, hsCode: product.hsCode, tariff: tariff?.tariff || null, vat10: product.vat10, productName: product.nameRu || product.name, freight: p.transportMode === "rate" ? rate : null })
        : null,
    [p, cbr.data, tariff, rate, product],
  );

  const save = async (kp: boolean) => {
    if (!cbr.data) return;
    setBusy(kp ? "kp" : "save");
    setError(null);
    try {
      const res = await api<{ id: number }>(`/products/${product.id}/quotes`, { method: "POST", body: { params: p, rates: cbr.data.rates, ratesDate: cbr.data.date } });
      await queryClient.invalidateQueries({ queryKey: ["product-quotes", product.id] });
      if (kp) await apiDownload(`/quotes/${res.id}/kp.docx`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const field = (label: string, node: ReactNode, hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      {node}
      {hint && <span className="mt-0.5 block text-[11px] muted">{hint}</span>}
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            "Цена фабрики",
            <select
              className="input"
              value={p.offerId ?? ""}
              onChange={(e) => {
                const o = offers.find((x) => x.id === Number(e.target.value));
                setP(o ? fromOffer(p, o) : { ...p, offerId: null });
              }}
            >
              <option value="">своя цена</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.factoryNameRu || o.factoryName} — {o.name}
                  {o.price !== null ? ` — ${formatMoney(o.price, o.currency)}${o.unit ? `/${o.unit}` : ""}` : ""}
                </option>
              ))}
            </select>,
          )}
          {field("Клиент (для КП)", <input className="input" value={p.clientName} onChange={(e) => set({ clientName: e.target.value })} placeholder="ООО «…»" />)}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field(`Объём партии, ${p.unit}`, <NumInput value={p.quantity} onChange={(v) => set({ quantity: v })} placeholder="5000" />)}
          {field("Цена за ед.", <NumInput value={p.price} onChange={(v) => set({ price: v, offerId: null })} />)}
          {field(
            "Валюта",
            <select className="input" value={p.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>,
          )}
          {field("Единица", <input className="input" value={p.unit} onChange={(e) => set({ unit: e.target.value })} />)}
          {field("Вес ед., кг", <NumInput value={p.kgPerUnit} onChange={(v) => set({ kgPerUnit: v })} placeholder="0.4" />)}
          {field("Объём ед., м³", <NumInput value={p.m3PerUnit} onChange={(v) => set({ m3PerUnit: v })} placeholder="0.004" />)}
          {field("Единиц в 40HQ", <NumInput value={p.perContainer} onChange={(v) => set({ perContainer: v })} placeholder="15000" />)}
          {field("Срок доставки (в КП)", <input className="input" value={p.deliveryTerm} onChange={(e) => set({ deliveryTerm: e.target.value })} placeholder="35–40 дней" />)}
        </div>

        <div className="rounded-md border border-slate-200 p-3 dark:border-neutral-800">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Доставка</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={p.transportMode === "rate"} onChange={() => set({ transportMode: "rate" })} /> по ставке
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={p.transportMode === "manual"} onChange={() => set({ transportMode: "manual" })} /> вручную
            </label>
            <Link to="/freight-rates" className="ml-auto text-xs link">ставки доставки</Link>
          </div>
          {p.transportMode === "rate" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              {field(
                "Ставка",
                <select className="input" value={p.freightRateId ?? ""} onChange={(e) => set({ freightRateId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— выберите —</option>
                  {freight.data?.rates.map((r) => <option key={r.id} value={r.id}>{freightTitle(r)}</option>)}
                </select>,
                rate ? [rate.fee ? `+ сбор ${formatMoney(rate.fee, rate.feeCurrency)} за отправку` : null, rate.kgPerCbm ? `1 м³ = ${rate.kgPerCbm} кг` : null, rate.transitDays ? `≈ ${rate.transitDays} дн. в пути` : null, rate.quotedAt ? `ставка от ${formatDay(rate.quotedAt)}` : null].filter(Boolean).join(" · ") : undefined,
              )}
              {rate?.mode === "container" && field("Контейнеров", <NumInput value={p.containers} onChange={(v) => set({ containers: v })} placeholder={result?.containers ? String(result.containers) : "авто"} />, "пусто — посчитать")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_120px_1.5fr]">
              {field("Сумма на партию", <NumInput value={p.transportAmount} onChange={(v) => set({ transportAmount: v })} />)}
              {field(
                "Валюта",
                <select className="input" value={p.transportCurrency} onChange={(e) => set({ transportCurrency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>,
              )}
              {field("Как назвать в КП", <input className="input" value={p.transportLabel} onChange={(e) => set({ transportLabel: e.target.value })} placeholder="ЖД перевозка Сиань — Москва" />)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field("Комиссия за перевод, %", <NumInput value={p.fxPercent} onChange={(v) => set({ fxPercent: v })} />)}
          {field("Брокер, ₽", <NumInput value={p.broker} onChange={(v) => set({ broker: v })} />)}
          {field("СВХ, досмотры, ₽", <NumInput value={p.terminal} onChange={(v) => set({ terminal: v })} />)}
          {field("До склада клиента, ₽", <NumInput value={p.lastMile} onChange={(v) => set({ lastMile: v })} />)}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field("Маржа на партию, ₽", <NumInput value={p.margin} onChange={(v) => set({ margin: v })} placeholder="150000" />)}
          {field(
            "Маржа в КП",
            <select className="input" value={p.marginInKp} onChange={(e) => set({ marginInKp: e.target.value as QuoteParams["marginInKp"] })}>
              <option value="line">строкой «Вознаграждение»</option>
              <option value="goods">в стоимости товара</option>
            </select>,
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          {!result && <p className="text-sm muted">{cbr.error ? errorMessage(cbr.error) : "Курсы ЦБ…"}</p>}
          {result && (
            <>
              <div className="text-xs muted">Цена для клиента</div>
              <div className="text-2xl font-semibold tabular-nums">
                {result.perUnitRub === null ? "—" : rub(result.perUnitRub)}
                <span className="text-base font-normal muted"> / {p.unit}</span>
              </div>
              <div className="text-sm tabular-nums">за партию {rub(result.totalRub)}</div>
              <div className="mt-1 text-xs muted tabular-nums">
                себестоимость {rub(result.costPerUnitRub)} / {p.unit} · {rub(result.costRub)}
              </div>
              <table className="mt-3 w-full text-xs">
                <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                  {(
                    [
                      ["Товар", result.goodsRub, `${formatMoney(result.goods, p.currency)}`],
                      ["Доставка", result.transportRub, result.transportLabel],
                      [`Комиссия ${p.fxPercent ?? 0}%`, result.fxRub],
                      ["Пошлина", result.customs.duty, result.customs.lines[0]?.tariff ?? undefined],
                      [`НДС ${result.customs.lines[0]?.vatRate ?? 22}%`, result.customs.vat],
                      ["Брокер", result.broker],
                      ["СВХ", result.terminal],
                      ["До склада", result.lastMile],
                      ["Маржа", result.margin],
                    ] as [string, number, string?][]
                  )
                    .filter(([, v], i) => v || i < 5)
                    .map(([label, value, hint]) => (
                      <tr key={label}>
                        <td className="py-1 pr-2">
                          {label}
                          {hint && <span className="block text-[10px] muted">{hint}</span>}
                        </td>
                        <td className="whitespace-nowrap py-1 text-right tabular-nums">{rub(value)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="mt-2 text-[11px] muted">
                {[
                  result.weightKg && `вес ${result.weightKg.toLocaleString("ru-RU")} кг`,
                  result.volumeM3 && `объём ${result.volumeM3.toLocaleString("ru-RU")} м³`,
                  result.containers && `${result.containers} × ${rate?.container ?? "40HQ"}`,
                  result.chargeableCbm && `к оплате ${result.chargeableCbm.toLocaleString("ru-RU")} м³`,
                  product.hsCode ? `ТН ВЭД ${product.hsCode}` : null,
                  cbr.data && `курсы ЦБ на ${formatDay(cbr.data.date)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {result.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-[11px] text-amber-800 dark:text-amber-300">
                  {result.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !result || !p.quantity} onClick={() => void save(true)}>
            <IconFile size={12} /> {busy === "kp" ? "Готовим…" : "КП в Word"}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!busy || !result || !p.quantity} onClick={() => void save(false)}>
            {busy === "save" ? "Сохраняем…" : "Сохранить расчёт"}
          </button>
        </div>
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

        {saved.data && saved.data.quotes.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">Сохранённые расчёты</p>
            <ul className="divide-line text-xs">
              {saved.data.quotes.map((q) => (
                <li key={q.id} className="flex items-center gap-2 py-1.5">
                  <button type="button" className="min-w-0 flex-1 text-left hover:underline" title="Открыть в калькуляторе" onClick={() => setP({ ...DEFAULT_QUOTE, ...q.params })}>
                    <span className="block truncate">
                      {q.clientName || "без клиента"} · {(q.params.quantity ?? 0).toLocaleString("ru-RU")} {q.params.unit} · {rub(q.result.perUnitRub)}/{q.params.unit}
                    </span>
                    <span className="block muted">{formatDay(q.createdAt.slice(0, 10))}{q.createdByName ? ` · ${q.createdByName}` : ""}</span>
                  </button>
                  <button type="button" className="icon-btn" aria-label="КП" title="КП в Word" onClick={() => void apiDownload(`/quotes/${q.id}/kp.docx`)}>
                    <IconFile size={12} />
                  </button>
                  {(user?.role === "admin" || q.createdBy === user?.id) && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Удалить расчёт"
                      onClick={async () => {
                        await api(`/quotes/${q.id}`, { method: "DELETE" });
                        void queryClient.invalidateQueries({ queryKey: ["product-quotes", product.id] });
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function fromOffer(p: QuoteParams, o: ProductOffer): QuoteParams {
  return {
    ...p,
    offerId: o.id,
    price: o.price,
    currency: o.currency,
    unit: o.unit ?? p.unit,
    kgPerUnit: o.kgPerUnit ?? p.kgPerUnit,
    m3PerUnit: o.m3PerUnit ?? p.m3PerUnit,
    perContainer: o.perContainer ?? p.perContainer,
    quantity: p.quantity ?? o.moq,
  };
}
