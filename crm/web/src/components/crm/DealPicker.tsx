/** Выбор сделки поиском по ключу, названию, клиенту. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../../lib/api.ts";
import type { Deal } from "../../lib/types.ts";

export type PickedDeal = { id: number; key: string; title: string };

export function DealPicker({ value, onChange }: { value: PickedDeal | null; onChange: (d: PickedDeal | null) => void }) {
  const [q, setQ] = useState(value ? `${value.key} · ${value.title}` : "");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => setQ(value ? `${value.key} · ${value.title}` : ""), [value?.id]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({
    queryKey: ["deals", "pick", debounced],
    queryFn: () => api<{ deals: Deal[] }>(`/deals?outcome=open&q=${encodeURIComponent(value && q.startsWith(value.key) ? "" : debounced)}`),
    enabled: open,
  });
  return (
    <div className="relative">
      <input
        className="input"
        value={q}
        placeholder="BARS-12, название или клиент"
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
          {data.deals.length === 0 && <p className="px-3 py-1.5 text-sm muted">Сделок не найдено</p>}
          {data.deals.slice(0, 20).map((d) => (
            <button
              key={d.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: d.id, key: d.key, title: d.title });
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-neutral-800"
            >
              <span className="font-mono text-xs">{d.key}</span> {d.title}
              {d.clientName && <span className="ml-2 text-xs muted">{d.clientName}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
