/** Общие элементы документов: название, статусы, таблица реестра. */

import { Link } from "react-router";

import { COUNTERPARTY_ROLES, DOC_STATUSES, docSpec, formatMoney, PAYMENT_STATUSES } from "../../../../shared/documents.ts";
import type { CounterpartyRole, DocumentRow } from "../../lib/types.ts";

export const docTypeLabel = (type: string) => docSpec(type)?.label ?? type;

export function docTitle(d: { type: string; number: string | null; date: string | null }): string {
  return [docTypeLabel(d.type), d.number && `№ ${d.number}`, d.date && `от ${formatDay(d.date)}`].filter(Boolean).join(" ");
}

export function formatDay(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function counterpartyPath(role: CounterpartyRole | null | undefined, id: number): string {
  return `/${COUNTERPARTY_ROLES[role ?? "client"].path}/${id}`;
}

const chip = "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap";

export function PaymentChip({ status, paid, amount, currency }: { status: string | null; paid?: number | null; amount?: number | null; currency?: string | null }) {
  if (!status) return null;
  const cls =
    status === "paid"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : status === "partial"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  const title = status === "partial" && paid != null ? `Оплачено ${formatMoney(paid, currency)} из ${formatMoney(amount ?? null, currency)}` : undefined;
  return (
    <span className={`${chip} ${cls}`} title={title}>
      {PAYMENT_STATUSES[status as keyof typeof PAYMENT_STATUSES] ?? status}
    </span>
  );
}

export function StatusChip({ status }: { status: string | null }) {
  if (!status) return null;
  const cls =
    status === "signed"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : status === "cancelled"
        ? "bg-slate-200 text-slate-600 line-through dark:bg-neutral-700 dark:text-neutral-400"
        : "bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300";
  return <span className={`${chip} ${cls}`}>{DOC_STATUSES[status as keyof typeof DOC_STATUSES] ?? status}</span>;
}

export function ValidityChip({ validUntil }: { validUntil: string | null }) {
  if (!validUntil) return null;
  const days = Math.round((Date.parse(validUntil) - Date.now()) / 86_400_000);
  if (days > 30) return <span className="text-xs muted">до {formatDay(validUntil)}</span>;
  const cls = days < 0 ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return <span className={`${chip} ${cls}`}>{days < 0 ? `истёк ${formatDay(validUntil)}` : `до ${formatDay(validUntil)}`}</span>;
}

/** Таблица документов. hide — какие колонки не показывать (например, сторону в карточке контрагента). */
export function DocumentsTable({ rows, hide = [] }: { rows: DocumentRow[]; hide?: ("party" | "client" | "deal")[] }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm muted">Документов нет</p>;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
            <th className="px-3 py-2 font-medium">Документ</th>
            {!hide.includes("party") && <th className="px-3 py-2 font-medium">Сторона</th>}
            {!hide.includes("client") && <th className="px-3 py-2 font-medium">Клиент</th>}
            {!hide.includes("deal") && <th className="px-3 py-2 font-medium">Сделка</th>}
            <th className="px-3 py-2 text-right font-medium">Сумма</th>
            <th className="px-3 py-2 font-medium">Статус</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
          {rows.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/50">
              <td className="px-3 py-2">
                <Link to={`/documents/${d.id}`} className="hover:underline">
                  {docTitle(d)}
                </Link>
                {d.parentNumber && <div className="text-xs muted">к {docTypeLabel(d.parentType ?? "").toLowerCase()} № {d.parentNumber}</div>}
              </td>
              {!hide.includes("party") && (
                <td className="px-3 py-2">
                  {d.counterpartyId ? (
                    <Link to={counterpartyPath(d.counterpartyRole, d.counterpartyId)} className="hover:underline">{d.counterpartyName}</Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              )}
              {!hide.includes("client") && (
                <td className="px-3 py-2">
                  {d.clientId ? <Link to={`/clients/${d.clientId}`} className="hover:underline">{d.clientName}</Link> : <span className="muted">—</span>}
                </td>
              )}
              {!hide.includes("deal") && (
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {d.dealKey ? <Link to={`/deals/${d.dealKey}`} className="link">{d.dealKey}</Link> : <span className="muted">—</span>}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{d.amount !== null ? formatMoney(d.amount, d.currency) : ""}</td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap items-center gap-1">
                  <StatusChip status={d.status} />
                  <PaymentChip status={d.paymentStatus} paid={d.paidAmount} amount={d.amount} currency={d.currency} />
                  <ValidityChip validUntil={d.validUntil} />
                  {d.fileCount === 0 && <span className="text-[11px] muted" title="Файл не прикреплён">без файла</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
