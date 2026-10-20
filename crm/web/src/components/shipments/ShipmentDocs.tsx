/** Блок сделки «Документы»: договоры, подрядчики, документы по группам, поручение, план/факт. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { CLIENT_CONTRACT_BY_SCHEME, CONTRACTOR_TYPES, DOC_GROUPS, type DocGroup, docSpec, formatMoney } from "../../../../shared/documents.ts";
import { api, BASE, fileUrl } from "../../lib/api.ts";
import type { DealDocument, DocumentRow, FinanceRow, Money, ShipmentResponse } from "../../lib/types.ts";
import { docTitle, docTypeLabel, formatDay, PaymentChip, StatusChip } from "../docs/common.tsx";
import { IconFile, IconPlus } from "../Icons.tsx";
import { ErrorBox } from "../ui.tsx";
import { useShipmentActions } from "./common.tsx";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "../crm/CounterpartyPicker.tsx";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Save = (patch: Record<string, unknown>) => Promise<void>;

export function money(list: Money[]) {
  if (list.length === 0) return <span className="muted">—</span>;
  return list.map((m) => (
    <span key={m.currency} className="block">
      {formatMoney(m.amount, m.currency)}
      {m.paid < m.amount && <span className="text-xs text-red-600 dark:text-red-400"> · оплачено {formatMoney(m.paid, m.currency)}</span>}
    </span>
  ));
}

function ContractSelect({ label, value, type, counterpartyId, save, field }: { label: string; value: number | null; type: string; counterpartyId: number | null; save: Save; field: string }) {
  const { data } = useQuery({
    queryKey: ["documents", "contracts", type, counterpartyId],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?type=${type}&counterparty=${counterpartyId}`),
    enabled: !!counterpartyId,
  });
  return (
    <div className="block">
      <span className="label">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <select className="input" value={value ?? ""} disabled={!counterpartyId} onChange={(e) => void save({ [field]: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{counterpartyId ? (data?.documents.length ? "— не выбран —" : "нет договора — загрузите") : "—"}</option>
          {data?.documents.map((d) => <option key={d.id} value={d.id}>{docTitle(d)}{d.status === "cancelled" ? " (аннулирован)" : ""}</option>)}
        </select>
        {value && <Link to={`/documents/${value}`} className="link shrink-0 text-xs">открыть</Link>}
      </span>
    </div>
  );
}

export function PartiesBlock({ data, run }: { data: ShipmentResponse; run: Run }) {
  const sh = data.shipment;
  const [adding, setAdding] = useState(false);
  const [party, setParty] = useState<Picked | null>(null);
  // Перевозчик уже показан отдельной строкой — здесь брокер, СВХ, агенты и прочие подрядчики.
  const others = data.parties.filter((p) => p.id !== sh.carrierId);
  return (
    <div className="space-y-3 text-sm">
      {others.map((p) => (
        <div key={p.id} className="block">
          <span className="label">{CONTRACTOR_TYPES[p.contractorType as keyof typeof CONTRACTOR_TYPES] ?? "Подрядчик"}</span>
          <div className="flex items-center gap-2">
            <Link to={`/contractors/${p.id}`} className="link min-w-0 truncate">{p.name}</Link>
            <button type="button" className="ml-auto shrink-0 text-xs link" onClick={() => void run(() => api(`/shipments/${sh.number}/parties/${p.id}`, { method: "DELETE" }))}>
              убрать
            </button>
          </div>
        </div>
      ))}
      {adding ? (
        <span className="mt-1 flex gap-2">
          <span className="flex-1"><CounterpartyPicker role="contractor" value={party} onChange={setParty} autoFocus /></span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              const id = await ensureCounterparty(party, "contractor");
              if (id) await run(() => api(`/shipments/${sh.number}/parties`, { method: "POST", body: { counterpartyId: id } }));
              setAdding(false);
              setParty(null);
            }}
          >
            OK
          </button>
        </span>
      ) : (
        <button type="button" className="text-xs link" onClick={() => setAdding(true)} title="Брокер, СВХ, агент — добавляются и сами из их счетов">
          + участник (брокер, СВХ…)
        </button>
      )}
    </div>
  );
}

export function ShipmentDocs({ data, save }: { data: ShipmentResponse; save: Save }) {
  const sh = data.shipment;

  const contractIds = new Set([sh.clientContractId, sh.supplierContractId]);
  const docs = data.documents.filter((d) => !contractIds.has(d.id));
  const byGroup = new Map<DocGroup, typeof docs>();
  for (const d of docs) {
    const g = (docSpec(d.type)?.group ?? "other") as DocGroup;
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const order = data.documents.find((d) => d.id === data.finance.orderId);
  const { refresh } = useShipmentActions();
  const [proofError, setProofError] = useState<unknown>(null);
  const uploadProof = async (documentId: number, file: File) => {
    setProofError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/documents/${documentId}/files?label=payment`, { method: "POST", form });
      refresh(sh.number);
    } catch (e) {
      setProofError(e);
    }
  };

  return (
    <section className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Документы</h2>
        {!order && sh.scheme === "commission" && <span className="text-xs muted">поручение — в «Расчёте для клиента» внизу</span>}
        <span className="flex-1" />
        <Link
          to={`/documents/new?shipment=${sh.number}`}
          className="btn btn-primary btn-sm"
          title="Инвойс, счёт, упаковочный лист, платёжка, накладная, ДТ… — тип и данные распознаются сами"
        >
          <IconPlus size={12} /> Загрузить документ
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ContractSelect label="Договор с клиентом" value={sh.clientContractId} type={CLIENT_CONTRACT_BY_SCHEME[sh.scheme]} counterpartyId={sh.clientId} save={save} field="clientContractId" />
        <ContractSelect label="Контракт с поставщиком" value={sh.supplierContractId} type="supplier_contract" counterpartyId={sh.supplierId} save={save} field="supplierContractId" />
      </div>
      {proofError != null && <ErrorBox error={proofError} />}

      {docs.length === 0 && <p className="text-sm muted">Документов пока нет. Загрузите инвойс поставщика — он сам привяжется к договору, товары попадут в справочник.</p>}
      {docs.length > 0 && (
        <div className="space-y-3">
          {(Object.keys(DOC_GROUPS) as DocGroup[])
            .filter((g) => byGroup.has(g))
            .map((g) => (
              <div key={g}>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">{DOC_GROUPS[g]}</p>
                <ul className="space-y-2 text-sm">
                  {byGroup.get(g)!.map((d) => (
                    <DocCard key={d.id} doc={d} onProof={(f) => void uploadProof(d.id, f)} />
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

    </section>
  );
}

/** Деньги сделки: главные суммы плитками и «план / факт» по статьям. */
export function FinanceBlock({ data }: { data: ShipmentResponse }) {
  const rows = Object.fromEntries(data.finance.rows.map((r) => [r.category, r]));
  const tile = (label: string, list: Money[] | undefined, plan?: { amount: number | null; currency: string } | null, hint?: string) => (
    <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-neutral-800">
      <div className="text-xs muted">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">
        {list && list.length ? (
          list.map((m) => <span key={m.currency} className="block">{formatMoney(m.amount, m.currency)}</span>)
        ) : plan?.amount != null ? (
          <span className="muted" title="Плановая сумма — из расчёта или поручения">≈ {formatMoney(plan.amount, plan.currency)}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      {list?.some((m) => m.paid < m.amount) && (
        <div className="text-[11px] text-red-600 dark:text-red-400">
          не оплачено {list.filter((m) => m.paid < m.amount).map((m) => formatMoney(m.amount - m.paid, m.currency)).join(" + ")}
        </div>
      )}
      {list?.length && list.every((m) => m.paid >= m.amount) ? <div className="text-[11px] text-green-700 dark:text-green-400">оплачено</div> : null}
      {hint && !list?.length && <div className="text-[11px] muted">{hint}</div>}
    </div>
  );
  // Комиссия компании: выставленный клиенту счёт на вознаграждение (схема «комиссия»), иначе — по плану.
  const commissionFact = data.shipment.scheme === "commission" && data.finance.clientInvoices.length ? data.finance.clientInvoices : rows.commission?.fact;
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="text-sm font-semibold">Деньги</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tile("Стоимость партии", rows.goods?.fact, rows.goods?.plan, "по инвойсу поставщика")}
        {tile("Перевозка", rows.transport?.fact, rows.transport?.plan, "по счетам перевозчиков")}
        {tile("Таможенные платежи", rows.customs?.fact, rows.customs?.plan, "по ДТ")}
        {tile("Комиссия компании", commissionFact, rows.commission?.plan, "вознаграждение по расчёту")}
      </div>
      <Totals rows={data.finance.rows} lastMile={data.finance.lastMile} />
      {(data.finance.rows.length > 0 || data.finance.clientInvoices.length > 0) && (
        <div className="border-t border-slate-200 pt-3 dark:border-neutral-800">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">План / факт по статьям</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs muted">
                  <th className="py-1 pr-2 font-medium">Статья</th>
                  <th className="py-1 pr-2 text-right font-medium">План ({data.finance.planSource === "calc" ? "расчёт" : "поручение"})</th>
                  <th className="py-1 text-right font-medium">Факт (счета, ДТ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                {data.finance.rows.map((r) => {
                  const fact = r.fact.find((f) => f.currency === r.plan?.currency);
                  const over = r.plan?.amount != null && fact && fact.amount > r.plan.amount;
                  return (
                    <tr key={r.category}>
                      <td className="py-1.5 pr-2">{r.label}</td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {r.plan ? (r.plan.amount !== null ? formatMoney(r.plan.amount, r.plan.currency) : <span className="text-xs muted">подтверждаемый</span>) : <span className="muted">—</span>}
                      </td>
                      <td className={`whitespace-nowrap py-1.5 text-right tabular-nums ${over ? "text-amber-700 dark:text-amber-400" : ""}`} title={over ? "Факт больше плана — по п. 3.4 договора клиент доплачивает разницу" : undefined}>
                        {money(r.fact)}
                      </td>
                    </tr>
                  );
                })}
                {data.finance.clientInvoices.length > 0 && (
                  <tr>
                    <td className="py-1.5 pr-2 font-medium">Выставлено клиенту</td>
                    <td />
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{money(data.finance.clientInvoices)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

type Part = { fact: Money[]; plan: { amount: number | null; currency: string } | null } | undefined;

/** Сумма статьи: факт (счета, ДТ), иначе план (расчёт / поручение) — в рублях по курсу ЦБ. */
function partRub(p: Part, rates: Record<string, number>): number | null {
  if (!p) return null;
  const list = p.fact.length ? p.fact.map((m) => ({ amount: m.amount, currency: m.currency })) : p.plan?.amount != null ? [{ amount: p.plan.amount, currency: p.plan.currency }] : [];
  if (!list.length) return null;
  return list.reduce((s, m) => s + m.amount * (m.currency === "RUB" ? 1 : (rates[m.currency] ?? 0)), 0);
}

/**
 * Итоги сделки в долларах и рублях — как в КП: товар; доставка и таможня (перевозка, комиссия за перевод,
 * таможенные платежи, брокер, СВХ, вознаграждение, доставка до склада); товар вместе с доставкой и таможней.
 */
function Totals({ rows, lastMile }: { rows: FinanceRow[]; lastMile: number | null }) {
  const { data } = useQuery({ queryKey: ["cbr-rates"], queryFn: () => api<{ date: string; rates: Record<string, number> }>("/cbr-rates"), staleTime: 60 * 60_000 });
  if (!data) return null;
  const r: Record<string, number> = { RUB: 1, ...data.rates };
  const goods = partRub(rows.find((x) => x.category === "goods"), r);
  const services = rows.filter((x) => x.category !== "goods").map((x) => partRub(x, r));
  const delivery = services.some((v) => v !== null) || lastMile ? services.reduce<number>((s, v) => s + (v ?? 0), 0) + (lastMile ?? 0) : null;
  if (goods === null && delivery === null) return null;
  const both = (rub: number, strong = false) => (
    <span className="tabular-nums">
      <span className={strong ? "font-semibold" : ""}>{formatMoney(rub / (r.USD || 1), "USD")}</span>
      <span className="muted"> · {formatMoney(rub, "RUB")}</span>
    </span>
  );
  const lines: [string, number | null, boolean][] = [
    ["Товар", goods, false],
    ["Доставка и таможня (всё, кроме товара)", delivery, false],
    ["Товар + доставка и таможня", goods !== null || delivery !== null ? (goods ?? 0) + (delivery ?? 0) : null, true],
  ];
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-neutral-800/40">
      {lines
        .filter(([, v]) => v !== null)
        .map(([label, v, strong]) => (
          <div key={label} className={`flex flex-wrap items-baseline justify-between gap-x-3 py-0.5 ${strong ? "mt-1 border-t border-slate-200 pt-1.5 font-medium dark:border-neutral-700" : ""}`}>
            <span>{label}</span>
            {both(v!, strong)}
          </div>
        ))}
      <div className="mt-1 text-[11px] muted">
        по курсу ЦБ на {formatDay(data.date)}: 1 USD = {r.USD?.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽
        {r.CNY ? `, 1 CNY = ${r.CNY.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽` : ""}; оплаченное и выставленное — по счетам и ДТ, остальное — по плану
      </div>
    </div>
  );
}

const FILE_LABELS: Record<string, string> = { original: "файл", signed: "подписанный", generated: "сформирован", payment: "платёжка" };

/**
 * Документ сделки карточкой: что за документ и от кого, сумма и оплата, и каждый файл отдельно — оригинал,
 * подписанный скан, каждая платёжка (депозит, остаток, мелкие доплаты) со своей датой.
 */
function DocCard({ doc: d, onProof }: { doc: DealDocument; onProof: (f: File) => void }) {
  const payable = d.paymentStatus !== null;
  const own = d.files.filter((f) => f.label !== "payment");
  const payments = d.files.filter((f) => f.label === "payment");
  return (
    <li className="rounded-md border border-slate-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <Link to={`/documents/${d.id}`} className="font-medium hover:underline">
            {docTypeLabel(d.type)} № {d.number ?? "б/н"}
          </Link>
          {d.date && <span className="muted"> от {formatDay(d.date)}</span>}
          {d.counterpartyName && <div className="truncate text-xs muted">{d.counterpartyName}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {d.type === "commission_order" && (
            <>
              <a className="btn btn-sm" href={`${BASE}/api/documents/${d.id}/docx`}>
                <IconFile size={12} /> DOCX
              </a>
              <Link className="btn btn-sm" to={`/documents/${d.id}/edit`}>
                Смета
              </Link>
            </>
          )}
          {d.amount !== null && <span className="font-semibold tabular-nums">{formatMoney(d.amount, d.currency)}</span>}
          <PaymentChip status={d.paymentStatus} paid={d.paidAmount} amount={d.amount} currency={d.currency} />
          <StatusChip status={d.status === "draft" ? null : d.status} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {own.map((f) => (
          <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 hover:border-blue-400 dark:border-neutral-700" title={f.filename}>
            <IconFile size={12} />
            <span className="muted">{FILE_LABELS[f.label ?? "original"] ?? "файл"}:</span>
            <span className="truncate">{f.filename}</span>
          </a>
        ))}
        {own.length === 0 && (
          <Link to={`/documents/${d.id}`} className="rounded border border-amber-300 px-1.5 py-0.5 text-amber-800 dark:border-amber-800 dark:text-amber-300">
            без файла — загрузить
          </Link>
        )}
        {payments.map((f, i) => (
          <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-sky-900 hover:border-sky-400 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" title={f.filename}>
            💳 платёжка{payments.length > 1 ? ` ${i + 1}` : ""} · {formatDay(f.createdAt.slice(0, 10))}
            <span className="truncate muted">{f.filename}</span>
          </a>
        ))}
        {payable && (
          <label className="cursor-pointer rounded border border-dashed border-slate-300 px-1.5 py-0.5 link dark:border-neutral-700" title="Платёжка / SWIFT: депозит, остаток, доплата — можно несколько">
            + платёжка
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onProof(f);
              }}
            />
          </label>
        )}
      </div>
    </li>
  );
}
