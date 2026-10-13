/** Карточка сделки: этапы, ключевые даты (план / факт), флажки, стороны, история. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { formatMoney } from "../../../../shared/documents.ts";
import { FLAGS, type FlagKey, MILESTONES, SHIPMENT_STAGES, stageSpec, TRANSPORTS } from "../../../../shared/shipments.ts";
import { PaymentChip, counterpartyPath, formatDay } from "../../components/docs/common.tsx";
import { DueLabel, ShipmentStage, today, useShipmentActions } from "../../components/shipments/common.tsx";
import { formFromShipment, formPayload, ShipmentForm } from "../../components/shipments/ShipmentForm.tsx";
import { IconCheck, IconPencil } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatDateTime } from "../../lib/format.ts";
import type { Shipment, ShipmentEvent } from "../../lib/types.ts";

const FIELD_LABELS: Record<string, string> = {
  clientId: "Клиент",
  supplierId: "Поставщик",
  carrierId: "Перевозчик",
  carrierInvoiceId: "Инвойс перевозчика",
  dealId: "Лид из воронки",
  containerNo: "Номер контейнера",
  cargo: "Груз",
  transport: "Транспорт",
  route: "Маршрут",
  depositDate: "Депозит оплачен",
  notes: "Заметки",
};

const STATUS_LABELS: Record<string, string> = { active: "в работе", closed: "закрыта", cancelled: "отменена" };

const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? formatDay(x) : String(x));

function eventText(e: ShipmentEvent): string {
  const m = MILESTONES.find((x) => x.key === e.field)?.label ?? e.field;
  switch (e.kind) {
    case "created":
      return "создал сделку";
    case "plan":
      return `${m}: план ${v(e.oldValue)} → ${v(e.newValue)}`;
    case "fact":
      return e.newValue ? `${m}: выполнено ${v(e.newValue)}` : `${m}: снял отметку о выполнении`;
    case "stage":
      return `этап → ${stageSpec(Number(e.newValue)).no}. ${stageSpec(Number(e.newValue)).name}`;
    case "flag":
      return `${FLAGS[e.field as FlagKey]?.label ?? e.field}: ${e.newValue ? "готово" : "снял отметку"}`;
    case "status":
      return `статус: ${STATUS_LABELS[String(e.newValue)] ?? e.newValue}`;
    case "field":
      return e.field === "notes" ? "изменил заметки" : `${FIELD_LABELS[e.field ?? ""] ?? e.field}: ${v(e.oldValue)} → ${v(e.newValue)}`;
    default:
      return e.kind;
  }
}

/** Горизонтальная лента 7 этапов. */
function Stepper({ stage, status }: { stage: number; status: string }) {
  return (
    <ol className="mb-5 grid grid-cols-7 gap-1">
      {SHIPMENT_STAGES.map((s) => {
        const done = s.no < stage || (s.no === stage && stage === SHIPMENT_STAGES.length);
        const current = s.no === stage && status === "active";
        return (
          <li key={s.no} className="min-w-0">
            <div className={`h-1.5 rounded-full ${s.no <= stage ? "" : "bg-slate-200 dark:bg-neutral-700"}`} style={s.no <= stage ? { background: s.color } : undefined} />
            <div className={`mt-1 truncate text-[11px] ${current ? "font-semibold" : done ? "" : "muted"}`} title={s.name}>
              {s.no}. {s.name}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MilestonesTable({ shipment }: { shipment: Shipment }) {
  const { milestone } = useShipmentActions();
  const [shift, setShift] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const readOnly = shipment.status !== "active";
  const save = async (key: string, body: { plan?: string | null; fact?: string | null; shift?: boolean }) => {
    setError(null);
    setNote(null);
    try {
      const r = await milestone.mutateAsync({ number: shipment.number, key, ...body });
      if (r.shifted) setNote(`Следующие даты сдвинуты: ${r.shifted}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const currentKey = stageSpec(shipment.stage).milestone;
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Ключевые даты</h2>
        {!readOnly && (
          <label className="flex items-center gap-2 text-xs muted">
            <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
            При переносе плана сдвигать следующие даты
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs muted">
              <th className="px-4 py-2 font-medium">Этап · дата</th>
              <th className="px-2 py-2 font-medium">План</th>
              <th className="px-2 py-2 font-medium">Факт</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
            {MILESTONES.map((m) => {
              const d = shipment.milestones[m.key] ?? { plan: null, fact: null };
              const isCurrent = m.key === currentKey && shipment.status === "active";
              return (
                <tr key={m.key} className={isCurrent ? "bg-accent-soft/50 dark:bg-accent/10" : ""}>
                  <td className="px-4 py-2">
                    <div className={`flex items-center gap-2 ${m.optional ? "pl-4 text-xs" : ""}`}>
                      {!m.optional && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stageSpec(m.stage).color }} />}
                      <span className={isCurrent ? "font-medium" : ""}>{m.label}</span>
                    </div>
                    <div className="pl-4">
                      {m.optional && !d.plan && !d.fact && <span className="text-[11px] muted">необязательная отметка</span>}
                      {!d.fact && d.plan && !readOnly && <DueLabel date={d.plan} />}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      className="input w-36 py-1"
                      disabled={readOnly || milestone.isPending}
                      defaultValue={d.plan ?? ""}
                      key={`p-${d.plan}`}
                      onBlur={(e) => {
                        const value = e.target.value || null;
                        if (value !== d.plan) void save(m.key, { plan: value, shift });
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      className="input w-36 py-1"
                      disabled={readOnly || milestone.isPending}
                      defaultValue={d.fact ?? ""}
                      key={`f-${d.fact}`}
                      onBlur={(e) => {
                        const value = e.target.value || null;
                        if (value !== d.fact) void save(m.key, { fact: value });
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {d.fact ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                        <IconCheck size={14} /> выполнено
                      </span>
                    ) : !readOnly && m.stage === shipment.stage ? (
                      <button type="button" className="btn btn-sm" disabled={milestone.isPending} title="Факт — сегодня" onClick={() => void save(m.key, { fact: today() })}>
                        Выполнено
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(error || note) && <p className={`px-4 pb-3 text-sm ${error ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{error ?? note}</p>}
    </section>
  );
}

function FlagsPanel({ shipment }: { shipment: Shipment }) {
  const { flag } = useShipmentActions();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel p-4">
      <h2 className="mb-2 text-sm font-semibold">Ожидания</h2>
      <div className="space-y-3">
        {SHIPMENT_STAGES.filter((s) => s.flags.length).map((s) => (
          <div key={s.no}>
            <div className="mb-1 text-xs muted">
              {s.no}. {s.name} · срок — дата «{MILESTONES.find((m) => m.key === s.milestone)?.label}»
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {s.flags.map((key) => {
                const done = Boolean(shipment.flags[key]);
                const due = shipment.milestones[s.milestone!]?.plan ?? null;
                const late = !done && shipment.stage >= s.no && due !== null && due < today();
                return (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={shipment.status !== "active" || flag.isPending}
                      onChange={(e) =>
                        void flag.mutateAsync({ number: shipment.number, key, done: e.target.checked }).catch((err) => setError(errorMessage(err)))
                      }
                    />
                    <span className={late ? "text-red-600 dark:text-red-400" : ""}>{FLAGS[key].label}</span>
                    {done && <span className="text-xs muted">{formatDay(shipment.flags[key])}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <dt className="text-xs muted">{label}</dt>
      <dd className="text-sm">{children || <span className="muted">—</span>}</dd>
    </div>
  );
}

function Details({ shipment }: { shipment: Shipment }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => formFromShipment(shipment));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = shipment;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shipments/${s.number}`, { method: "PATCH", body: await formPayload(form) });
      await queryClient.invalidateQueries({ queryKey: ["shipment", s.number] });
      void queryClient.invalidateQueries({ queryKey: ["shipments"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <section className="panel p-4">
        <ShipmentForm value={form} onChange={setForm} />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => setEditing(false)}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Сделка</h2>
        <button
          type="button"
          className="icon-btn"
          title="Изменить"
          onClick={() => {
            setForm(formFromShipment(shipment));
            setEditing(true);
          }}
        >
          <IconPencil size={14} />
        </button>
      </div>
      <dl className="divide-y divide-slate-100 dark:divide-neutral-800">
        <Info label="Клиент">{s.client && <Link to={counterpartyPath("client", s.client.id)} className="link">{s.client.name}</Link>}</Info>
        <Info label="Груз">{s.cargo}</Info>
        <Info label="Номер контейнера">
          {s.containerNo ? <span className="font-mono">{s.containerNo}</span> : <span className="text-amber-700 dark:text-amber-400">не указан</span>}
        </Info>
        <Info label="Поставщик">{s.supplier && <Link to={counterpartyPath("supplier", s.supplier.id)} className="link">{s.supplier.name}</Link>}</Info>
        <Info label="Перевозчик">{s.carrier && <Link to={counterpartyPath("contractor", s.carrier.id)} className="link">{s.carrier.name}</Link>}</Info>
        <Info label="Инвойс перевозчика">
          {s.carrierInvoice && (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Link to={`/documents/${s.carrierInvoice.id}`} className="link">
                № {s.carrierInvoice.number ?? "б/н"}
                {s.carrierInvoice.date && ` от ${formatDay(s.carrierInvoice.date)}`}
              </Link>
              {s.carrierInvoice.amount !== null && <span className="text-xs">{formatMoney(s.carrierInvoice.amount, s.carrierInvoice.currency)}</span>}
              <PaymentChip status={s.carrierInvoice.paymentStatus} />
            </span>
          )}
        </Info>
        <Info label="Транспорт · маршрут">{[s.transport && TRANSPORTS[s.transport as keyof typeof TRANSPORTS], s.route].filter(Boolean).join(" · ")}</Info>
        <Info label="Депозит оплачен">{formatDay(s.depositDate)}</Info>
        <Info label="Лид из воронки">
          {s.deal && (
            <Link to={`/deals/${s.deal.key}`} className="link">
              <span className="font-mono text-xs">{s.deal.key}</span> {s.deal.title}
            </Link>
          )}
        </Info>
        {s.notes && <Info label="Заметки"><span className="whitespace-pre-wrap">{s.notes}</span></Info>}
      </dl>
    </section>
  );
}

function History({ shipment, events }: { shipment: Shipment; events: ShipmentEvent[] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/shipments/${shipment.number}/comments`, { method: "POST", body: { body: text } }),
    onSuccess: () => {
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["shipment", shipment.number] });
    },
  });
  return (
    <section className="panel p-4">
      <h2 className="mb-2 text-sm font-semibold">Комментарии и история</h2>
      <div className="mb-3 flex gap-2">
        <textarea className="input min-h-[38px]" rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Комментарий: «поставщик задерживает на неделю»" />
        <button type="button" className="btn shrink-0" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>
          Добавить
        </button>
      </div>
      <ul className="space-y-1.5 text-sm">
        {events.map((e) => (
          <li key={e.id} className={e.kind === "comment" ? "rounded-md bg-slate-50 p-2 dark:bg-neutral-800/60" : "text-xs"}>
            <span className="muted">
              {formatDateTime(e.createdAt)} · {e.userName ?? "система"}
              {e.kind === "comment" ? ":" : " —"}
            </span>{" "}
            {e.kind === "comment" ? <span className="whitespace-pre-wrap">{String(e.newValue)}</span> : eventText(e)}
          </li>
        ))}
      </ul>
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
  const { data, isLoading, error } = useQuery({
    queryKey: ["shipment", n],
    queryFn: () => api<{ shipment: Shipment; events: ShipmentEvent[] }>(`/shipments/${n}`),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/shipments/${n}/status`, { method: "POST", body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shipment", n] });
      void queryClient.invalidateQueries({ queryKey: ["shipments"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
  if (isLoading) return <Content><Spinner /></Content>;
  if (!data) return <Content><ErrorBox error={error} /></Content>;
  const s = data.shipment;

  return (
    <Content wide>
      <div className="mb-2 text-sm">
        <Link to="/shipments" className="link">
          Сделки
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {s.label}
            {s.containerNo && <span className="font-mono text-base font-normal">{s.containerNo}</span>}
            <ShipmentStage shipment={s} />
          </span>
        }
        meta={[s.client?.name, s.cargo].filter(Boolean).join(" · ")}
        actions={
          s.status === "active" ? (
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
          )
        }
      />
      <Stepper stage={s.stage} status={s.status} />
      {s.status === "active" && s.stage === SHIPMENT_STAGES.length && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
          Груз доставлен. Проверьте оплаты и закройте сделку.
        </p>
      )}
      {s.status === "active" && s.pendingFlags.length > 0 && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Ждём: {s.pendingFlags.map((f) => FLAGS[f as FlagKey].label.toLowerCase()).join(", ")}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <MilestonesTable shipment={s} />
          <FlagsPanel shipment={s} />
          <History shipment={s} events={data.events} />
        </div>
        <div className="min-w-0">
          <Details key={s.updatedAt} shipment={s} />
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
          message={`Сделка ${s.label} и её история будут удалены безвозвратно.`}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api(`/shipments/${n}`, { method: "DELETE" });
            queryClient.removeQueries({ queryKey: ["shipment", n] });
            void queryClient.invalidateQueries({ queryKey: ["shipments"] });
            navigate("/shipments");
          }}
        />
      )}
    </Content>
  );
}

