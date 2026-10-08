/** Сделки: доска (канбан) или таблица с фильтрами; карточка — боковой панелью. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { Board } from "../../components/crm/Board.tsx";
import { useDirectory, useStages } from "../../components/crm/common.tsx";
import { CreateDealDialog } from "../../components/crm/CreateDealDialog.tsx";
import { DealPanel } from "../../components/crm/DealPanel.tsx";
import { DealsTable, type Sort } from "../../components/crm/DealsTable.tsx";
import { StagesEditor } from "../../components/crm/StagesEditor.tsx";
import { IconPlus, IconSearch } from "../../components/Icons.tsx";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import type { Deal } from "../../lib/types.ts";

export function DealsPage() {
  const { user } = useAuth();
  const { key } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "table" ? "table" : "board";
  const assignee = params.get("assignee") ?? "";
  const outcome = params.get("outcome") ?? "open";
  const stage = params.get("stage") ?? "";
  const sort: Sort = { by: params.get("sort") ?? "updatedAt", dir: params.get("dir") === "asc" ? "asc" : "desc" };
  const [q, setQ] = useState(params.get("q") ?? "");

  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) setParam({ q: q.trim() || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stagesQuery = useStages();
  const stages = stagesQuery.data?.stages ?? [];
  const users = useDirectory().data?.users ?? [];

  const query = new URLSearchParams();
  if (view === "board") query.set("view", "board");
  else {
    query.set("outcome", outcome);
    if (stage) query.set("stage", stage);
    query.set("sort", sort.by);
    query.set("dir", sort.dir);
  }
  if (assignee) query.set("assignee", assignee);
  if (params.get("q")) query.set("q", params.get("q")!);
  const queryKey = ["deals", query.toString()];
  const deals = useQuery({ queryKey, queryFn: () => api<{ deals: Deal[] }>(`/deals?${query}`) });

  const [creating, setCreating] = useState<{ stage?: string } | null>(null);
  const [editingStages, setEditingStages] = useState(false);

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="page-title mr-2">Сделки</h1>
        <div className="inline-flex rounded-md border border-slate-300 p-0.5 dark:border-neutral-700" role="tablist">
          {(["board", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setParam({ view: v === "board" ? null : v })}
              className={`rounded px-2.5 py-1 text-sm ${view === v ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
            >
              {v === "board" ? "Доска" : "Таблица"}
            </button>
          ))}
        </div>
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-8"
            placeholder="Ключ, название, клиент, телефон"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск сделок"
          />
        </label>
        <select className="input w-auto" value={assignee} onChange={(e) => setParam({ assignee: e.target.value || null })} aria-label="Исполнитель">
          <option value="">Все исполнители</option>
          <option value="me">Мои</option>
          <option value="none">Без исполнителя</option>
          {users.filter((u) => u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {view === "table" && (
          <>
            <select className="input w-auto" value={outcome} onChange={(e) => setParam({ outcome: e.target.value })} aria-label="Состояние">
              <option value="open">В работе</option>
              <option value="won">Успешные</option>
              <option value="lost">Отказ</option>
              <option value="all">Все</option>
            </select>
            <select className="input w-auto max-w-56" value={stage} onChange={(e) => setParam({ stage: e.target.value || null })} aria-label="Этап">
              <option value="">Все этапы</option>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </>
        )}
        <span className="flex-1" />
        {user?.role === "admin" && (
          <button type="button" className="btn" onClick={() => setEditingStages(true)} disabled={!stagesQuery.data}>
            Этапы
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => setCreating({})}>
          <IconPlus size={14} /> Сделка
        </button>
      </div>

      <ErrorBox error={deals.error ?? stagesQuery.error} />
      {(deals.isLoading || stagesQuery.isLoading) && <Spinner />}
      {deals.data && stagesQuery.data &&
        (view === "board" ? (
          <Board stages={stages} deals={deals.data.deals} queryKey={queryKey} onCreate={(s) => setCreating({ stage: s })} />
        ) : (
          <DealsTable deals={deals.data.deals} stages={stages} sort={sort} onSort={(s) => setParam({ sort: s.by, dir: s.dir })} />
        ))}

      {key && <DealPanel key={key} dealKey={key} onClose={() => navigate(`/deals?${params}`)} />}
      {creating && <CreateDealDialog initialStage={creating.stage} onClose={() => setCreating(null)} />}
      {editingStages && stagesQuery.data && <StagesEditor stages={stagesQuery.data.stages} onClose={() => setEditingStages(false)} />}
    </div>
  );
}
