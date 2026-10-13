/** Части карточки сделки: лента этапов, ключевые даты, ожидания, история. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { FLAGS, type FlagKey, MILESTONES, SHIPMENT_FIELDS, SHIPMENT_STAGES, stageSpec } from "../../../../shared/shipments.ts";
import { formatDay } from "../docs/common.tsx";
import { IconCheck } from "../Icons.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import type { Shipment, ShipmentEvent } from "../../lib/types.ts";
import { DueLabel, today, useShipmentActions } from "./common.tsx";

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
      return e.field === "notes"
        ? "изменил заметки"
        : `${SHIPMENT_FIELDS[e.field as keyof typeof SHIPMENT_FIELDS]?.label ?? e.field}: ${v(e.oldValue)} → ${v(e.newValue)}`;
    case "document_added":
      return `добавил документ: ${v(e.newValue)}`;
    case "document_removed":
      return `удалил документ: ${v(e.oldValue)}`;
    case "payment_changed":
      return `оплата — ${v(e.oldValue)}: ${v(e.newValue)}`;
    case "party_added":
      return `добавил подрядчика ${v(e.newValue)}`;
    case "party_removed":
      return `убрал подрядчика ${v(e.oldValue)}`;
    default:
      return e.kind;
  }
}

/** Горизонтальная лента 7 этапов. */
export function Stepper({ stage, status }: { stage: number; status: string }) {
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

export function MilestonesTable({ shipment }: { shipment: Shipment }) {
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

export function FlagsPanel({ shipment }: { shipment: Shipment }) {
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

export function History({ shipment, events }: { shipment: Shipment; events: ShipmentEvent[] }) {
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

