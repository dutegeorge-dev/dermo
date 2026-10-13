/** Блок сделки «Документы»: договоры, подрядчики, документы по группам, поручение, план/факт. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { CLIENT_CONTRACT_BY_SCHEME, CONTRACTOR_TYPES, DOC_GROUPS, type DocGroup, docSpec, formatMoney } from "../../../../shared/documents.ts";
import { api, BASE } from "../../lib/api.ts";
import type { DocumentRow, Money, ShipmentResponse } from "../../lib/types.ts";
import { docTitle, PaymentChip, StatusChip } from "../docs/common.tsx";
import { IconFile, IconPlus, IconX } from "../Icons.tsx";
import { ErrorBox } from "../ui.tsx";
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

export function ContractsBlock({ data, save }: { data: ShipmentResponse; save: Save }) {
  const sh = data.shipment;
  return (
    <div className="space-y-2">
      <ContractSelect label="Договор с клиентом" value={sh.clientContractId} type={CLIENT_CONTRACT_BY_SCHEME[sh.scheme]} counterpartyId={sh.clientId} save={save} field="clientContractId" />
      <ContractSelect label="Контракт с поставщиком" value={sh.supplierContractId} type="supplier_contract" counterpartyId={sh.supplierId} save={save} field="supplierContractId" />
    </div>
  );
}

export function PartiesBlock({ data, run }: { data: ShipmentResponse; run: Run }) {
  const sh = data.shipment;
  const [adding, setAdding] = useState(false);
  const [party, setParty] = useState<Picked | null>(null);
  return (
    <div className="text-sm">
      {data.parties.length === 0 && !adding && <p className="mb-1 text-xs muted">Перевозчики, брокер, СВХ — добавляются сами из их счетов.</p>}
      {data.parties.map((p) => (
        <span key={p.id} className="mb-1 mr-1 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">
          <Link to={`/contractors/${p.id}`} className="hover:underline">{p.name}</Link>
          <span className="text-xs muted">{CONTRACTOR_TYPES[p.contractorType as keyof typeof CONTRACTOR_TYPES] ?? ""}</span>
          <button type="button" aria-label={`Убрать ${p.name}`} className="text-slate-400 hover:text-red-600" onClick={() => void run(() => api(`/shipments/${sh.number}/parties/${p.id}`, { method: "DELETE" }))}>
            <IconX size={10} />
          </button>
        </span>
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
        <button type="button" className="text-xs link" onClick={() => setAdding(true)}>+ подрядчик</button>
      )}
    </div>
  );
}

export function ShipmentDocs({ data }: { data: ShipmentResponse }) {
  const navigate = useNavigate();
  const sh = data.shipment;
  const [orderError, setOrderError] = useState<unknown>(null);

  const contractIds = new Set([sh.clientContractId, sh.supplierContractId]);
  const docs = data.documents.filter((d) => !contractIds.has(d.id));
  const byGroup = new Map<DocGroup, typeof docs>();
  for (const d of docs) {
    const g = (docSpec(d.type)?.group ?? "other") as DocGroup;
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const order = data.documents.find((d) => d.id === data.finance.orderId);
  const newDoc = (type: string) => `/documents/new?type=${type}&shipment=${sh.number}`;

  return (
    <section className="panel space-y-4 p-4">
      <h2 className="text-sm font-semibold">Документы</h2>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-neutral-800">
        {order ? (
          <>
            <Link to={`/documents/${order.id}`} className="link text-sm font-medium">Поручение № {order.number}</Link>
            <StatusChip status={order.status} />
            <a className="btn btn-sm" href={`${BASE}/api/documents/${order.id}/docx`}><IconFile size={12} /> DOCX</a>
            <Link className="btn btn-sm" to={`/documents/${order.id}/edit`}>Смета</Link>
          </>
        ) : (
          sh.scheme === "commission" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                setOrderError(null);
                try {
                  const res = await api<{ document: { id: number } }>(`/shipments/${sh.number}/order`, { method: "POST" });
                  navigate(`/documents/${res.document.id}/edit`);
                } catch (e) {
                  setOrderError(e);
                }
              }}
            >
              Сформировать поручение
            </button>
          )
        )}
        <span className="flex-1" />
        <Link to={newDoc("supplier_invoice")} className="btn btn-sm"><IconPlus size={12} /> Инвойс поставщика</Link>
        <Link to={newDoc("contractor_invoice")} className="btn btn-sm"><IconPlus size={12} /> Счёт подрядчика</Link>
        <Link to={newDoc("railway_bill")} className="btn btn-sm"><IconPlus size={12} /> СМГС / накладная</Link>
        <Link to={newDoc("customs_declaration")} className="btn btn-sm"><IconPlus size={12} /> ДТ</Link>
        <Link to={newDoc("other")} className="btn btn-sm"><IconPlus size={12} /> Документ</Link>
      </div>
      {orderError != null && <ErrorBox error={orderError} />}

      {docs.length === 0 && <p className="text-sm muted">Документов пока нет. Загрузите инвойс поставщика — он сам привяжется к договору, товары попадут в справочник.</p>}
      {docs.length > 0 && (
        <div className="space-y-3">
          {(Object.keys(DOC_GROUPS) as DocGroup[])
            .filter((g) => byGroup.has(g))
            .map((g) => (
              <div key={g}>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">{DOC_GROUPS[g]}</p>
                <ul className="divide-line text-sm">
                  {byGroup.get(g)!.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                      <Link to={`/documents/${d.id}`} className="hover:underline">{docTitle(d)}</Link>
                      {d.counterpartyName && <span className="text-xs muted">{d.counterpartyName}</span>}
                      <span className="flex-1" />
                      {d.amount !== null && <span className="tabular-nums">{formatMoney(d.amount, d.currency)}</span>}
                      <PaymentChip status={d.paymentStatus} paid={d.paidAmount} amount={d.amount} currency={d.currency} />
                      <StatusChip status={d.status === "draft" ? null : d.status} />
                      {d.fileCount === 0 && <span className="text-[11px] text-amber-700 dark:text-amber-400">без файла</span>}
                    </li>
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
          <span className="muted" title="Плановая сумма из поручения">≈ {formatMoney(plan.amount, plan.currency)}</span>
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
  const other = data.finance.rows.filter((r) => !["goods", "transport", "customs"].includes(r.category)).flatMap((r) => r.fact);
  const otherSum: Money[] = [];
  for (const m of other) {
    const x = otherSum.find((o) => o.currency === m.currency);
    if (x) {
      x.amount += m.amount;
      x.paid += m.paid;
    } else otherSum.push({ ...m });
  }
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="text-sm font-semibold">Деньги</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tile("Стоимость партии", rows.goods?.fact, rows.goods?.plan, "по инвойсу поставщика")}
        {tile("Перевозка", rows.transport?.fact, rows.transport?.plan, "по счетам перевозчиков")}
        {tile("Таможенные платежи", rows.customs?.fact, rows.customs?.plan, "по ДТ")}
        {tile("Брокер, СВХ и прочее", otherSum, null, "счета подрядчиков")}
      </div>
      {(data.finance.rows.length > 0 || data.finance.clientInvoices.length > 0) && (
        <div className="border-t border-slate-200 pt-3 dark:border-neutral-800">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">План / факт по статьям</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs muted">
                  <th className="py-1 pr-2 font-medium">Статья</th>
                  <th className="py-1 pr-2 text-right font-medium">План (поручение)</th>
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
