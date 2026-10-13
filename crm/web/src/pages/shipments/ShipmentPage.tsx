/**
 * Карточка сделки — вся информация в одном месте: деньги, товары с ТН ВЭД и
 * ценами, сертификаты на эти товары, документы (договоры, инвойсы, поручение,
 * СМГС, ДТ), ключевые даты, ожидания, стороны и поля груза, история.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { formatMoney } from "../../../../shared/documents.ts";
import { formatDay, ValidityChip } from "../../components/docs/common.tsx";
import { IconCheck } from "../../components/Icons.tsx";
import { ShipmentStage } from "../../components/shipments/common.tsx";
import { FinanceBlock, ShipmentDocs } from "../../components/shipments/ShipmentDocs.tsx";
import { ShipmentFields } from "../../components/shipments/ShipmentFields.tsx";
import { History, Stepper } from "../../components/shipments/ShipmentParts.tsx";
import { StageTimeline } from "../../components/shipments/StageTimeline.tsx";
import { ConfirmDialog, ErrorBox, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import type { ShipmentResponse } from "../../lib/types.ts";

function TitleInput({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label="Название груза"
      className="w-full min-w-0 rounded border-0 bg-transparent p-0 text-xl font-semibold tracking-tight outline-none focus:bg-slate-50 focus:ring-0 dark:focus:bg-neutral-800"
      value={draft}
      placeholder="Название груза"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== value) void onSave(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

/** Товары сделки (из инвойса поставщика) и сертификаты на них. */
function GoodsBlock({ data }: { data: ShipmentResponse }) {
  const totals = new Map<string, number>();
  for (const i of data.items) if (i.amount !== null) totals.set(i.currency ?? "", (totals.get(i.currency ?? "") ?? 0) + i.amount);
  const hs = [...new Set(data.items.map((i) => i.hsCode).filter(Boolean))];
  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-semibold">Товары</h2>
        {hs.length > 0 && <span className="text-xs muted">ТН ВЭД: <span className="font-mono">{hs.join(", ")}</span></span>}
      </div>
      {data.items.length === 0 ? (
        <p className="text-sm muted">Появятся из инвойса поставщика.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs muted">
                <th className="py-1 pr-2 font-medium">Наименование</th>
                <th className="py-1 pr-2 font-medium">ТН ВЭД</th>
                <th className="py-1 pr-2 text-right font-medium">Кол-во</th>
                <th className="py-1 pr-2 text-right font-medium">Цена</th>
                <th className="py-1 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {data.items.map((i, idx) => (
                <tr key={idx}>
                  <td className="py-1.5 pr-2">
                    {i.productId ? <Link to={`/products/${i.productId}`} className="hover:underline">{i.name}</Link> : i.name}
                    {i.productName && i.productName !== i.name && <span className="ml-1 text-xs muted">({i.productName})</span>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 font-mono text-xs">{i.hsCode ?? ""}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {i.quantity?.toLocaleString("ru-RU") ?? ""} {i.unit && <span className="text-xs muted">{i.unit}</span>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{i.price !== null ? formatMoney(i.price, i.currency) : ""}</td>
                  <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{i.amount !== null ? formatMoney(i.amount, i.currency) : ""}</td>
                </tr>
              ))}
            </tbody>
            {totals.size > 0 && (
              <tfoot>
                <tr className="border-t border-slate-300 font-medium dark:border-neutral-700">
                  <td className="py-1.5" colSpan={4}>
                    Стоимость партии
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                    {[...totals].map(([c, v]) => <span key={c} className="block">{formatMoney(v, c)}</span>)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-neutral-800">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide muted">Декларации соответствия / сертификаты</p>
          <Link to={`/documents/new?type=conformity&shipment=${data.shipment.number}`} className="text-xs link">+ добавить</Link>
        </div>
        {data.certificates.length === 0 ? (
          <p className="text-sm muted">Нет. Сертификат, выданный на товар, появится во всех сделках с этим товаром.</p>
        ) : (
          <ul className="divide-line text-sm">
            {data.certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                <Link to={`/documents/${c.id}`} className="link">{c.number ?? "без номера"}</Link>
                {c.products.length > 0 && <span className="text-xs muted">{c.products.join(", ")}</span>}
                <span className="flex-1" />
                {c.date && <span className="text-xs muted">от {formatDay(c.date)}</span>}
                <ValidityChip validUntil={c.validUntil} />
                {c.fileCount === 0 && <span className="text-[11px] text-amber-700 dark:text-amber-400">без файла</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ShipmentPage() {
  const { number } = useParams();
  const n = Number(number);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [confirm, setConfirm] = useState<"cancelled" | "delete" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["shipment", n],
    queryFn: () => api<ShipmentResponse>(`/shipments/${n}`),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["shipment", n] });
    void queryClient.invalidateQueries({ queryKey: ["shipments"] });
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
    await refresh();
  };
  const save = (patch: Record<string, unknown>) => run(() => api(`/shipments/${n}`, { method: "PATCH", body: patch }));
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/shipments/${n}/status`, { method: "POST", body: { status } }),
    onSuccess: refresh,
  });
  if (isLoading) return <div className="px-6 py-6"><Spinner /></div>;
  if (!data) return <div className="px-6 py-6"><ErrorBox error={loadError} /></div>;
  const s = data.shipment;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8">
      <div className="mb-2 text-sm">
        <Link to="/shipments" className="link">
          Сделки
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <TitleInput value={s.title} onSave={(title) => save({ title })} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <ShipmentStage shipment={s} />
            <span className="muted">{s.label}</span>
            {s.containerNo ? <span className="font-mono">{s.containerNo}</span> : <span className="text-amber-700 dark:text-amber-400">контейнер не указан</span>}
            {s.client && <Link to={`/clients/${s.client.id}`} className="link">{s.client.name}</Link>}
            {s.hsCode && <span className="text-xs muted">ТН ВЭД <span className="font-mono">{s.hsCode}</span></span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {s.status === "active" ? (
            <>
              <button type="button" className="btn" disabled={setStatus.isPending} onClick={() => setConfirm("cancelled")}>
                Отменить
              </button>
              <button type="button" className="btn btn-primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate("closed")}>
                <IconCheck size={14} /> Закрыть сделку
              </button>
            </>
          ) : (
            <>
              {user?.role === "admin" && (
                <button type="button" className="btn btn-ghost text-red-600" onClick={() => setConfirm("delete")}>
                  Удалить
                </button>
              )}
              <button type="button" className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate("active")}>
                Вернуть в работу
              </button>
            </>
          )}
        </div>
      </div>
      <Stepper stage={s.stage} status={s.status} />
      <ErrorBox error={error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <StageTimeline data={data} saveField={save} />
          <FinanceBlock data={data} />
          <GoodsBlock data={data} />
          <ShipmentDocs data={data} />
          <History shipment={s} events={data.events} />
        </div>
        <div className="min-w-0">
          <ShipmentFields data={data} save={save} run={run} />
        </div>
      </div>
      {confirm === "cancelled" && (
        <ConfirmDialog
          title="Отменить сделку?"
          confirmLabel="Отменить сделку"
          danger={false}
          message="Сделка уйдёт из календаря. Вернуть её в работу можно в любой момент."
          onClose={() => setConfirm(null)}
          onConfirm={() => setStatus.mutateAsync("cancelled")}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="Удалить сделку?"
          message={`Сделка «${s.title}» и её история будут удалены безвозвратно. Документы останутся в реестре без привязки.`}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api(`/shipments/${n}`, { method: "DELETE" });
            queryClient.removeQueries({ queryKey: ["shipment", n] });
            void queryClient.invalidateQueries({ queryKey: ["shipments"] });
            navigate("/shipments");
          }}
        />
      )}
    </div>
  );
}
