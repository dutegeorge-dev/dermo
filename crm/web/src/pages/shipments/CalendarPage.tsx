/**
 * Календарь сделок: что просрочено, что на этой неделе, на следующей и дальше.
 * Два вида — список по неделям и месяц (события можно перетаскивать на другой день).
 */

import { useQuery } from "@tanstack/react-query";
import { type DragEvent, useMemo, useState } from "react";
import { Link } from "react-router";

import { addDays, FLAGS, type FlagKey, milestoneSpec, stageSpec } from "../../../../shared/shipments.ts";
import { dateKey, DueLabel, EventDialog, today, useShipmentActions } from "../../components/shipments/common.tsx";
import { IconCheck, IconChevronLeft, IconChevronRight, IconSearch } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { CalendarEvent } from "../../lib/types.ts";

type View = "list" | "month";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function readView(): View {
  try {
    return localStorage.getItem("crm.calendar.view") === "month" ? "month" : "list";
  } catch {
    return "list";
  }
}

/** Понедельник недели, в которую попадает дата. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const shift = (d.getDay() + 6) % 7;
  return addDays(date, -shift);
}

function dayTitle(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  return date === today() ? `Сегодня, ${label}` : date === addDays(today(), 1) ? `Завтра, ${label}` : label;
}

/** Цвет события: оплаты — янтарный, остальное — цвет этапа ключевой даты. */
function eventColor(e: CalendarEvent): string {
  if (e.kind === "flag") return e.payment ? "#d97706" : "#64748b";
  return stageSpec(milestoneSpec(e.key)?.stage ?? 1).color;
}

function matches(e: CalendarEvent, q: string, onlyPayments: boolean): boolean {
  if (onlyPayments && !(e.kind === "flag" && e.payment)) return false;
  if (!q) return true;
  const hay = [e.shipment.label, e.shipment.containerNo, e.shipment.client, e.shipment.cargo, e.shipment.carrier, e.title].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** Событие текущего этапа сделки (или флажок, который уже пора выполнить). */
function isCurrent(e: CalendarEvent): boolean {
  const stage = e.kind === "flag" ? FLAGS[e.key as FlagKey].stage : (milestoneSpec(e.key)?.stage ?? 0);
  return e.kind === "flag" ? stage <= e.shipment.stage : stage === e.shipment.stage;
}

function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }) {
  const { milestone, flag } = useShipmentActions();
  const [error, setError] = useState<string | null>(null);
  const sh = event.shipment;
  const quickDone = async () => {
    setError(null);
    try {
      if (event.kind === "flag") await flag.mutateAsync({ number: sh.number, key: event.key, done: true });
      else await milestone.mutateAsync({ number: sh.number, key: event.key, fact: today() });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-neutral-800/50">
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: eventColor(event) }} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{event.title}</span>
          {event.kind === "flag" && event.payment && (
            <span className="rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">оплата</span>
          )}
          <DueLabel date={event.date} />
        </div>
        <div className="mt-0.5 truncate text-xs muted">
          <span className="font-medium text-slate-700 dark:text-neutral-200">{sh.label}</span>
          {sh.containerNo && <span className="ml-1.5 font-mono">{sh.containerNo}</span>}
          {[sh.client, sh.cargo, sh.carrier].filter(Boolean).map((x) => ` · ${x}`)}
        </div>
        {error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div>}
      </button>
      <button
        type="button"
        className="btn btn-sm shrink-0"
        title={event.kind === "flag" ? "Отметить выполненным" : "Выполнено сегодня"}
        disabled={milestone.isPending || flag.isPending}
        onClick={() => void quickDone()}
      >
        <IconCheck size={13} /> {event.kind === "flag" && event.payment ? "Оплачено" : "Готово"}
      </button>
    </li>
  );
}

function ListView({ events, onOpen }: { events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  const t = today();
  const thisMonday = mondayOf(t);
  const nextMonday = addDays(thisMonday, 7);
  const afterNext = addDays(thisMonday, 14);
  const monthEnd = addDays(thisMonday, 35);
  // В списке — то, чего ждём сейчас, плюс любые даты ближайших двух недель;
  // дальние даты будущих этапов видны в виде «Месяц».
  const open = events.filter((e) => !e.done && (isCurrent(e) || (e.date !== null && e.date < afterNext)));
  const sections: { key: string; title: string; hint?: string; tone?: "red" | "amber"; items: CalendarEvent[]; byDay: boolean }[] = [
    { key: "overdue", title: "Просрочено", tone: "red", items: open.filter((e) => e.date && e.date < t), byDay: false },
    { key: "nodate", title: "Нет плановой даты", hint: "Текущий этап без даты — укажите, когда ждать", tone: "amber", items: open.filter((e) => !e.date), byDay: false },
    { key: "week", title: "Эта неделя", items: open.filter((e) => e.date && e.date >= t && e.date < nextMonday), byDay: true },
    { key: "next", title: "Следующая неделя", items: open.filter((e) => e.date && e.date >= nextMonday && e.date < afterNext), byDay: true },
    { key: "month", title: "Через 2–5 недель", items: open.filter((e) => e.date && e.date >= afterNext && e.date < monthEnd), byDay: true },
    { key: "later", title: "Позже", items: open.filter((e) => e.date && e.date >= monthEnd), byDay: false },
  ];
  if (open.length === 0) return <EmptyState title="Ничего не запланировано">Все даты по сделкам в работе выполнены.</EmptyState>;
  return (
    <div className="space-y-4">
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => {
          const sorted = [...s.items].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.shipment.number - b.shipment.number);
          const days = s.byDay ? [...new Set(sorted.map((e) => e.date!))] : [null];
          return (
            <section key={s.key} className="panel overflow-hidden">
              <div
                className={`flex items-baseline justify-between border-b px-4 py-2 ${
                  s.tone === "red"
                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                    : s.tone === "amber"
                      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border-slate-200 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-800/40"
                }`}
              >
                <h2 className="text-sm font-semibold">
                  {s.title} <span className="font-normal opacity-70">· {s.items.length}</span>
                </h2>
                {s.hint && <span className="text-xs opacity-80">{s.hint}</span>}
              </div>
              {days.map((day) => (
                <div key={day ?? "all"}>
                  {day && <div className="border-b border-slate-100 px-4 pb-1 pt-2 text-xs font-medium capitalize muted dark:border-neutral-800">{dayTitle(day)}</div>}
                  <ul className="divide-y divide-slate-100 dark:divide-neutral-800">
                    {sorted
                      .filter((e) => day === null || e.date === day)
                      .map((e) => (
                        <EventRow key={e.id} event={e} onOpen={() => onOpen(e)} />
                      ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
    </div>
  );
}

function MonthView({ events, onOpen }: { events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  const { milestone } = useShipmentActions();
  const [cursor, setCursor] = useState(() => today().slice(0, 7)); // YYYY-MM
  const [shift, setShift] = useState(true);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const t = today();

  const [y, m] = cursor.split("-").map(Number);
  const first = `${cursor}-01`;
  const start = mondayOf(first);
  const lastDay = dateKey(new Date(y, m, 0));
  const end = addDays(mondayOf(lastDay), 6);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!e.date || (e.done && !showDone)) continue;
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.done) - Number(b.done) || a.shipment.number - b.shipment.number);
    return map;
  }, [events, showDone]);
  const moveMonth = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const onDrop = async (e: DragEvent, day: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const ev = events.find((x) => x.id === id);
    if (!ev || ev.done || !ev.milestone || ev.date === day) return;
    setError(null);
    try {
      await milestone.mutateAsync({ number: ev.shipment.number, key: ev.milestone, plan: day, shift });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const title = new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const noDate = events.filter((e) => !e.date && !e.done);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="icon-btn" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц">
          <IconChevronLeft />
        </button>
        <h2 className="min-w-[150px] text-center text-base font-semibold capitalize">{title}</h2>
        <button type="button" className="icon-btn" onClick={() => moveMonth(1)} aria-label="Следующий месяц">
          <IconChevronRight />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setCursor(t.slice(0, 7))}>
          Сегодня
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs muted">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Выполненные
        </label>
        <label className="flex items-center gap-2 text-xs muted">
          <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
          Перетаскивание сдвигает и следующие даты сделки
        </label>
      </div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="panel overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 text-center text-[11px] font-medium uppercase muted dark:border-neutral-800">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const list = byDay.get(day) ?? [];
            const inMonth = day.startsWith(cursor);
            const isToday = day === t;
            const limit = expanded === day ? list.length : 4;
            return (
              <div
                key={day}
                className={`min-h-[92px] min-w-0 border-slate-200 p-1 dark:border-neutral-800 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                  inMonth ? "" : "bg-slate-50/70 dark:bg-neutral-950/40"
                } ${dragOver === day ? "bg-accent-soft dark:bg-accent/20" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(day);
                }}
                onDragLeave={() => setDragOver((d) => (d === day ? null : d))}
                onDrop={(e) => void onDrop(e, day)}
              >
                <div className={`mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${isToday ? "bg-accent font-semibold text-white" : inMonth ? "" : "muted"}`}>
                  {Number(day.slice(8))}
                </div>
                <div className="space-y-0.5">
                  {list.slice(0, limit).map((e) => {
                    const overdue = !e.done && day < t;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        draggable={!e.done && Boolean(e.milestone)}
                        onDragStart={(d) => d.dataTransfer.setData("text/plain", e.id)}
                        onClick={() => onOpen(e)}
                        className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight ${
                          e.done ? "text-slate-400 line-through dark:text-neutral-500" : "text-slate-800 dark:text-neutral-100"
                        } ${overdue ? "ring-1 ring-red-500" : ""}`}
                        style={{ background: e.done ? undefined : `${eventColor(e)}26`, borderLeft: `3px solid ${eventColor(e)}` }}
                        title={`${e.title} — ${e.shipment.label} ${e.shipment.containerNo ?? ""} ${e.shipment.client ?? ""}`}
                      >
                        <span className="font-medium">{e.shipment.label}</span> {e.title}
                      </button>
                    );
                  })}
                  {list.length > limit && (
                    <button type="button" className="text-[11px] link" onClick={() => setExpanded(day)}>
                      ещё {list.length - limit}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {noDate.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Без плановой даты: {noDate.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <button type="button" className="underline" onClick={() => onOpen(e)}>
                {e.shipment.label} — {e.title.toLowerCase()}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function CalendarPage() {
  const [view, setViewState] = useState<View>(readView);
  const [q, setQ] = useState("");
  const [onlyPayments, setOnlyPayments] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["calendar"],
    queryFn: () => api<{ events: CalendarEvent[] }>("/calendar"),
    refetchInterval: 60_000,
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem("crm.calendar.view", v);
    } catch {
      /* без сохранения */
    }
  };
  const events = (data?.events ?? []).filter((e) => matches(e, q.trim(), onlyPayments));
  const opened = data?.events.find((e) => e.id === openId) ?? null;

  const t = today();
  const nextMonday = addDays(mondayOf(t), 7);
  const open = events.filter((e) => !e.done);
  const stats = [
    { label: "Просрочено", n: open.filter((e) => e.date && e.date < t).length, cls: "text-red-600 dark:text-red-400" },
    { label: "Эта неделя", n: open.filter((e) => e.date && e.date >= t && e.date < nextMonday).length, cls: "" },
    { label: "Следующая", n: open.filter((e) => e.date && e.date >= nextMonday && e.date < addDays(nextMonday, 7)).length, cls: "" },
    { label: "Оплаты до конца след. недели", n: open.filter((e) => e.payment && e.date && e.date < addDays(nextMonday, 7)).length, cls: "text-amber-700 dark:text-amber-400" },
  ];

  const tab = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={`px-3 py-1 text-sm ${view === v ? "bg-accent text-white" : "hover:bg-slate-100 dark:hover:bg-neutral-800"}`}
    >
      {label}
    </button>
  );

  return (
    <Content wide>
      <PageHeader
        title="Календарь"
        meta={
          <>
            Даты и оплаты по всем{" "}
            <Link to="/shipments" className="link">
              сделкам в работе
            </Link>
            . Нажмите на событие, чтобы отметить выполнение или перенести.
          </>
        }
        actions={
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-neutral-700">
            {tab("list", "По неделям")}
            {tab("month", "Месяц")}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel px-3 py-2">
            <div className={`text-xl font-semibold tabular-nums ${s.n ? s.cls : "muted"}`}>{s.n}</div>
            <div className="text-xs muted">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" className="input pl-8" placeholder="Контейнер, клиент, груз" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyPayments} onChange={(e) => setOnlyPayments(e.target.checked)} />
          Только оплаты
        </label>
      </div>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.events.length === 0 && (
        <EmptyState title="Сделок в работе нет">
          Календарь заполняется из плановых дат сделок. <Link to="/shipments?new=1" className="link">Создать сделку</Link>
        </EmptyState>
      )}
      {data && data.events.length > 0 && (view === "list" ? <ListView events={events} onOpen={(e) => setOpenId(e.id)} /> : <MonthView events={events} onOpen={(e) => setOpenId(e.id)} />)}
      {opened && <EventDialog key={opened.id + String(opened.date) + String(opened.done)} event={opened} onClose={() => setOpenId(null)} />}
    </Content>
  );
}

