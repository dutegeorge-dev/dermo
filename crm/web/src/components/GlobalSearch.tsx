/** Глобальный поиск по разделу (горячая клавиша «/»). */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { api } from "../lib/api.ts";
import { SnippetHtml } from "../lib/highlight.tsx";
import type { SearchResult } from "../lib/types.ts";
import { IconBoard, IconBook, IconBuilding, IconPhone, IconSearch } from "./Icons.tsx";

type Item = { key: string; to: string; kind: "page" | "topic" | "deal" | "client"; title: string; sub: string; snippet: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  });

  const items = useMemo<Item[]>(() => {
    if (!data || debounced.length < 2) return [];
    return [
      ...data.deals.map((d) => ({
        key: `d-${d.key}`,
        to: `/deals/${d.key}`,
        kind: "deal" as const,
        title: `${d.key} · ${d.title}`,
        sub: `Сделка · ${d.outcome === "lost" ? "отказ" : d.status}${d.client ? ` · ${d.client}` : ""}`,
        snippet: "",
      })),
      ...data.clients.map((c) => ({
        key: `c-${c.id}`,
        to: `/clients/${c.id}`,
        kind: "client" as const,
        title: c.name,
        sub: `Клиент${c.inn ? ` · ИНН ${c.inn}` : ""}`,
        snippet: "",
      })),
      ...data.callTopics.map((t) => ({
        key: `t-${t.id}`,
        to: `/calls?topic=${encodeURIComponent(t.id)}&q=${encodeURIComponent(debounced)}`,
        kind: "topic" as const,
        title: t.ask[0] || t.title,
        sub: `Справочник для звонков · ${t.title}`,
        snippet: t.snippet,
      })),
      ...data.pages.map((p) => ({
        key: `p-${p.id}`,
        to: `/kb/${p.spaceKey}/${p.id}`,
        kind: "page" as const,
        title: p.title,
        sub: `База знаний · ${p.spaceName}`,
        snippet: p.snippet,
      })),
    ];
  }, [data, debounced]);

  useEffect(() => setActive(0), [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (item: Item) => {
    navigate(item.to);
    setOpen(false);
    inputRef.current?.blur();
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div className="relative w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">Поиск</span>
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          placeholder="Поиск: сделки, клиенты, база знаний, справочник"
          className="input pl-8 pr-8"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              go(items[active]);
            }
          }}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 px-1.5 text-[11px] text-slate-400 sm:block dark:border-neutral-700">
          /
        </kbd>
      </label>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {items.length === 0 && (
            <p className="px-3 py-3 text-sm muted">{isFetching || debounced !== q.trim() ? "Ищем…" : "Ничего не найдено"}</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              className={`flex w-full gap-2.5 px-3 py-2 text-left ${i === active ? "bg-slate-100 dark:bg-neutral-800" : ""}`}
            >
              <span className="mt-0.5 text-slate-400">{{ page: <IconBook />, topic: <IconPhone />, deal: <IconBoard />, client: <IconBuilding /> }[item.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs muted">{item.sub}</span>
                {item.snippet && (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600 dark:text-neutral-300">
                    <SnippetHtml html={item.snippet} />
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
