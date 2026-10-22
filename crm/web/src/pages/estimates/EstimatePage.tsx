/**
 * Расчёт по заявке клиента на его товар: вставили текст заявки → ИИ разложил по полям (груз, вес, объём,
 * маршрут, ТН ВЭД, стоимость) → поправили → итог с доставкой и растаможкой → КП в Word.
 * Считается сразу в браузере (shared/estimate.ts); при сохранении сервер пересчитывает по тем же курсам.
 */

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { dutyUnit, dutyUnitLabel, isWeightUnit, unitMatches } from "../../../../shared/customs.ts";
import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import { computeEstimate, DEFAULT_ESTIMATE, emptyEstimateItem, type EstimateItem, type EstimateParams, ESTIMATE_SCHEMES, type EstimateScheme } from "../../../../shared/estimate.ts";
import { formatDay } from "../../components/docs/common.tsx";
import { IconFile, IconPlus, IconSparkles, IconTrash, IconX } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { NumInput } from "../../components/products/QuoteCalculator.tsx";
import { ConfirmDialog, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { useAiEnabled } from "../../lib/ai.ts";
import { api, apiDownload, errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { freightTitle, useFreightRates } from "../factories/FreightRatesPage.tsx";

type Saved = { id: number; request: string; params: EstimateParams; ratesDate: string | null; createdBy: number | null };

const rub = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatMoney(n, "RUB"));

function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] muted">{hint}</span>}
    </label>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}

export function EstimatePage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const saved = useQuery({ queryKey: ["estimate", id], queryFn: () => api<{ estimate: Saved }>(`/estimates/${id}`), enabled: !isNew });
  if (!isNew && !saved.data) {
    return (
      <Content>
        {saved.isLoading && <Spinner />}
        <ErrorBox error={saved.error} />
      </Content>
    );
  }
  return <EstimateForm key={id ?? "new"} saved={saved.data?.estimate ?? null} />;
}

function EstimateForm({ saved }: { saved: Saved | null }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const aiEnabled = useAiEnabled();
  const freight = useFreightRates();
  const cbr = useQuery({ queryKey: ["cbr-rates"], queryFn: () => api<{ date: string; rates: Record<string, number> }>("/cbr-rates"), staleTime: 60 * 60_000 });
  const [p, setP] = useState<EstimateParams>(() => (saved ? { ...DEFAULT_ESTIMATE, ...saved.params, items: saved.params.items.length ? saved.params.items : [emptyEstimateItem()] } : DEFAULT_ESTIMATE));
  const [request, setRequest] = useState(saved?.request ?? "");
  const [ai, setAi] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const set = (patch: Partial<EstimateParams>) => setP((x) => ({ ...x, ...patch }));
  const setItem = (i: number, patch: Partial<EstimateItem>) => set({ items: p.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  // Ставки пошлины по кодам ТН ВЭД (кэш общий с полями ТН ВЭД в документах).
  const codes = [...new Set(p.items.map((i) => i.hsCode).filter((c): c is string => !!c && /^\d{10}$/.test(c)))];
  const tariffQueries = useQueries({
    queries: codes.map((code) => ({
      queryKey: ["tnved", code],
      queryFn: () => api<{ codes: { code: string; name: string; tariff: string }[] }>(`/tnved?q=${code}`),
      staleTime: 60 * 60_000,
    })),
  });
  const tariffs: Record<string, string> = {};
  const tariffNames: Record<string, string> = {};
  codes.forEach((code, i) => {
    const row = tariffQueries[i]?.data?.codes.find((c) => c.code === code);
    if (row) {
      tariffs[code] = row.tariff;
      tariffNames[code] = row.name;
    }
  });
  const tariffKey = JSON.stringify(tariffs);
  /** Единица пошлины по коду ТН ВЭД («за 1 пар» → пар); undefined — ставка ещё не загружена. */
  const unitOf = (it: EstimateItem) => (it.hsCode && tariffs[it.hsCode] !== undefined ? dutyUnit(tariffs[it.hsCode]) : null);
  // Пошлина за пару / м² / шт / л — единица товара закрепляется за кодом.
  useEffect(() => {
    const fixed = p.items.map((it) => {
      const du = unitOf(it);
      return du && !isWeightUnit(du) && !unitMatches(du, it.unit) ? { ...it, unit: dutyUnitLabel(du) } : it;
    });
    if (fixed.some((it, i) => it !== p.items[i])) set({ items: fixed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tariffKey, p.items.map((i) => i.hsCode).join()]);

  const rate = freight.data?.rates.find((r) => r.id === p.freightRateId) ?? null;
  const result = useMemo(() => {
    if (!cbr.data) return null;
    try {
      return computeEstimate(p, { rates: { RUB: 1, ...cbr.data.rates }, tariffs, freight: p.transportMode === "rate" ? rate : null });
    } catch (e) {
      return { error: errorMessage(e) } as const;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, cbr.data, tariffKey, rate]);
  const res = result && !("error" in result) ? result : null;

  const parse = async () => {
    setAi({ busy: true, error: null, done: false });
    try {
      const { params } = await api<{ params: Partial<EstimateParams> }>("/estimates/parse", { method: "POST", body: { text: request } });
      setP((x) => ({ ...x, ...params, items: params.items?.length ? params.items : x.items }));
      setAi({ busy: false, error: null, done: true });
    } catch (e) {
      setAi({ busy: false, error: errorMessage(e), done: false });
    }
  };

  const save = async (kp: boolean) => {
    if (!cbr.data) return;
    setBusy(kp ? "kp" : "save");
    setError(null);
    try {
      const payload = { params: p, request, rates: cbr.data.rates, ratesDate: cbr.data.date };
      const { id } = saved ? await api<{ id: number }>(`/estimates/${saved.id}`, { method: "PUT", body: payload }) : await api<{ id: number }>("/estimates", { method: "POST", body: payload });
      await queryClient.invalidateQueries({ queryKey: ["estimates"] });
      await queryClient.invalidateQueries({ queryKey: ["estimate", String(id)] });
      if (kp) await apiDownload(`/estimates/${id}/kp.docx`);
      if (!saved) navigate(`/estimates/${id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const teu = p.scheme === "teu";
  const goods = p.items.reduce((s, i) => s + (i.amount ?? 0), 0);

  return (
    <Content wide>
      <PageHeader
        title={saved ? p.title || "Расчёт" : "Новый расчёт"}
        meta={<Link to="/estimates" className="link">← все расчёты</Link>}
        actions={
          saved && (user?.role === "admin" || saved.createdBy === user?.id) ? (
            <button type="button" className="btn" onClick={() => setRemoving(true)}>
              <IconTrash size={14} /> Удалить
            </button>
          ) : undefined
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Section
            title="Заявка клиента"
            aside={
              aiEnabled && (
                <button type="button" className="btn btn-sm" disabled={ai.busy || !request.trim()} onClick={() => void parse()}>
                  <IconSparkles size={13} /> {ai.busy ? "Разбираем…" : "Заполнить по заявке"}
                </button>
              )
            }
          >
            <textarea
              className="input min-h-[120px] text-sm"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Вставьте заявку как прислали: что за товар, производитель, место забора, пункт назначения, упаковка и размеры, вес, стоимость, код ТН ВЭД, условия (EXW…)"
            />
            {ai.error && <p className="text-xs text-red-700 dark:text-red-400">{ai.error}</p>}
            {ai.done && <p className="text-xs text-green-700 dark:text-green-400">Поля заполнены по заявке — проверьте. Доставку, брокера и проценты задайте ниже.</p>}
          </Section>

          <Section title="Основное">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Груз (название в КП)">
                <input className="input" value={p.title} onChange={(e) => set({ title: e.target.value })} placeholder="Рекламный призматрон Tri-Vision" />
              </Field>
              <Field label="Клиент (для КП)">
                <input className="input" value={p.clientName} onChange={(e) => set({ clientName: e.target.value })} placeholder="ООО «…»" />
              </Field>
              <Field label="Производитель / продавец">
                <input className="input" value={p.supplier} onChange={(e) => set({ supplier: e.target.value })} />
              </Field>
              <Field label="Условия поставки">
                <input className="input" value={p.incoterms} onChange={(e) => set({ incoterms: e.target.value })} placeholder="EXW Dongguan" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {(Object.entries(ESTIMATE_SCHEMES) as [EstimateScheme, string][]).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="radio" checked={p.scheme === k} onChange={() => set({ scheme: k })} /> {label}
                </label>
              ))}
            </div>
            <p className="text-xs muted">
              {teu
                ? `ТЭУ: товар клиент оплачивает поставщику сам; комиссия за перевод ${p.fxPercent ?? 0}% — только на фрахт, затем +${p.teuPercent ?? 0}% от общей суммы вместе с комиссией компании.`
                : `Комиссия: оплачиваем товар и перевозку — комиссия за перевод ${p.fxPercent ?? 0}% на товар + перевозку.`}
            </p>
          </Section>

          <Section
            title="Товары"
            aside={
              <label className="flex items-center gap-1.5 text-xs">
                Валюта
                <select className="input w-24 py-1" value={p.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            }
          >
            {p.items.map((it, i) => (
              <div key={i} className="relative rounded-md border border-slate-200 p-3 dark:border-neutral-800">
                {p.items.length > 1 && (
                  <button type="button" className="icon-btn absolute right-1.5 top-1.5" aria-label="Убрать товар" onClick={() => set({ items: p.items.filter((_, j) => j !== i) })}>
                    <IconX size={14} />
                  </button>
                )}
                <div className="grid gap-2 pr-6 sm:grid-cols-[1fr_150px]">
                  <Field label="Наименование">
                    <input className="input" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                  </Field>
                  <Field
                    label="Код ТН ВЭД"
                    hint={
                      it.hsCode && /^\d{10}$/.test(it.hsCode) ? (
                        tariffs[it.hsCode] !== undefined ? (
                          <span title={tariffNames[it.hsCode]}>пошлина {tariffs[it.hsCode] || "—"}</span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">нет в справочнике</span>
                        )
                      ) : it.hsCode ? (
                        "нужно 10 цифр"
                      ) : undefined
                    }
                  >
                    <input className="input font-mono" value={it.hsCode ?? ""} placeholder="10 цифр" onChange={(e) => setItem(i, { hsCode: e.target.value.replace(/\D/g, "").slice(0, 10) || null })} />
                  </Field>
                </div>
                {(() => {
                  const du = unitOf(it);
                  const locked = !!du && !isWeightUnit(du);
                  const share = p.weightKg && goods && it.amount ? Math.round((p.weightKg * it.amount) / goods) : null;
                  return (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label={locked ? `Количество, ${dutyUnitLabel(du!)}` : "Количество"}>
                          <NumInput value={it.quantity} onChange={(v) => setItem(i, { quantity: v })} />
                        </Field>
                        <Field label="Ед." hint={locked ? "по ТН ВЭД" : undefined}>
                          <input
                            className="input"
                            value={it.unit}
                            disabled={locked}
                            title={locked ? `Пошлина по этому коду — за 1 ${dutyUnitLabel(du!)}, количество — в ${dutyUnitLabel(du!)}` : undefined}
                            onChange={(e) => setItem(i, { unit: e.target.value })}
                          />
                        </Field>
                  <Field label={`Стоимость, ${p.currency}`}>
                    <NumInput value={it.amount} onChange={(v) => setItem(i, { amount: v })} />
                  </Field>
                        <label className="flex items-end gap-1.5 pb-2 text-xs">
                          <input type="checkbox" checked={it.vat10} onChange={(e) => setItem(i, { vat10: e.target.checked })} /> НДС 10%
                        </label>
                      </div>
                      {locked && <p className="mt-1 text-[11px] muted">Пошлина по этому коду — за 1 {dutyUnitLabel(du!)}: количество указывайте в {dutyUnitLabel(du!)}.</p>}
                      {du && isWeightUnit(du) && (
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <Field wide label="Вес товара для пошлины, кг" hint={`пошлина за 1 ${dutyUnitLabel(du)}${it.dutyQty ? "" : share ? ` · пусто — ${share.toLocaleString("ru-RU")} кг (доля общего веса)` : " · пусто — доля общего веса"}`}>
                            <NumInput value={it.dutyQty ?? null} onChange={(v) => setItem(i, { dutyQty: v })} placeholder={share ? String(share) : undefined} />
                          </Field>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-sm" onClick={() => set({ items: [...p.items, emptyEstimateItem()] })}>
                <IconPlus size={12} /> Товар
              </button>
              {p.items.length > 1 && <span className="text-xs muted">Итого товар: {formatMoney(goods, p.currency)}</span>}
            </div>
          </Section>

          <Section title="Груз и маршрут">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Откуда (место забора)">
                <input className="input" value={p.pickup} onChange={(e) => set({ pickup: e.target.value })} placeholder="Dongguan, Guangdong, Китай" />
              </Field>
              <Field label="Куда">
                <input className="input" value={p.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="Москва" />
              </Field>
              <Field label="Упаковка, размеры мест" wide>
                <input className="input" value={p.packaging} onChange={(e) => set({ packaging: e.target.value })} placeholder="Фанерный ящик 310 × 100 × 86 см" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Мест">
                <NumInput value={p.places} onChange={(v) => set({ places: v })} />
              </Field>
              <Field label="Вес брутто, кг">
                <NumInput value={p.weightKg} onChange={(v) => set({ weightKg: v })} />
              </Field>
              <Field label="Объём, м³">
                <NumInput value={p.volumeM3} onChange={(v) => set({ volumeM3: v })} />
              </Field>
              <Field label="Срок (в КП)">
                <input className="input" value={p.deliveryTerm} onChange={(e) => set({ deliveryTerm: e.target.value })} placeholder="35–45 дней" />
              </Field>
            </div>
          </Section>

          <Section
            title="Доставка"
            aside={
              <>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={p.transportMode === "manual"} onChange={() => set({ transportMode: "manual" })} /> вручную
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    checked={p.transportMode === "rate"}
                    onChange={() => set({ transportMode: "rate", freightRateId: p.freightRateId ?? freight.data?.rates[0]?.id ?? null })}
                  />{" "}
                  по ставке
                </label>
                <Link to="/freight-rates" className="text-xs link">ставки доставки</Link>
              </>
            }
          >
            {p.transportMode === "rate" ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <Field
                  label="Ставка"
                  hint={rate ? [rate.fee ? `+ сбор ${formatMoney(rate.fee, rate.feeCurrency)} за отправку` : null, rate.kgPerCbm ? `1 м³ = ${rate.kgPerCbm} кг` : null, rate.transitDays ? `≈ ${rate.transitDays} дн. в пути` : null, rate.quotedAt ? `ставка от ${formatDay(rate.quotedAt)}` : null].filter(Boolean).join(" · ") : undefined}
                >
                  <select className="input" value={p.freightRateId ?? ""} onChange={(e) => set({ freightRateId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— выберите —</option>
                    {freight.data?.rates.map((r) => <option key={r.id} value={r.id}>{freightTitle(r)}</option>)}
                  </select>
                </Field>
                {rate?.mode === "container" && (
                  <Field label="Контейнеров" hint="пусто — посчитать">
                    <NumInput value={p.containers} onChange={(v) => set({ containers: v })} placeholder={res?.containers ? String(res.containers) : "авто"} />
                  </Field>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_110px_1.5fr]">
                <Field label="Сумма за перевозку">
                  <NumInput value={p.transportAmount} onChange={(v) => set({ transportAmount: v })} />
                </Field>
                <Field label="Валюта">
                  <select className="input" value={p.transportCurrency} onChange={(e) => set({ transportCurrency: e.target.value })}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Как назвать в КП">
                  <input className="input" value={p.transportLabel} onChange={(e) => set({ transportLabel: e.target.value })} placeholder="Авто перевозка Dongguan — Москва, сборный груз" />
                </Field>
              </div>
            )}
          </Section>

          <Section title="Расходы и вознаграждение">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Комиссия за перевод, %" hint={teu ? "от фрахта" : "от товара + перевозки"}>
                <NumInput value={p.fxPercent} onChange={(v) => set({ fxPercent: v })} />
              </Field>
              {teu && (
                <Field label="ТЭУ, % от общей суммы">
                  <NumInput value={p.teuPercent} onChange={(v) => set({ teuPercent: v })} />
                </Field>
              )}
              <Field label="Брокер, ₽">
                <NumInput value={p.broker} onChange={(v) => set({ broker: v })} />
              </Field>
              <Field label="СВХ, досмотры, ₽">
                <NumInput value={p.terminal} onChange={(v) => set({ terminal: v })} />
              </Field>
              <Field label="До склада клиента, ₽">
                <NumInput value={p.lastMile} onChange={(v) => set({ lastMile: v })} />
              </Field>
              <Field label="Комиссия компании, ₽">
                <NumInput value={p.commission} onChange={(v) => set({ commission: v })} />
              </Field>
            </div>
            {p.extras.map((e, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label="Прочий расход">
                  <input className="input" value={e.name} placeholder="Сертификация" onChange={(ev) => set({ extras: p.extras.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) })} />
                </Field>
                <Field label="₽">
                  <NumInput className="input w-32" value={e.amount} onChange={(v) => set({ extras: p.extras.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} />
                </Field>
                <button type="button" className="icon-btn mb-1.5" aria-label="Убрать расход" onClick={() => set({ extras: p.extras.filter((_, j) => j !== i) })}>
                  <IconX size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => set({ extras: [...p.extras, { name: "", amount: null }] })}>
              <IconPlus size={12} /> Прочий расход
            </button>
            <Field label="Заметки (что уточнить)">
              <textarea className="input min-h-[60px] text-sm" value={p.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </Section>
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
            {!result && <p className="text-sm muted">{cbr.error ? errorMessage(cbr.error) : "Курсы ЦБ…"}</p>}
            {result && "error" in result && <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
            {res && (
              <>
                <div className="text-xs muted">Итого для клиента</div>
                <div className="text-2xl font-semibold tabular-nums">{rub(res.totalRub)}</div>
                <div className="text-xs muted tabular-nums">без товара {rub(res.totalRub - res.goodsRub)}</div>
                <table className="mt-3 w-full text-xs">
                  <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                    {(
                      [
                        [teu ? "Товар (платит клиент)" : "Товар", res.goodsRub, formatMoney(res.goods, p.currency)],
                        ["Доставка", res.transportRub, res.transportLabel],
                        [`Комиссия за перевод ${(p.fxPercent ?? 0).toLocaleString("ru-RU")}%`, res.fxRub, `от ${rub(res.fxBase)}`],
                        ["Пошлина", res.customs.duty],
                        ["НДС", res.customs.vat],
                        ["Брокер", res.broker],
                        ["СВХ", res.terminal],
                        ["До склада", res.lastMile],
                        ["Прочие", res.extras],
                        [`ТЭУ ${(p.teuPercent ?? 0).toLocaleString("ru-RU")}%`, res.teuRub, `от ${rub(res.subtotal + res.commission)} (с комиссией компании)`],
                        ["Комиссия компании", res.commission],
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
                    p.weightKg && `вес ${p.weightKg.toLocaleString("ru-RU")} кг`,
                    p.volumeM3 && `объём ${p.volumeM3.toLocaleString("ru-RU")} м³`,
                    res.containers && `${res.containers} × ${rate?.container ?? "40HQ"}`,
                    res.chargeableCbm && `к оплате ${res.chargeableCbm.toLocaleString("ru-RU")} м³`,
                    `там. стоимость ${rub(res.customs.customsValue)}`,
                    cbr.data && `курсы ЦБ на ${formatDay(cbr.data.date)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {res.warnings.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-[11px] text-amber-800 dark:text-amber-300">
                    {res.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !res} onClick={() => void save(true)}>
              <IconFile size={12} /> {busy === "kp" ? "Готовим…" : "КП в Word"}
            </button>
            <button type="button" className="btn btn-sm" disabled={!!busy || !res} onClick={() => void save(false)}>
              {busy === "save" ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
          {saved?.ratesDate && <p className="text-[11px] muted">Сохранён по курсам на {formatDay(saved.ratesDate)}; при сохранении — курсы на сегодня.</p>}
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        </div>
      </div>
      {removing && saved && (
        <ConfirmDialog
          title="Удалить расчёт?"
          message={p.title || "Расчёт"}
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await api(`/estimates/${saved.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["estimates"] });
            navigate("/estimates");
          }}
        />
      )}
    </Content>
  );
}
