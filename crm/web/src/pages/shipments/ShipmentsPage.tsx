/** Сделки (отгрузки): доска по этапам и таблица, создание новой. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { FLAGS, type FlagKey, MILESTONES, SHIPMENT_STAGES, stageSpec } from "../../../../shared/shipments.ts";
import { Avatar } from "../../components/crm/common.tsx";
import { IconBoard, IconCalendar, IconList, IconPlus, IconSearch } from "../../components/Icons.tsx";
import { CalendarView } from "./CalendarPage.tsx";
import { DueLabel, ShipmentStage, StageBar } from "../../components/shipments/common.tsx";
import { emptyForm, formPayload, ShipmentForm, type ShipmentFormState } from "../../components/shipments/ShipmentForm.tsx";
import { ConfirmDialog, EmptyState, ErrorBox, Modal, Spinner } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import type { Shipment } from "../../lib/types.ts";

type Counts = { status: string; stage: number; n: number }[];
type View = "board" | "table" | "calendar";

function readView(): View {
  try {
    const v = localStorage.getItem("crm.shipments.view");
    return v === "table" || v === "calendar" ? v : "board";
  } catch {
    return "board";
  }
}

function CreateShipmentDialog({ initial, onClose }: { initial: Partial<ShipmentFormState>; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ShipmentFormState>(() => ({ ...emptyForm(), ...initial }));
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await formPayload(form);
      const milestones: Record<string, { plan?: string; fact?: string }> = { ...((payload.milestones as Record<string, { fact?: string }>) ?? {}) };
      for (const [k, v] of Object.entries(plans)) if (v) milestones[k] = { ...milestones[k], plan: v };
      const { shipment } = await api<{ shipment: Shipment }>("/shipments", { method: "POST", body: { ...payload, milestones } });
      void queryClient.invalidateQueries({ queryKey: ["shipments"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      if (form.deal) void queryClient.invalidateQueries({ queryKey: ["deal"] });
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
          <button type="button" className="btn btn-primary" disabled={busy || !form.title.trim()} onClick={() => void submit()}>
            Создать
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs muted">Сделка начинается, когда сформирован заказ: инвойс поставщика → поручение клиенту → депозит. Документы, товары, ТН ВЭД и деньги — в карточке.</p>
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

function PendingFlags({ s }: { s: Shipment }) {
  if (s.status !== "active" || s.pendingFlags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {s.pendingFlags.map((f) => (
        <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {FLAGS[f as FlagKey].label}
        </span>
      ))}
    </div>
  );
}

function nextLabel(s: Shipment): string | undefined {
  return MILESTONES.find((m) => m.key === stageSpec(s.stage).milestone)?.label;
}

function Card({ s }: { s: Shipment }) {
  return (
    <Link
      to={`/shipments/${s.number}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(s.number))}
      className="block space-y-1.5 rounded-md border border-slate-200 bg-white p-2.5 text-sm shadow-sm hover:border-accent/50 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-medium leading-snug">{s.title || <span className="muted">без названия</span>}</span>
        {s.assignee && <Avatar name={s.assignee.name} />}
      </div>
      <div className="truncate text-xs muted">{s.client?.name ?? "клиент не указан"}</div>
      <div className="font-mono text-xs">{s.containerNo ?? <span className="font-sans text-amber-700 dark:text-amber-400">без контейнера</span>}</div>
      {s.stage < SHIPMENT_STAGES.length ? (
        <div className="text-xs">
          <span className="muted">{nextLabel(s)}: </span>
          <DueLabel date={s.nextDate} />
        </div>
      ) : (
        <div className="text-xs text-green-700 dark:text-green-400">Доставлено — можно закрывать</div>
      )}
      <PendingFlags s={s} />
    </Link>
  );
}

function Board({ rows }: { rows: Shipment[] }) {
  const queryClient = useQueryClient();
  const [over, setOver] = useState<number | null>(null);
  const [back, setBack] = useState<{ s: Shipment; stage: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (v: { number: number; stage: number }) => api(`/shipments/${v.number}/stage`, { method: "POST", body: { stage: v.stage } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shipments"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const onDrop = (e: DragEvent, stage: number) => {
    e.preventDefault();
    setOver(null);
    const s = rows.find((r) => String(r.number) === e.dataTransfer.getData("text/plain"));
    if (!s || s.stage === stage) return;
    setError(null);
    if (stage < s.stage) setBack({ s, stage });
    else move.mutate({ number: s.number, stage });
  };
  // Внутри колонки — сначала самые срочные.
  const sorted = [...rows].sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.number - b.number);
  return (
    <>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8">
        {SHIPMENT_STAGES.map((st) => {
          const list = sorted.filter((s) => s.stage === st.no);
          return (
            <div
              key={st.no}
              className={`flex w-64 shrink-0 flex-col rounded-lg bg-slate-100 p-2 dark:bg-neutral-800/50 ${over === st.no ? "ring-2 ring-accent" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(st.no);
              }}
              onDragLeave={() => setOver((o) => (o === st.no ? null : o))}
              onDrop={(e) => onDrop(e, st.no)}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: st.color }} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={st.name}>
                  {st.no}. {st.name}
                </span>
                <span className="text-xs muted">{list.length}</span>
              </div>
              <div className="min-h-16 flex-1 space-y-2">
                {list.map((s) => (
                  <Card key={s.id} s={s} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs muted">
        Перетащите карточку на следующий этап — фактические даты пройденных этапов проставятся сегодняшним числом. Точнее даты — в карточке сделки.
      </p>
      {back && (
        <ConfirmDialog
          title="Вернуть на прошлый этап?"
          confirmLabel="Вернуть"
          danger={false}
          message={`«${back.s.title}» вернётся на этап «${stageSpec(back.stage).name}»: фактические даты этого и следующих этапов будут сняты.`}
          onClose={() => setBack(null)}
          onConfirm={() => move.mutateAsync({ number: back.s.number, stage: back.stage })}
        />
      )}
    </>
  );
}

function Table({ rows, status }: { rows: Shipment[]; status: string }) {
  const navigate = useNavigate();
  // Сначала самые срочные: просроченные и ближайшие даты, без даты — в конце.
  const sorted = [...rows].sort((a, b) =>
    status === "active" ? (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.number - b.number : b.number - a.number,
  );
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
            <th className="px-3 py-2 font-medium">Груз</th>
            <th className="px-3 py-2 font-medium">Клиент</th>
            <th className="px-3 py-2 font-medium">Перевозчик</th>
            <th className="px-3 py-2 font-medium">Этап</th>
            <th className="px-3 py-2 font-medium">Ближайшая дата</th>
            <th className="px-3 py-2 font-medium">Ждём</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
          {sorted.map((s) => (
            <tr key={s.id} className="cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-neutral-800/50" onClick={() => navigate(`/shipments/${s.number}`)}>
              <td className="px-3 py-2">
                <Link to={`/shipments/${s.number}`} onClick={(e) => e.stopPropagation()} className="font-medium">
                  {s.title || "без названия"}
                </Link>
                <div className="text-xs">
                  <span className="muted">{s.label}</span>{" "}
                  {s.containerNo ? <span className="font-mono">{s.containerNo}</span> : <span className="text-amber-700 dark:text-amber-400">без контейнера</span>}
                </div>
              </td>
              <td className="px-3 py-2">{s.client?.name ?? "—"}</td>
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
                      <div className="text-xs">{nextLabel(s)}</div>
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
                <PendingFlags s={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShipmentsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view");
  const [view, setViewState] = useState<View>(() => (viewParam === "calendar" || viewParam === "table" || viewParam === "board" ? viewParam : readView()));
  const status = view === "board" ? "active" : (params.get("status") ?? "active");
  const stage = view === "board" ? "" : (params.get("stage") ?? "");
  const mine = params.get("mine") === "1";
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");

  const { data, isLoading, error } = useQuery({
    queryKey: ["shipments", "list", status, stage, mine, q.trim()],
    queryFn: () =>
      api<{ shipments: Shipment[]; counts: Counts }>(
        `/shipments?status=${status}${stage ? `&stage=${stage}` : ""}${mine ? "&assignee=me" : ""}&q=${encodeURIComponent(q.trim())}`,
      ),
    placeholderData: (prev) => prev,
  });
  const count = (st: string, sg?: number) => data?.counts.filter((c) => c.status === st && (sg === undefined || c.stage === sg)).reduce((a, c) => a + c.n, 0) ?? 0;
  const setFilter = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const setView = (v: View) => {
    setViewState(v);
    if (params.get("view")) setFilter({ view: "" });
    try {
      localStorage.setItem("crm.shipments.view", v);
    } catch {
      /* без сохранения */
    }
  };

  // Предзаполнение из лида воронки («Создать сделку»).
  const fromDeal: Partial<ShipmentFormState> = {};
  if (params.get("deal")) fromDeal.deal = { id: Number(params.get("deal")), key: params.get("dealKey") ?? "", title: params.get("dealTitle") ?? "" };
  if (params.get("clientId")) fromDeal.client = { id: Number(params.get("clientId")), name: params.get("clientName") ?? "" };
  if (params.get("title")) fromDeal.title = params.get("title")!;

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
      active ? "border-accent bg-accent-soft text-accent dark:bg-accent/20 dark:text-accent-bright" : "border-slate-200 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
    }`;
  const tab = (v: View, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm ${view === v ? "bg-accent text-white" : "hover:bg-slate-100 dark:hover:bg-neutral-800"}`}
    >
      {icon}
      {label}
    </button>
  );
  const rows = data?.shipments ?? [];

  return (
    <div className={`mx-auto w-full ${view === "board" ? "max-w-none" : "max-w-6xl"} px-4 py-6 sm:px-8`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="page-title">Сделки</h1>
          <p className="text-sm muted">От сформированного заказа до доставки. Этап меняется сам, когда отмечаете, что случилось.</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-neutral-700">
          {tab("board", "Доска", <IconBoard size={14} />)}
          {tab("table", "Список", <IconList size={14} />)}
          {tab("calendar", "Календарь", <IconCalendar size={14} />)}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={14} /> Новая сделка
        </button>
      </div>
      {view === "calendar" && <CalendarView />}
      <div className={`mb-3 flex flex-wrap items-center gap-2 ${view === "calendar" ? "hidden" : ""}`}>
        <label className="relative block w-full max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" className="input pl-8" placeholder="Груз, контейнер, клиент, ТН ВЭД" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className={chip(mine)} onClick={() => setFilter({ mine: mine ? "" : "1" })} title={user?.name}>
          Мои
        </button>
        {view === "table" && (
          <>
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
          </>
        )}
        {view === "board" && (count("closed") > 0 || count("cancelled") > 0) && (
          <button type="button" className="text-xs link" onClick={() => { setView("table"); setFilter({ status: "closed", stage: "" }); }}>
            закрытые и отменённые — в списке
          </button>
        )}
      </div>
      {isLoading && view !== "calendar" && <Spinner />}
      {view !== "calendar" && <ErrorBox error={error} />}
      {data && rows.length === 0 && view === "table" && (
        <EmptyState title={q || stage || status !== "active" ? "Ничего не найдено" : "Сделок в работе нет"}>Создайте сделку, когда клиент оплатил депозит.</EmptyState>
      )}
      {data && view === "board" && <Board rows={rows} />}
      {data && view === "table" && rows.length > 0 && <Table rows={rows} status={status} />}
      {creating && (
        <CreateShipmentDialog
          initial={fromDeal}
          onClose={() => {
            setCreating(false);
            if (params.get("new")) setFilter({ new: "", deal: "", dealKey: "", dealTitle: "", clientId: "", clientName: "", title: "" });
          }}
        />
      )}
    </div>
  );
}
