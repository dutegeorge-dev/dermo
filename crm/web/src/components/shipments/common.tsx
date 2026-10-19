/** Сделки (отгрузки): плашки этапов, даты, действия с ключевыми датами. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { addDays, daysBetween, FLAGS, type FlagKey, LAST_STAGE, milestoneSpec, SHIPMENT_STAGES, stageSpec } from "../../../../shared/shipments.ts";
import { api, errorMessage } from "../../lib/api.ts";
import type { CalendarEvent, Shipment } from "../../lib/types.ts";
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
 * Окно действия над событием: выполнено / перенести (со сдвигом следующих дат)
 * / снять отметку. Для флажка «перенести» двигает дату его ключевой точки.
 */
export function EventDialog({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { milestone, flag } = useShipmentActions();
  const [factDate, setFactDate] = useState(today());
  const [planDate, setPlanDate] = useState(event.date && !event.done ? event.date : addDays(today(), 1));
  const [shift, setShift] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sh = event.shipment;
  const anchor = event.milestone ? milestoneSpec(event.milestone) : undefined;
  const busy = milestone.isPending || flag.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const markDone = () =>
    run(() =>
      event.kind === "flag"
        ? flag.mutateAsync({ number: sh.number, key: event.key, done: true })
        : milestone.mutateAsync({ number: sh.number, key: event.key, fact: factDate }),
    );
  const undo = () =>
    run(() =>
      event.kind === "flag"
        ? flag.mutateAsync({ number: sh.number, key: event.key, done: false })
        : milestone.mutateAsync({ number: sh.number, key: event.key, fact: null }),
    );
  const move = () => run(() => milestone.mutateAsync({ number: sh.number, key: event.milestone!, plan: planDate, shift }));

  return (
    <Modal title={event.title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-md bg-slate-50 p-3 dark:bg-neutral-800/60">
          <Link to={`/shipments/${sh.number}`} className="link font-medium">
            {sh.title}
          </Link>
          <span className="ml-2 text-xs muted">{sh.label}</span>
          {sh.containerNo ? <span className="ml-2 font-mono text-xs">{sh.containerNo}</span> : <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">контейнер не указан</span>}
          <div className="mt-1 text-xs muted">{[sh.client, sh.carrier].filter(Boolean).join(" · ")}</div>
          <div className="mt-2">
            <ShipmentStage shipment={{ stage: sh.stage, status: "active" }} />
          </div>
        </div>

        {event.done ? (
          <div className="flex items-center justify-between gap-2">
            <span>
              Выполнено {event.kind === "milestone" ? formatDay(event.date) : `(отмечено ${formatDay(event.date)})`}
            </span>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void undo()}>
              Снять отметку
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className="mb-1 text-xs muted">Плановая дата: {event.date ? <DueLabel date={event.date} /> : "не задана"}</div>
              {event.kind === "milestone" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="label">Фактическая дата</span>
                    <input type="date" className="input w-40" value={factDate} onChange={(e) => setFactDate(e.target.value)} />
                  </label>
                  <button type="button" className="btn btn-primary" disabled={busy || !factDate} onClick={() => void markDone()}>
                    Выполнено
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void markDone()}>
                  {FLAGS[event.key as FlagKey]?.payment ? "Оплачено" : "Готово"}
                </button>
              )}
            </div>
            {event.milestone && (
              <div className="border-t border-slate-200 pt-3 dark:border-neutral-800">
                <div className="mb-1 font-medium">Перенести</div>
                {event.kind === "flag" && anchor && <p className="mb-2 text-xs muted">Срок привязан к дате «{anchor.label}» — она и сдвинется.</p>}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="label">Новая плановая дата</span>
                    <input type="date" className="input w-40" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
                  </label>
                  <button type="button" className="btn" disabled={busy || !planDate || planDate === event.date} onClick={() => void move()}>
                    Перенести
                  </button>
                </div>
                {event.date && (
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
                    Сдвинуть следующие даты этой сделки на столько же
                    {planDate && event.date && planDate !== event.date && (
                      <span className="muted">
                        ({daysBetween(event.date, planDate) > 0 ? "+" : ""}
                        {daysBetween(event.date, planDate)} дн.)
                      </span>
                    )}
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
