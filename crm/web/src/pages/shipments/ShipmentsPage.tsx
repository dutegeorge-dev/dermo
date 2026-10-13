/** Сделки (отгрузки): список по этапам и создание новой. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { FLAGS, type FlagKey, MILESTONES, SHIPMENT_STAGES } from "../../../../shared/shipments.ts";
import { DueLabel, ShipmentStage, StageBar, today } from "../../components/shipments/common.tsx";
import { emptyForm, formPayload, ShipmentForm } from "../../components/shipments/ShipmentForm.tsx";
import { IconPlus, IconSearch } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Shipment } from "../../lib/types.ts";

type Counts = { status: string; stage: number; n: number }[];

function CreateShipmentDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({ ...emptyForm(), depositDate: today() }));
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await formPayload(form);
      const milestones = Object.fromEntries(Object.entries(plans).filter(([, v]) => v).map(([k, v]) => [k, { plan: v }]));
      const { shipment } = await api<{ shipment: Shipment }>("/shipments", { method: "POST", body: { ...payload, milestones } });
      void queryClient.invalidateQueries({ queryKey: ["shipments"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      navigate(`/shipments/${shipment.number}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Новая сделка"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !form.client} onClick={() => void submit()}>
            Создать
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs muted">Сделка начинается с оплаты депозита. Даты можно указать сейчас или позже в карточке.</p>
      <ShipmentForm value={form} onChange={setForm} />
      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-neutral-800">
        <div className="mb-2 text-sm font-medium">Плановые даты</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MILESTONES.filter((m) => !m.optional).map((m) => (
            <label key={m.key} className="block">
              <span className="label">{m.label}</span>
              <input type="date" className="input" value={plans[m.key] ?? ""} onChange={(e) => setPlans({ ...plans, [m.key]: e.target.value })} />
            </label>
          ))}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}

export function ShipmentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const stage = params.get("stage") ?? "";
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");

  const { data, isLoading, error } = useQuery({
    queryKey: ["shipments", "list", status, stage, q.trim()],
    queryFn: () =>
      api<{ shipments: Shipment[]; counts: Counts }>(`/shipments?status=${status}${stage ? `&stage=${stage}` : ""}&q=${encodeURIComponent(q.trim())}`),
    placeholderData: (prev) => prev,
  });
  const count = (st: string, sg?: number) => data?.counts.filter((c) => c.status === st && (sg === undefined || c.stage === sg)).reduce((a, c) => a + c.n, 0) ?? 0;
  const setFilter = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
      active ? "border-accent bg-accent-soft text-accent dark:bg-accent/20 dark:text-accent-bright" : "border-slate-200 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
    }`;

  // Сначала самые срочные: просроченные и ближайшие даты, без даты — в конце.
  const rows = [...(data?.shipments ?? [])].sort((a, b) =>
    status === "active" ? (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.number - b.number : b.number - a.number,
  );

  return (
    <Content wide>
      <PageHeader
        title="Сделки"
        meta="Начинаются с оплаты депозита. Этап меняется сам, когда вы отмечаете фактические даты."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> Новая сделка
          </button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(status === "active" && !stage)} onClick={() => setFilter({ status: "", stage: "" })}>
          В работе <span className="muted">{count("active")}</span>
        </button>
        {status === "active" &&
          SHIPMENT_STAGES.map((s) => (
            <button key={s.no} type="button" className={chip(stage === String(s.no))} onClick={() => setFilter({ stage: stage === String(s.no) ? "" : String(s.no) })}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name} <span className="muted">{count("active", s.no)}</span>
            </button>
          ))}
        <button type="button" className={chip(status === "closed")} onClick={() => setFilter({ status: "closed", stage: "" })}>
          Закрытые <span className="muted">{count("closed")}</span>
        </button>
        <button type="button" className={chip(status === "cancelled")} onClick={() => setFilter({ status: "cancelled", stage: "" })}>
          Отменённые <span className="muted">{count("cancelled")}</span>
        </button>
      </div>
      <label className="relative mb-4 block max-w-sm">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="search" className="input pl-8" placeholder="Контейнер, клиент, груз, С-012" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && rows.length === 0 && (
        <EmptyState title={q || stage || status !== "active" ? "Ничего не найдено" : "Сделок в работе нет"}>
          Создайте сделку, когда клиент оплатил депозит.
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <th className="px-3 py-2 font-medium">Сделка</th>
                <th className="px-3 py-2 font-medium">Клиент · груз</th>
                <th className="px-3 py-2 font-medium">Перевозчик</th>
                <th className="px-3 py-2 font-medium">Этап</th>
                <th className="px-3 py-2 font-medium">Ближайшая дата</th>
                <th className="px-3 py-2 font-medium">Ждём</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {rows.map((s) => (
                <tr key={s.id} className="cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-neutral-800/50" onClick={() => navigate(`/shipments/${s.number}`)}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link to={`/shipments/${s.number}`} onClick={(e) => e.stopPropagation()} className="font-medium">
                      {s.label}
                    </Link>
                    <div className="font-mono text-xs">{s.containerNo ?? <span className="font-sans text-amber-700 dark:text-amber-400">без контейнера</span>}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{s.client?.name ?? "—"}</div>
                    <div className="text-xs muted">{s.cargo}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{s.carrier?.name ?? <span className="muted">—</span>}</td>
                  <td className="px-3 py-2">
                    <ShipmentStage shipment={s} />
                    {s.status === "active" && (
                      <div className="mt-1">
                        <StageBar stage={s.stage} />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {s.status === "active" ? (
                      s.stage < SHIPMENT_STAGES.length ? (
                        <>
                          <div className="text-xs">{MILESTONES.find((m) => m.key === SHIPMENT_STAGES[s.stage - 1].milestone)?.label}</div>
                          <DueLabel date={s.nextDate} />
                        </>
                      ) : (
                        <span className="text-xs muted">Доставлено — можно закрывать</span>
                      )
                    ) : (
                      <span className="text-xs muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.status === "active" &&
                        s.pendingFlags.map((f) => (
                          <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            {FLAGS[f as FlagKey].label}
                          </span>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateShipmentDialog
          onClose={() => {
            setCreating(false);
            if (params.get("new")) setFilter({ new: "" });
          }}
        />
      )}
    </Content>
  );
}
