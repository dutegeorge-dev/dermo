/**
 * Оплата на несколько счетов: одна платёжка → разнесение по инвойсам / счетам (в том числе инвойсу другой
 * сделки — остатку, уехавшему следующим контейнером) и, если что-то не разнесено, — пометка, что это.
 * Обычная оплата одного счёта сюда не идёт — она, как раньше, статусом оплаты счёта.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import { shipmentLabel } from "../../../../shared/shipments.ts";
import { api, fileUrl } from "../../lib/api.ts";
import type { DocumentRow, ShipmentPayment, ShipmentResponse } from "../../lib/types.ts";
import { docTitle, docTypeLabel, formatDay } from "../docs/common.tsx";
import { parseNumber } from "../docs/paste.ts";
import { IconPlus, IconX } from "../Icons.tsx";
import { ConfirmDialog, ErrorBox, Modal } from "../ui.tsx";

export type Allocation = { documentId: number | null; amount: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Сколько по счёту ещё не оплачено. */
export function unpaidOf(d: Pick<DocumentRow, "amount" | "paymentStatus" | "paidAmount">): number {
  if (d.amount === null) return 0;
  if (d.paymentStatus === "paid") return 0;
  return r2(d.amount - (d.paymentStatus === "partial" ? (d.paidAmount ?? 0) : 0));
}

/** Счета, на которые можно разнести оплату (тот же запрос, что и в форме платёжки). */
export function usePayables(enabled = true) {
  return useQuery({
    queryKey: ["documents", "payables"],
    queryFn: () => api<{ documents: DocumentRow[] }>("/documents?type=supplier_invoice,contractor_invoice,client_invoice,customs_declaration&limit=300"),
    enabled,
  });
}

/**
 * Разнести автоматически: неоплаченные счета получателя в валюте платежа — сначала этой сделки, потом
 * остальных, по дате; каждому — его остаток, пока хватает суммы.
 */
export function autoAllocate(amount: number, currency: string, payables: DocumentRow[], opts: { payeeId: number | null; shipmentNumber?: number | null }): Allocation[] {
  const list = payables
    .filter((d) => unpaidOf(d) > 0 && (!d.currency || d.currency === currency) && (opts.payeeId === null || d.counterpartyId === opts.payeeId))
    .sort((a, b) => {
      const own = (d: DocumentRow) => (opts.shipmentNumber && d.shipmentNumber === opts.shipmentNumber ? 0 : 1);
      return own(a) - own(b) || (a.date ?? "").localeCompare(b.date ?? "") || a.id - b.id;
    });
  const out: Allocation[] = [];
  let left = r2(amount);
  for (const d of list) {
    if (left <= 0) break;
    const part = Math.min(left, unpaidOf(d));
    out.push({ documentId: d.id, amount: String(part) });
    left = r2(left - part);
  }
  return out;
}

const option = (d: DocumentRow) =>
  [
    docTitle(d),
    d.counterpartyName,
    d.amount !== null ? formatMoney(d.amount, d.currency) : null,
    d.paymentStatus === "partial" ? `не оплачено ${formatMoney(unpaidOf(d), d.currency)}` : d.paymentStatus === "paid" ? "оплачен" : null,
    d.shipmentNumber ? shipmentLabel(d.shipmentNumber) : null,
  ]
    .filter(Boolean)
    .join(" · ");

/** Разнесение суммы платежа по счетам. */
export function PaymentAllocator({
  amount,
  currency,
  payables,
  value,
  onChange,
  payeeId,
  shipmentNumber,
  note,
  onNote,
}: {
  amount: number | null;
  currency: string;
  payables: DocumentRow[];
  value: Allocation[];
  onChange: (v: Allocation[]) => void;
  payeeId: number | null;
  shipmentNumber?: number | null;
  note: string;
  onNote: (s: string) => void;
}) {
  const set = (i: number, patch: Partial<Allocation>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const allocated = r2(value.reduce((s, a) => s + (parseNumber(a.amount) ?? 0), 0));
  const left = amount === null ? null : r2(amount - allocated);
  // В списке — счета получателя (если выбран) в валюте платежа; уже выбранные — всегда.
  const chosen = new Set(value.map((a) => a.documentId));
  const options = payables.filter((d) => chosen.has(d.id) || ((!d.currency || d.currency === currency) && (payeeId === null || d.counterpartyId === payeeId)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium muted">Какие счета оплачены</span>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" disabled={!amount} onClick={() => onChange(autoAllocate(amount!, currency, payables, { payeeId, shipmentNumber }))}>
          Разнести автоматически
        </button>
      </div>
      {value.map((a, i) => {
        return (
          <div key={i} className="flex items-start gap-2">
            <select className="input min-w-0 flex-1" value={a.documentId ?? ""} onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const d = payables.find((x) => x.id === id);
              // Сумма по умолчанию — остаток счёта, но не больше не разнесённого.
              const rest = left === null ? null : r2(left + (parseNumber(a.amount) ?? 0));
              set(i, { documentId: id, amount: a.amount || (d ? String(rest === null ? unpaidOf(d) : Math.max(0, Math.min(unpaidOf(d), rest))) : "") });
            }}>
              <option value="">— счёт —</option>
              {options.map((d) => (
                <option key={d.id} value={d.id}>{option(d)}</option>
              ))}
            </select>
            <input className="input w-32 tabular-nums" inputMode="decimal" placeholder="сумма" value={a.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            <button type="button" className="icon-btn mt-1" aria-label="Убрать счёт" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <IconX size={14} />
            </button>
          </div>
        );
      })}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...value, { documentId: null, amount: "" }])}>
        <IconPlus size={12} /> Счёт
      </button>
      {amount !== null && (
        <p className={`text-xs ${left !== null && left < -0.005 ? "text-red-700 dark:text-red-400" : "muted"}`}>
          Разнесено {formatMoney(allocated, currency)} из {formatMoney(amount, currency)}
          {left !== null && Math.abs(left) > 0.005 && (left > 0 ? ` · не разнесено ${formatMoney(left, currency)}` : ` · больше платежа на ${formatMoney(-left, currency)}`)}
        </p>
      )}
      {(left ?? 0) > 0.005 && (
        <label className="block">
          <span className="label">Что это за остаток (для пояснения таможне)</span>
          <input className="input" value={note} placeholder="Аванс за товар следующей поставки" onChange={(e) => onNote(e.target.value)} />
        </label>
      )}
    </div>
  );
}

/** Сохранить оплату на несколько счетов и прикрепить к ней файл. */
export async function savePayment(input: { shipment?: number | null; number: string; date: string; amount: number; currency: string; note: string; allocations: Allocation[] }, file: File | null) {
  const allocations = input.allocations.filter((a) => a.documentId && (parseNumber(a.amount) ?? 0) > 0).map((a) => ({ documentId: a.documentId!, amount: parseNumber(a.amount)! }));
  const { payment } = await api<{ payment: { id: number } }>("/payments", { method: "POST", body: { ...input, allocations } });
  if (file) {
    const form = new FormData();
    form.append("file", file);
    await api(`/payments/${payment.id}/files`, { method: "POST", form });
  }
  return payment.id;
}

/** Окно в сделке: «+ оплата на несколько счетов». */
export function PaymentDialog({ data, onClose }: { data: ShipmentResponse; onClose: () => void }) {
  const queryClient = useQueryClient();
  const sh = data.shipment;
  const payables = usePayables();
  const invoices = data.documents.filter((d) => d.paymentStatus !== null);
  const payees = [...new Map(invoices.filter((d) => d.counterpartyId).map((d) => [d.counterpartyId!, d.counterpartyName ?? `#${d.counterpartyId}`])).entries()];
  const [payeeId, setPayeeId] = useState<number | null>(sh.supplierId ?? payees[0]?.[0] ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(invoices.find((d) => d.counterpartyId === payeeId)?.currency ?? "USD");
  const [note, setNote] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const total = parseNumber(amount);
  return (
    <Modal
      wide
      title="Оплата на несколько счетов"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !total || !allocations.some((a) => a.documentId)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await savePayment({ shipment: sh.number, number, date, amount: total!, currency, note, allocations }, file);
                await queryClient.invalidateQueries();
                onClose();
              } catch (e) {
                setError(e);
                setBusy(false);
              }
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs muted">
          Когда одна платёжка оплачивает несколько инвойсов (или часть инвойса уехала другим контейнером). Если платёжка за один счёт — просто «+ платёжка» у счёта.
        </p>
        <label className="block">
          <span className="label">Файл платёжки / SWIFT</span>
          <input type="file" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block">
            <span className="label">№ платёжки</span>
            <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Дата</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Сумма</span>
            <input className="input tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Валюта</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {payees.length > 1 && (
          <label className="block">
            <span className="label">Кому</span>
            <select className="input" value={payeeId ?? ""} onChange={(e) => setPayeeId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— все —</option>
              {payees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        <PaymentAllocator
          amount={total}
          currency={currency}
          payables={payables.data?.documents ?? []}
          value={allocations}
          onChange={setAllocations}
          payeeId={payeeId}
          shipmentNumber={sh.number}
          note={note}
          onNote={setNote}
        />
        {error != null && <ErrorBox error={error} />}
      </div>
    </Modal>
  );
}

/** «Оплаты по сделке» — только когда есть оплаты на несколько счетов. */
export function PaymentsSection({ data }: { data: ShipmentResponse }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<ShipmentPayment | null>(null);
  const sh = data.shipment;
  if (!data.payments.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide muted">Оплаты на несколько счетов</p>
      <ul className="space-y-2 text-sm">
        {data.payments.map((p) => (
          <li key={p.id} className="rounded-md border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <div className="min-w-0 flex-1">
                <span className="font-medium">💳 Платёжка {p.number ? `№ ${p.number}` : "б/н"}</span>
                <span className="muted"> от {formatDay(p.date)}</span>
                {p.counterpartyName && <div className="truncate text-xs muted">{p.counterpartyName}</div>}
                {p.shipmentNumber && p.shipmentNumber !== sh.number && (
                  <div className="text-xs muted">
                    из сделки <Link className="link" to={`/shipments/${p.shipmentNumber}`}>{shipmentLabel(p.shipmentNumber)}</Link>
                  </div>
                )}
              </div>
              <span className="font-semibold tabular-nums">{formatMoney(p.amount, p.currency)}</span>
              <button type="button" className="icon-btn" aria-label="Удалить оплату" onClick={() => setRemoving(p)}>
                <IconX size={14} />
              </button>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {p.allocations.map((a) => (
                <li key={a.documentId} className="flex flex-wrap gap-x-2">
                  <Link to={`/documents/${a.documentId}`} className="link">
                    {docTypeLabel(a.type)} № {a.number ?? "б/н"}
                  </Link>
                  {a.date && <span className="muted">от {formatDay(a.date)}</span>}
                  <span className="tabular-nums">— {formatMoney(a.amount, p.currency)}</span>
                  {a.shipmentNumber !== sh.number && a.shipmentNumber && (
                    <span className="rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      сделка <Link to={`/shipments/${a.shipmentNumber}`} className="underline">{shipmentLabel(a.shipmentNumber)}</Link>
                    </span>
                  )}
                </li>
              ))}
              {p.unallocated > 0.005 && (
                <li className="text-amber-800 dark:text-amber-300">
                  не разнесено {formatMoney(p.unallocated, p.currency)}
                  {p.note ? ` — ${p.note}` : ""}
                </li>
              )}
              {p.unallocated <= 0.005 && p.note && <li className="muted">{p.note}</li>}
            </ul>
            {p.files.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {p.files.map((f) => (
                  <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 rounded border border-sky-200 px-1.5 py-0.5 hover:border-sky-400 dark:border-sky-900" title={f.filename}>
                    <span className="truncate">{f.filename}</span>
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.paymentNotes.length > 0 && (
        <details className="mt-2 rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
          <summary className="cursor-pointer font-medium text-amber-900 dark:text-amber-300">Пояснение по оплатам для таможни (войдёт в пакет документов)</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{data.paymentNotes.join("\n")}</pre>
        </details>
      )}
      {removing && (
        <ConfirmDialog
          title="Удалить оплату?"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/payments/${removing.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries();
          }}
          message={`Платёжка ${removing.number ? `№ ${removing.number}` : "б/н"} на ${formatMoney(removing.amount, removing.currency)}. Счета, оплаченные ею, снова станут неоплаченными (или частично — по другим оплатам).`}
        />
      )}
    </div>
  );
}
