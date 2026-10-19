/** Части карточки сделки: лента этапов, ключевые даты, ожидания, история. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { FLAGS, type FlagKey, MILESTONES, SHIPMENT_FIELDS, SHIPMENT_STAGES, stageSpec } from "../../../../shared/shipments.ts";
import { formatDay } from "../docs/common.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import type { Shipment, ShipmentEvent } from "../../lib/types.ts";

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
    case "calc":
      return e.oldValue ? `расчёт: таможенные платежи ${v(e.oldValue)} → ${v(e.newValue)}` : `расчёт: таможенные платежи ${v(e.newValue)}`;
    case "party_removed":
      return `убрал подрядчика ${v(e.oldValue)}`;
    default:
      return e.kind;
  }
}

/** Горизонтальная лента 7 этапов. */
export function Stepper({ stage, status }: { stage: number; status: string }) {
  return (
    <ol className="mb-5 grid gap-1" style={{ gridTemplateColumns: `repeat(${SHIPMENT_STAGES.length}, minmax(0, 1fr))` }}>
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

