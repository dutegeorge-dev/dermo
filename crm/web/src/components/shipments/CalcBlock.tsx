/**
 * «Расчёт для клиента» в карточке сделки: одна форма → КП (Word) и поручение.
 * Перевозку и наши статьи вводим руками, пошлина и НДС считаются по ТН ВЭД товаров
 * и курсу ЦБ. Расчёт хранится в сделке; перед таможней — «Пересчитать по курсу на сегодня».
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { type CalcParams, kpLines, type ShipmentCalc } from "../../../../shared/customs.ts";
import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import { api, BASE, errorMessage } from "../../lib/api.ts";
import type { ShipmentResponse } from "../../lib/types.ts";

type CalcItemRow = { productId: number | null; name: string; hsCode: string | null; tariff: string | null; tnvedName: string | null; vat10: boolean };
type CalcResponse = { calc: ShipmentCalc | null; defaults: CalcParams | null; items: CalcItemRow[]; order: { number: string | null; customs: number | null } | null };

const rub = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("ru-RU")} ₽`);
const dmy = (d: string) => d.split("-").reverse().join(".");
const toInput = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const fromInput = (s: string) => (s.trim() ? s.replace(/\s/g, "").replace(",", ".") : null);

function Num({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="relative block">
        <input className="input pr-7 tabular-nums" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs muted">{suffix}</span>}
      </span>
    </label>
  );
}

/** Код ТН ВЭД товара: правка пишется в справочник товаров (для всех сделок с этим товаром). */
function HsInput({ value, onSave }: { value: string | null; onSave: (code: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <input
      className="input w-[7.5rem] px-1.5 py-0.5 font-mono text-xs"
      value={draft}
      placeholder="10 цифр"
      aria-label="Код ТН ВЭД"
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 10))}
      onBlur={() => {
        if ((draft || null) !== (value || null) && (draft.length === 10 || !draft)) void onSave(draft || null);
        else setDraft(value ?? "");
      }}
    />
  );
}

export function CalcBlock({ data }: { data: ShipmentResponse }) {
  const sh = data.shipment;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["calc", sh.number], queryFn: () => api<CalcResponse>(`/shipments/${sh.number}/calc`) });
  const [form, setForm] = useState<Record<keyof CalcParams, string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = q.data?.calc ?? q.data?.defaults ?? null;
  useEffect(() => {
    if (!base) return;
    setForm({
      transportLabel: base.transportLabel,
      transportAmount: toInput(base.transportAmount),
      transportCurrency: base.transportCurrency,
      fxPercent: toInput(base.fxPercent),
      broker: toInput(base.broker),
      terminal: toInput(base.terminal),
      commission: toInput(base.commission),
      lastMile: toInput(base.lastMile),
      deliveryTerm: base.deliveryTerm,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.calc?.calculatedAt, q.data?.defaults]);

  if (q.isLoading || !q.data) return null;
  const { calc, items, order } = q.data;
  const invoices = data.documents.filter((d) => d.type === "supplier_invoice");
  const commission = sh.scheme === "commission";
  const orderDoc = data.documents.find((d) => d.id === data.finance.orderId);
  const set = (k: keyof CalcParams, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calc", sh.number] });
    void queryClient.invalidateQueries({ queryKey: ["shipment", sh.number] });
  };
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const save = (refreshRates = false) =>
    act(refreshRates ? "rates" : "save", () =>
      api(`/shipments/${sh.number}/calc`, {
        method: "POST",
        body: {
          ...Object.fromEntries(Object.entries(form ?? {}).map(([k, v]) => [k, ["transportLabel", "transportCurrency", "deliveryTerm"].includes(k) ? v : fromInput(v)])),
          refreshRates,
        },
      }),
    );
  // Правка товара (код, НДС 10 %) — и сразу пересчёт по тому же курсу.
  const patchProduct = (productId: number, patch: Record<string, unknown>) =>
    act("product", async () => {
      await api(`/products/${productId}`, { method: "PATCH", body: patch });
      if (calc) await api(`/shipments/${sh.number}/calc`, { method: "POST", body: {} });
    });

  const kp = calc ? kpLines(calc) : null;
  const lines = calc?.customs.lines ?? items.map((i) => ({ ...i, customsValue: null, duty: null, vat: null, vatRate: i.vat10 ? 10 : 22, note: null }));
  const vat10Of = new Map(items.map((i) => [i.productId, i.vat10]));
  const noCargo = !sh.weightKg || !sh.volumeM3;
  const customsNow = calc ? calc.customs.duty + calc.customs.vat : null;

  return (
    <section id="calc" className="panel scroll-mt-16 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Расчёт для клиента — КП и поручение</h2>
        {calc && (
          <a className="btn btn-sm" href={`${BASE}/api/shipments/${sh.number}/kp.docx`}>
            КП (Word)
          </a>
        )}
        {commission &&
          (orderDoc ? (
            <a className="btn btn-sm" href={`${BASE}/api/documents/${orderDoc.id}/docx`}>
              Поручение № {orderDoc.number} (Word)
            </a>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!calc || !!busy}
              title={!calc ? "Сначала рассчитайте" : undefined}
              onClick={() =>
                void act("order", async () => {
                  const res = await api<{ document: { id: number } }>(`/shipments/${sh.number}/order`, { method: "POST" });
                  navigate(`/documents/${res.document.id}/edit`);
                })
              }
            >
              Сформировать поручение
            </button>
          ))}
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm muted">Сначала загрузите инвойс поставщика — товары и суммы берутся из него.</p>
      ) : (
        <>
          {noCargo && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">Укажите в сделке вес и объём груза (справа, блок «Груз») — без них не посчитать пошлину «за кг» и КП.</p>}
          {form && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-3">
                <span className="label">Перевозка — как назвать в КП</span>
                <div className="flex gap-2">
                  <input className="input flex-1" value={form.transportLabel} onChange={(e) => set("transportLabel", e.target.value)} placeholder="ЖД перевозка 1 куб. м" />
                  <input className="input w-32 tabular-nums" inputMode="decimal" aria-label="Стоимость перевозки" placeholder="Стоимость" value={form.transportAmount} onChange={(e) => set("transportAmount", e.target.value)} />
                  <select className="input w-20" aria-label="Валюта перевозки" value={form.transportCurrency} onChange={(e) => set("transportCurrency", e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </label>
              <Num label="Комиссия за валютный перевод" suffix="%" value={form.fxPercent} onChange={(v) => set("fxPercent", v)} />
              <Num label="Таможенное оформление (брокер)" suffix="₽" value={form.broker} onChange={(v) => set("broker", v)} />
              <Num label="Хранение на СВХ, досмотры" suffix="₽" value={form.terminal} onChange={(v) => set("terminal", v)} />
              <Num label="Комиссия транспортной компании" suffix="₽" value={form.commission} onChange={(v) => set("commission", v)} />
              <Num label="Доставка до склада клиента (примерно)" suffix="₽" value={form.lastMile} onChange={(v) => set("lastMile", v)} />
              <label className="block">
                <span className="label">Срок доставки (в КП)</span>
                <input className="input" value={form.deliveryTerm} onChange={(e) => set("deliveryTerm", e.target.value)} placeholder="20–25 дней, поезда каждую пятницу" />
              </label>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || noCargo} onClick={() => void save(false)}>
              {busy === "save" ? "Считаем…" : calc ? "Сохранить и пересчитать" : "Рассчитать"}
            </button>
            {calc && (
              <button type="button" className="btn btn-sm" disabled={!!busy || noCargo} onClick={() => void save(true)} title="Пошлина и НДС зависят от курса — пересчитайте перед таможней">
                {busy === "rates" ? "Получаем курс…" : "Пересчитать по курсу ЦБ на сегодня"}
              </button>
            )}
            {calc && (
              <span className="text-xs muted">
                Курс ЦБ на {dmy(calc.ratesDate)}: {["USD", "EUR", "CNY"].map((c) => `${c} ${calc.rates[c]?.toLocaleString("ru-RU")}`).join(" · ")}
              </span>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs muted">
                  <th className="py-1 pr-2 font-medium">Товар</th>
                  <th className="py-1 pr-2 font-medium">ТН ВЭД и ставка</th>
                  <th className="py-1 pr-2 text-right font-medium">Там. стоимость</th>
                  <th className="py-1 pr-2 text-right font-medium">Пошлина</th>
                  <th className="py-1 pr-2 text-right font-medium">НДС</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                {lines.map((l, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="py-1.5 pr-2">
                      {l.name}
                      {l.note && <div className="text-[11px] text-amber-700 dark:text-amber-400">{l.note}</div>}
                    </td>
                    <td className="py-1.5 pr-2">
                      {l.productId ? <HsInput value={l.hsCode} onSave={(hsCode) => patchProduct(l.productId!, { hsCode })} /> : <span className="font-mono text-xs">{l.hsCode ?? "—"}</span>}
                      <div className="mt-0.5 text-[11px] muted">{l.tariff || "ставка не найдена"}</div>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{l.customsValue === null ? "" : rub(l.customsValue)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{l.duty === null ? "" : rub(l.duty)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                      {l.vat === null ? "" : rub(l.vat)}
                      <label className="mt-0.5 flex items-center justify-end gap-1 text-[11px] muted" title="Льготная ставка НДС 10 % — запоминается в товаре">
                        <input
                          type="checkbox"
                          disabled={!l.productId || !!busy}
                          checked={vat10Of.get(l.productId) ?? l.vatRate === 10}
                          onChange={(e) => l.productId && void patchProduct(l.productId, { vat10: e.target.checked })}
                        />
                        НДС 10 %
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
              {calc && (
                <tfoot>
                  <tr className="border-t border-slate-300 font-medium dark:border-neutral-700">
                    <td className="py-1.5" colSpan={2}>
                      Итого таможенные платежи: <span className="tabular-nums">{rub(customsNow)}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{rub(calc.customs.customsValue)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{rub(calc.customs.duty)}</td>
                    <td className="py-1.5 text-right tabular-nums">{rub(calc.customs.vat)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {order?.customs != null && customsNow !== null && Math.round(order.customs) !== Math.round(customsNow) && (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-400">
              В поручении № {order.number} таможенные платежи — {rub(order.customs)}, по текущему расчёту — {rub(customsNow)} ({customsNow > order.customs ? "+" : ""}
              {rub(customsNow - order.customs)}).
            </p>
          )}

          {kp && calc && (
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm dark:bg-neutral-800/40">
              <div className="mb-1 text-xs font-semibold muted">Как будет в КП</div>
              <table className="w-full">
                <tbody>
                  {kp.lines.map((l) => (
                    <tr key={l.name}>
                      <td className={`py-0.5 pr-2 ${l.indent ? "pl-4" : ""}`}>{l.name}</td>
                      <td className="whitespace-nowrap py-0.5 text-right tabular-nums">{l.amount === null ? "" : `${l.approx ? "≈ " : ""}${rub(l.amount)}`}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300 font-semibold dark:border-neutral-700">
                    <td className="py-1">Итого стоимость доставки и таможни</td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">{rub(kp.total)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-xs muted">
                Товар: {formatMoney(calc.goodsAmount, calc.goodsCurrency)} = {rub(kp.goodsRub)}. Таможенная стоимость = товар + ½ перевозки.
              </p>
              {calc.customs.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 dark:text-amber-400">
                  {calc.customs.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
