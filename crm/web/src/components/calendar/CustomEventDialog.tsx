/**
 * Своё событие календаря — создать / изменить: встреча, поездка, оплата счёта, звонок, задача. С кем (контрагент),
 * по какой сделке, сумма (для оплат), ответственный, заметки. Отметить выполненным, удалить.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { CUSTOM_EVENT_TYPES, type CustomEvent, type CustomEventType } from "../../../../shared/calendar.ts";
import { CURRENCIES } from "../../../../shared/documents.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { useDirectory } from "../crm/common.tsx";
import { CounterpartyPicker, type Picked } from "../crm/CounterpartyPicker.tsx";
import { NumInput } from "../products/QuoteCalculator.tsx";
import { type PickedShipment, ShipmentPicker } from "../shipments/ShipmentPicker.tsx";
import { today } from "../shipments/common.tsx";
import { ErrorBox, Modal } from "../ui.tsx";

type Form = {
  type: CustomEventType;
  title: string;
  date: string;
  time: string;
  endDate: string;
  notes: string;
  amount: number | null;
  currency: string;
  shipment: PickedShipment | null;
  counterparty: Picked | null;
  assigneeId: number | null;
};

const PLACEHOLDERS: Record<CustomEventType, string> = {
  meeting: "Встреча с ООО «…» — образцы",
  trip: "Поездка на фабрику в Гуанчжоу",
  payment: "Оплатить счёт СВХ № …",
  call: "Позвонить клиенту по поставке",
  task: "Подготовить документы для брокера",
  other: "Что за событие",
};

export function CustomEventDialog({ event, date, onClose }: { event: CustomEvent | null; date?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const directory = useDirectory();
  const [form, setForm] = useState<Form>(() =>
    event
      ? {
          type: event.type,
          title: event.title,
          date: event.date,
          time: event.time ?? "",
          endDate: event.endDate ?? "",
          notes: event.notes,
          amount: event.amount,
          currency: event.currency ?? "RUB",
          shipment: event.shipmentId && event.shipmentNumber ? { id: event.shipmentId, number: event.shipmentNumber, title: event.shipmentTitle ?? "" } : null,
          counterparty: event.counterpartyId ? { id: event.counterpartyId, name: event.counterpartyName ?? "" } : null,
          assigneeId: event.assigneeId,
        }
      : { type: "meeting", title: "", date: date ?? today(), time: "", endDate: "", notes: "", amount: null, currency: "RUB", shipment: null, counterparty: null, assigneeId: user?.id ?? null },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const payload = () => ({
    type: form.type,
    title: form.title,
    date: form.date,
    time: form.time,
    endDate: form.type === "trip" ? form.endDate : "",
    notes: form.notes,
    amount: form.type === "payment" ? form.amount : null,
    currency: form.type === "payment" ? form.currency : null,
    shipmentId: form.shipment?.id ?? null,
    counterpartyId: form.counterparty?.id ?? null,
    assigneeId: form.assigneeId,
  });
  const save = () => run(() => (event ? api(`/calendar/events/${event.id}`, { method: "PATCH", body: payload() }) : api("/calendar/events", { method: "POST", body: payload() })));

  return (
    <Modal
      wide
      title={event ? "Событие" : "Новое событие"}
      onClose={onClose}
      footer={
        <>
          {event && (
            <button
              type="button"
              className="btn mr-auto"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Удалить событие?")) void run(() => api(`/calendar/events/${event.id}`, { method: "DELETE" }));
              }}
            >
              Удалить
            </button>
          )}
          {event && (
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api(`/calendar/events/${event.id}`, { method: "PATCH", body: { ...payload(), done: !event.done } }))}>
              {event.done ? "Вернуть в план" : form.type === "payment" ? "✓ Оплачено" : "✓ Выполнено"}
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !form.title.trim() || !form.date} onClick={() => void save()}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {event?.done && <p className="rounded-md bg-green-50 px-3 py-2 text-green-800 dark:bg-green-950/30 dark:text-green-300">✓ Выполнено</p>}
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(CUSTOM_EVENT_TYPES) as [CustomEventType, { label: string; color: string }][]).map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => set({ type: k })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${form.type === k ? "text-white" : "border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
              style={form.type === k ? { background: t.color, borderColor: t.color } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="label">Что</span>
          <input className="input" autoFocus={!event} value={form.title} placeholder={PLACEHOLDERS[form.type]} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="label">{form.type === "trip" ? "С" : "Дата"}</span>
            <input type="date" className="input" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          {form.type === "trip" ? (
            <label className="block">
              <span className="label">По</span>
              <input type="date" className="input" value={form.endDate} min={form.date} onChange={(e) => set({ endDate: e.target.value })} />
            </label>
          ) : (
            <label className="block">
              <span className="label">Время</span>
              <input type="time" className="input" value={form.time} onChange={(e) => set({ time: e.target.value })} />
            </label>
          )}
          {form.type === "payment" && (
            <>
              <label className="block">
                <span className="label">Сумма</span>
                <NumInput value={form.amount} onChange={(v) => set({ amount: v })} />
              </label>
              <label className="block">
                <span className="label">Валюта</span>
                <select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="label">С кем</span>
            <CounterpartyPicker value={form.counterparty} onChange={(v) => set({ counterparty: v })} allowNew={false} placeholder="Клиент, поставщик, подрядчик — необязательно" />
          </div>
          <div>
            <span className="label">По сделке</span>
            <ShipmentPicker value={form.shipment} onChange={(v) => set({ shipment: v })} />
            {form.shipment && (
              <Link to={`/shipments/${form.shipment.number}`} className="mt-0.5 block text-xs link" onClick={onClose}>
                открыть сделку № {form.shipment.number}
              </Link>
            )}
          </div>
        </div>
        <label className="block">
          <span className="label">Ответственный</span>
          <select className="input" value={form.assigneeId ?? ""} onChange={(e) => set({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— никто —</option>
            {directory.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Заметки</span>
          <textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Адрес, контакты, что взять с собой…" />
        </label>
        {event?.createdByName && <p className="text-xs muted">Добавил(а): {event.createdByName}</p>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
