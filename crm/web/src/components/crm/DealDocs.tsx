/** Блок сделки «Стороны и документы»: схема, поставщик, подрядчики, договоры, документы, поручение, план/факт. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { CLIENT_CONTRACT_BY_SCHEME, CONTRACTOR_TYPES, DOC_GROUPS, type DocGroup, docSpec, formatMoney, SCHEMES } from "../../../../shared/documents.ts";
import { api, BASE } from "../../lib/api.ts";
import type { DealResponse, DocumentRow, Money } from "../../lib/types.ts";
import { docTitle, PaymentChip, StatusChip } from "../docs/common.tsx";
import { IconFile, IconPlus, IconX } from "../Icons.tsx";
import { ErrorBox } from "../ui.tsx";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "./CounterpartyPicker.tsx";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Save = (patch: Record<string, unknown>) => Promise<void>;

function money(list: Money[]) {
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
    <div className="grid items-center gap-1 sm:grid-cols-[150px_1fr] sm:gap-3">
      <span className="text-xs muted">{label}</span>
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

export function DealDocs({ data, save, run }: { data: DealResponse; save: Save; run: Run }) {
  const navigate = useNavigate();
  const { deal } = data;
  const [addingParty, setAddingParty] = useState(false);
  const [party, setParty] = useState<Picked | null>(null);
  const [supplierEdit, setSupplierEdit] = useState(false);
  const [supplier, setSupplier] = useState<Picked | null>(null);
  const [orderError, setOrderError] = useState<unknown>(null);

  const contractIds = new Set([deal.clientContractId, deal.supplierContractId]);
  const docs = data.documents.filter((d) => !contractIds.has(d.id));
  const byGroup = new Map<DocGroup, typeof docs>();
  for (const d of docs) {
    const g = (docSpec(d.type)?.group ?? "other") as DocGroup;
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const order = data.documents.find((d) => d.id === data.finance.orderId);
  const newDoc = (type: string) => `/documents/new?type=${type}&deal=${deal.key}`;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-xs font-semibold uppercase tracking-wide muted">Стороны и документы</h3>
        <select className="input w-auto py-1 text-sm" value={deal.scheme} onChange={(e) => void save({ scheme: e.target.value })} aria-label="Схема">
          {Object.entries(SCHEMES).map(([k, l]) => <option key={k} value={k}>Схема: {l}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <div className="grid items-center gap-1 sm:grid-cols-[150px_1fr] sm:gap-3">
          <span className="text-xs muted">Поставщик</span>
          {supplierEdit ? (
            <span className="flex gap-2">
              <span className="flex-1"><CounterpartyPicker role="supplier" value={supplier} onChange={setSupplier} autoFocus /></span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const id = await ensureCounterparty(supplier, "supplier");
                  await save({ supplierId: id });
                  setSupplierEdit(false);
                }}
              >
                OK
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSupplierEdit(false)}>Отмена</button>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm">
              {deal.supplierId ? <Link to={`/suppliers/${deal.supplierId}`} className="link">{deal.supplierName}</Link> : <span className="muted">не указан</span>}
              <button type="button" className="text-xs link" onClick={() => { setSupplier(deal.supplierId ? { id: deal.supplierId, name: deal.supplierName ?? "" } : null); setSupplierEdit(true); }}>
                {deal.supplierId ? "изменить" : "указать"}
              </button>
            </span>
          )}
        </div>
        <ContractSelect
          label={`Договор с клиентом`}
          value={deal.clientContractId}
          type={CLIENT_CONTRACT_BY_SCHEME[deal.scheme]}
          counterpartyId={deal.clientId}
          save={save}
          field="clientContractId"
        />
        <ContractSelect label="Контракт с поставщиком" value={deal.supplierContractId} type="supplier_contract" counterpartyId={deal.supplierId} save={save} field="supplierContractId" />
        <div className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-3">
          <span className="pt-1 text-xs muted">Подрядчики</span>
          <div className="text-sm">
            {data.parties.map((p) => (
              <span key={p.id} className="mb-1 mr-1 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">
                <Link to={`/contractors/${p.id}`} className="hover:underline">{p.name}</Link>
                <span className="text-xs muted">{CONTRACTOR_TYPES[p.contractorType as keyof typeof CONTRACTOR_TYPES] ?? ""}</span>
                <button type="button" aria-label={`Убрать ${p.name}`} className="text-slate-400 hover:text-red-600" onClick={() => void run(() => api(`/deals/${deal.key}/parties/${p.id}`, { method: "DELETE" }))}>
                  <IconX size={10} />
                </button>
              </span>
            ))}
            {addingParty ? (
              <span className="mt-1 flex gap-2">
                <span className="flex-1"><CounterpartyPicker role="contractor" value={party} onChange={setParty} autoFocus /></span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    const id = await ensureCounterparty(party, "contractor");
                    if (id) await run(() => api(`/deals/${deal.key}/parties`, { method: "POST", body: { counterpartyId: id } }));
                    setAddingParty(false);
                    setParty(null);
                  }}
                >
                  OK
                </button>
              </span>
            ) : (
              <button type="button" className="text-xs link" onClick={() => setAddingParty(true)}>+ подрядчик</button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-neutral-800">
        {order ? (
          <>
            <Link to={`/documents/${order.id}`} className="link text-sm font-medium">Поручение № {order.number}</Link>
            <StatusChip status={order.status} />
            <a className="btn btn-sm" href={`${BASE}/api/documents/${order.id}/docx`}><IconFile size={12} /> DOCX</a>
            <Link className="btn btn-sm" to={`/documents/${order.id}/edit`}>Смета</Link>
          </>
        ) : (
          deal.scheme === "commission" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                setOrderError(null);
                try {
                  const res = await api<{ document: { id: number } }>(`/deals/${deal.key}/order`, { method: "POST" });
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
        <Link to={newDoc("other")} className="btn btn-sm"><IconPlus size={12} /> Документ</Link>
      </div>
      {orderError != null && <ErrorBox error={orderError} />}

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
                      {d.fileCount === 0 && <span className="text-[11px] muted">без файла</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {(data.finance.rows.length > 0 || data.finance.clientInvoices.length > 0) && (
        <div className="border-t border-slate-200 pt-3 dark:border-neutral-800">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">План / факт</p>
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
