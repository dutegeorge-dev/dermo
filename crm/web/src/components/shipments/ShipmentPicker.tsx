/** Выбор сделки (отгрузки) поиском: название груза, контейнер, клиент, номер. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { shipmentLabel, stageSpec } from "../../../../shared/shipments.ts";
import { api } from "../../lib/api.ts";
import type { Shipment } from "../../lib/types.ts";

export type PickedShipment = { id: number; number: number; title: string };

const text = (v: PickedShipment | null) => (v ? v.title : "");

export function ShipmentPicker({ value, onChange }: { value: PickedShipment | null; onChange: (v: PickedShipment | null) => void }) {
  const [q, setQ] = useState(text(value));
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => setQ(text(value)), [value?.id, value?.title]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const search = value && q === text(value) ? "" : debounced;
  const { data } = useQuery({
    queryKey: ["shipments", "pick", search],
    queryFn: () => api<{ shipments: Shipment[] }>(`/shipments?status=all&q=${encodeURIComponent(search)}`),
    enabled: open,
  });
  const list = [...(data?.shipments ?? [])].sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.number - a.number);
  return (
    <div className="relative">
      <input
        className="input"
        value={q}
        placeholder="Название груза, контейнер или клиент"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && data && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {list.length === 0 && <p className="px-3 py-1.5 text-sm muted">Сделок не найдено</p>}
          {list.slice(0, 30).map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: s.id, number: s.number, title: s.title });
                setQ(s.title);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-neutral-800"
            >
              <span className="font-medium">{s.title}</span>
              <span className="ml-2 text-xs muted">
                {[shipmentLabel(s.number), s.client?.name, s.containerNo, s.status === "active" ? stageSpec(s.stage).name : s.status === "closed" ? "закрыта" : "отменена"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
