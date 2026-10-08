/** Выбор контрагента нужной роли с поиском по названию, ИНН, контакту, телефону. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { COUNTERPARTY_ROLES } from "../../../../shared/documents.ts";
import { api } from "../../lib/api.ts";
import type { CounterpartyRole, CounterpartyRow } from "../../lib/types.ts";

export type Picked = { id: number; name: string } | { id: null; name: string };

export function CounterpartyPicker({
  role,
  value,
  onChange,
  allowNew = true,
  autoFocus,
  placeholder,
}: {
  role?: CounterpartyRole;
  value: Picked | null;
  onChange: (value: Picked | null) => void;
  allowNew?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => setQ(value?.name ?? ""), [value?.id, value?.name]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data } = useQuery({
    queryKey: ["counterparties", "pick", role ?? "all", debounced],
    queryFn: () =>
      api<{ counterparties: CounterpartyRow[] }>(
        `/counterparties?limit=20&q=${encodeURIComponent(debounced)}${role ? `&role=${role}` : ""}`,
      ),
    enabled: open,
  });
  const exact = data?.counterparties.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  const label = role ? COUNTERPARTY_ROLES[role].one.toLowerCase() : "контрагент";

  return (
    <div className="relative">
      <input
        className="input pr-14"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder ?? "Название, ИНН или телефон"}
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
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {data?.counterparties.map((c) => (
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
                {[!role && COUNTERPARTY_ROLES[c.role].one, c.inn && `ИНН ${c.inn}`, c.contactName, c.contactPhone].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
          {data && data.counterparties.length === 0 && !q.trim() && <p className="px-3 py-1.5 text-sm muted">Пока никого нет</p>}
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
              + Новый {label} «{q.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Создаёт контрагента, если выбран «новый». Возвращает id или null. */
export async function ensureCounterparty(picked: Picked | null, role: CounterpartyRole, extra: Record<string, unknown> = {}): Promise<number | null> {
  if (!picked) return null;
  if (picked.id) return picked.id;
  const { counterparty } = await api<{ counterparty: { id: number } }>("/counterparties", {
    method: "POST",
    body: { role, name: picked.name, ...extra },
  });
  return counterparty.id;
}
