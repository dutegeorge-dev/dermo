/** Сделки (отгрузки): плашки этапов, даты, действия с ключевыми датами. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";

import { daysBetween, FLAGS, type FlagKey, LAST_STAGE, MILESTONES, SHIPMENT_STAGES, stageSpec } from "../../../../shared/shipments.ts";
import { api } from "../../lib/api.ts";
import type { CalendarEvent, Shipment, ShipmentResponse } from "../../lib/types.ts";
import { StageChip } from "../crm/common.tsx";
import { formatDay } from "../docs/common.tsx";
import { Modal } from "../ui.tsx";

/** Сегодня по местному времени, YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** «сегодня», «завтра», «через 5 дн.», «просрочено на 2 дн.» */
export function relativeDay(date: string | null): string {
  if (!date) return "без даты";
  const n = daysBetween(today(), date);
  if (n === 0) return "сегодня";
  if (n === 1) return "завтра";
  if (n === -1) return "вчера";
  return n > 0 ? `через ${n} дн.` : `${-n} дн. назад`;
}

export function ShipmentStage({ shipment, className = "" }: { shipment: Pick<Shipment, "stage" | "status">; className?: string }) {
  if (shipment.status === "closed") return <span className={`text-xs font-medium text-green-700 dark:text-green-400 ${className}`}>Закрыта</span>;
  if (shipment.status === "cancelled") return <span className={`text-xs muted line-through ${className}`}>Отменена</span>;
  const st = stageSpec(shipment.stage);
  return (
    <StageChip stage={st} className={className}>
      {st.no}. {st.name}
    </StageChip>
  );
}

/** Полоска из 7 сегментов: пройденные этапы закрашены. */
export function StageBar({ stage }: { stage: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`Этап ${stage} из ${LAST_STAGE}: ${stageSpec(stage).name}`}>
      {SHIPMENT_STAGES.map((s) => (
        <span
          key={s.no}
          className={`h-1.5 w-3 rounded-sm ${s.no > stage ? "bg-slate-200 dark:bg-neutral-700" : ""}`}
          style={s.no <= stage ? { background: stageSpec(stage).color } : undefined}
        />
      ))}
    </span>
  );
}

export function DueLabel({ date, done = false }: { date: string | null; done?: boolean }) {
  if (done) return <span className="text-xs text-green-700 dark:text-green-400">{formatDay(date)}</span>;
  if (!date) return <span className="text-xs text-amber-700 dark:text-amber-400">нет даты</span>;
  const overdue = date < today();
  return (
    <span className={`whitespace-nowrap text-xs ${overdue ? "font-medium text-red-600 dark:text-red-400" : "muted"}`} title={formatDay(date)}>
      {formatDay(date)} · {overdue ? `просрочено ${daysBetween(date, today())} дн.` : relativeDay(date)}
    </span>
  );
}

/** Мутации ключевых дат и флажков с обновлением списков, карточки и календаря. */
export function useShipmentActions() {
  const queryClient = useQueryClient();
  const refresh = (number: number) => {
    void queryClient.invalidateQueries({ queryKey: ["shipments"] });
    void queryClient.invalidateQueries({ queryKey: ["shipment", number] });
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };
  const milestone = useMutation({
    mutationFn: (v: { number: number; key: string; plan?: string | null; fact?: string | null; shift?: boolean }) => {
      const { number, key, ...rest } = v;
      return api<{ shipment: Shipment; shifted: number }>(`/shipments/${number}/milestones/${key}`, { method: "PUT", body: rest });
    },
    onSuccess: (_, v) => refresh(v.number),
  });
  const flag = useMutation({
    mutationFn: (v: { number: number; key: string; done: boolean; date?: string }) =>
      api<{ shipment: Shipment }>(`/shipments/${v.number}/flags/${v.key}`, { method: "PUT", body: { done: v.done, date: v.date } }),
    onSuccess: (_, v) => refresh(v.number),
  });
  return { milestone, flag, refresh };
}

/**
 * Событие календаря — краткая сводка по сделке, без правки дат (из календаря нажимали случайно — владелец
 * попросил только смотреть). Отметить и перенести — в карточке сделки.
 */
export function EventDialog({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const sh = event.shipment;
  const q = useQuery({ queryKey: ["shipment", sh.number], queryFn: () => api<ShipmentResponse>(`/shipments/${sh.number}`) });
  const full = q.data?.shipment;
  const missing = useQuery({
    queryKey: ["customs-pack", sh.number],
    queryFn: () => api<{ missing: string[] }>(`/shipments/${sh.number}/customs-pack`),
    enabled: sh.stage >= 4 && sh.stage <= 6,
  });
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex gap-2">
        <span className="w-28 shrink-0 muted">{label}</span>
        <span className="min-w-0">{value}</span>
      </div>
    ) : null;
  return (
    <Modal
      title={event.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Закрыть</button>
          <Link to={`/shipments/${sh.number}`} className="btn btn-primary">Открыть сделку</Link>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-md bg-slate-50 p-3 dark:bg-neutral-800/60">
          <span className="font-medium">{sh.title}</span>
          <span className="ml-2 text-xs muted">{sh.label}</span>
          {sh.containerNo ? <span className="ml-2 font-mono text-xs">{sh.containerNo}</span> : <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">контейнер не указан</span>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ShipmentStage shipment={{ stage: sh.stage, status: "active" }} />
            <span className="text-xs">
              {event.done ? "✓ " : ""}
              {event.title}: {event.date ? <DueLabel date={event.date} done={event.done} /> : "дата не задана"}
            </span>
          </div>
        </div>
        {q.isLoading && <p className="text-xs muted">Загрузка…</p>}
        {full && (
          <div className="space-y-1">
            {row("Клиент", full.client?.name)}
            {row("Поставщик", full.supplier?.name)}
            {row("Перевозчик", full.carrier?.name)}
            {row("Маршрут", [full.pickupLocation, full.deliveryLocation].filter(Boolean).join(" → "))}
            {row("Груз", [full.weightKg ? `${full.weightKg.toLocaleString("ru-RU")} кг` : null, full.volumeM3 ? `${full.volumeM3.toLocaleString("ru-RU")} м³` : null].filter(Boolean).join(" / "))}
          </div>
        )}
        {full && (
          <div>
            <div className="mb-1 text-xs font-semibold muted">Даты</div>
            <ul className="space-y-0.5 text-xs">
              {MILESTONES.filter((m) => !m.optional || full.milestones[m.key]?.fact || full.milestones[m.key]?.plan).map((m) => {
                const d = full.milestones[m.key] ?? { plan: null, fact: null };
                return (
                  <li key={m.key} className="flex gap-2">
                    <span className={`w-36 shrink-0 ${d.fact ? "muted" : ""}`}>{m.label}</span>
                    {d.fact ? <span className="text-green-700 dark:text-green-400">✓ {formatDay(d.fact)}</span> : d.plan ? <DueLabel date={d.plan} /> : <span className="muted">—</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {full && full.pendingFlags.length > 0 && (
          <p className="text-xs text-amber-800 dark:text-amber-400">Не отмечено: {full.pendingFlags.map((k) => FLAGS[k as FlagKey]?.label.toLowerCase() ?? k).join(", ")}</p>
        )}
        {missing.data && missing.data.missing.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold text-amber-800 dark:text-amber-400">Для таможни не хватает</div>
            <ul className="list-disc pl-5 text-amber-800 dark:text-amber-400">
              {missing.data.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
