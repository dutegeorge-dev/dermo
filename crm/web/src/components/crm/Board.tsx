/** Канбан-доска: колонки — этапы, карточки — сделки. Перетаскивание между колонками и внутри. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import { PRIORITIES } from "../../../../shared/deal-fields.ts";
import { api } from "../../lib/api.ts";
import type { Deal, Stage } from "../../lib/types.ts";
import { IconPlus } from "../Icons.tsx";
import { ErrorBox } from "../ui.tsx";
import { Avatar, formatShortDate, isOverdue, StageChip } from "./common.tsx";

function DealCard({ deal, dragging, onDragStart, onDragEnd }: { deal: Deal; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const location = useLocation();
  const overdue = isOverdue(deal.dueDate, deal.outcome !== null);
  return (
    <Link
      to={`/deals/${deal.key}${location.search}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", deal.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`block rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-slate-300 hover:shadow dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600 ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] muted">
        <span className="font-mono">{deal.key}</span>
        {(deal.priority === "high" || deal.priority === "urgent") && (
          <span className={deal.priority === "urgent" ? "font-medium text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>
            {PRIORITIES[deal.priority]}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-sm font-medium leading-snug text-slate-900 dark:text-neutral-50">{deal.title}</div>
      {deal.clientName && <div className="mt-0.5 truncate text-xs text-slate-600 dark:text-neutral-300">{deal.clientName}</div>}
      <div className="mt-2 flex items-center gap-2">
        <Avatar name={deal.assigneeName} />
        {deal.labels.slice(0, 2).map((l) => (
          <span key={l} className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-neutral-700 dark:text-neutral-300">
            {l}
          </span>
        ))}
        {deal.dueDate && (
          <span className={`ml-auto shrink-0 text-[11px] ${overdue ? "font-medium text-red-600 dark:text-red-400" : "muted"}`} title="Срок">
            {formatShortDate(deal.dueDate)}
          </span>
        )}
      </div>
    </Link>
  );
}

export function Board({
  stages,
  deals,
  queryKey,
  onCreate,
}: {
  stages: Stage[];
  deals: Deal[];
  queryKey: unknown[];
  onCreate: (stageKey: string) => void;
}) {
  const queryClient = useQueryClient();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hint, setHint] = useState<{ stage: string; before: string | null } | null>(null);

  const move = useMutation({
    mutationFn: (v: { key: string; statusKey: string; beforeKey: string | null }) =>
      api(`/deals/${v.key}/move`, { method: "POST", body: { statusKey: v.statusKey, beforeKey: v.beforeKey } }),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<{ deals: Deal[] }>(queryKey, (old) => {
        if (!old) return old;
        const moving = old.deals.find((d) => d.key === v.key);
        if (!moving) return old;
        const rest = old.deals.filter((d) => d.key !== v.key);
        const column = rest.filter((d) => d.statusKey === v.statusKey);
        const before = v.beforeKey ? column.find((d) => d.key === v.beforeKey) : null;
        const prev = before ? column.filter((d) => d.boardPosition < before.boardPosition).at(-1) : column.at(-1);
        const position = before
          ? prev ? (prev.boardPosition + before.boardPosition) / 2 : before.boardPosition - 1024
          : (prev?.boardPosition ?? 0) + 1024;
        return { deals: [...rest, { ...moving, statusKey: v.statusKey, boardPosition: position }] };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      void queryClient.invalidateQueries({ queryKey: ["stages"] });
    },
  });

  const drop = () => {
    if (dragKey && hint && hint.before !== dragKey) move.mutate({ key: dragKey, statusKey: hint.stage, beforeKey: hint.before });
    setDragKey(null);
    setHint(null);
  };

  return (
    <div>
      {move.error && <div className="mb-2"><ErrorBox error={move.error} /></div>}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const column = deals
            .filter((d) => d.statusKey === stage.key)
            .sort((a, b) => a.boardPosition - b.boardPosition || a.id - b.id);
          return (
            <section
              key={stage.key}
              className={`flex w-72 shrink-0 flex-col rounded-lg bg-slate-100/70 dark:bg-neutral-800/40 ${
                hint?.stage === stage.key && hint.before === null ? "ring-2 ring-accent/40" : ""
              }`}
              onDragOver={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.column) setHint({ stage: stage.key, before: null });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop();
              }}
            >
              <header className="flex items-center gap-2 p-2">
                <StageChip stage={stage} className="h-7 flex-1 text-[13px]" />
                <span className="w-6 text-center text-xs tabular-nums muted">{column.length}</span>
                <button type="button" className="icon-btn" title="Новая сделка на этом этапе" onClick={() => onCreate(stage.key)}>
                  <IconPlus size={14} />
                </button>
              </header>
              {stage.isFinal && <p className="-mt-1 px-3 pb-1 text-[11px] muted">успешные за 30 дней</p>}
              <div data-column="1" className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {column.map((deal) => (
                  <div
                    key={deal.key}
                    onDragOver={(e) => {
                      if (!dragKey || dragKey === deal.key) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > rect.top + rect.height / 2;
                      const idx = column.indexOf(deal);
                      setHint({ stage: stage.key, before: after ? column[idx + 1]?.key ?? null : deal.key });
                    }}
                    className="relative"
                  >
                    {hint?.stage === stage.key && hint.before === deal.key && dragKey !== deal.key && (
                      <span className="pointer-events-none absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-accent" />
                    )}
                    <DealCard
                      deal={deal}
                      dragging={dragKey === deal.key}
                      onDragStart={() => setDragKey(deal.key)}
                      onDragEnd={() => {
                        setDragKey(null);
                        setHint(null);
                      }}
                    />
                  </div>
                ))}
                {hint?.stage === stage.key && hint.before === null && column.length > 0 && (
                  <span className="pointer-events-none h-0.5 rounded bg-accent" />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
