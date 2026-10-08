/** Выбор клиента с поиском по названию, ИНН, телефону. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../../lib/api.ts";
import type { ClientRow } from "../../lib/types.ts";

export type PickedClient = { id: number; name: string } | { id: null; name: string };

export function ClientPicker({
  value,
  onChange,
  allowNew = true,
  autoFocus,
}: {
  value: PickedClient | null;
  onChange: (value: PickedClient | null) => void;
  allowNew?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data } = useQuery({
    queryKey: ["clients", "pick", debounced],
    queryFn: () => api<{ clients: ClientRow[] }>(`/clients?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 1,
  });
  const exact = data?.clients.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="relative">
      <input
        className="input"
        value={q}
        autoFocus={autoFocus}
        placeholder="Название, ИНН или телефон"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          onChange(e.target.value.trim() && allowNew ? { id: null, name: e.target.value.trim() } : null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {value?.id && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-green-700 dark:text-green-400">выбран</span>}
      {value && value.id === null && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] muted">новый</span>}
      {open && debounced.length >= 1 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {data?.clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: c.id, name: c.name });
                setQ(c.name);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-neutral-800"
            >
              {c.name}
              <span className="ml-2 text-xs muted">
                {[c.inn && `ИНН ${c.inn}`, c.contactName, c.contactPhone].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
          {allowNew && !exact && q.trim() && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: null, name: q.trim() });
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-accent hover:bg-slate-100 dark:text-accent-bright dark:hover:bg-neutral-800"
            >
              + Новый клиент «{q.trim()}»
            </button>
          )}
          {data && data.clients.length === 0 && !allowNew && <p className="px-3 py-1.5 text-sm muted">Не найдено</p>}
        </div>
      )}
    </div>
  );
}
