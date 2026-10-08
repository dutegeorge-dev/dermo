/** Табличный вид сделок с сортировкой. */

import { Link, useLocation } from "react-router";

import { PRIORITIES, ROUTES } from "../../../../shared/deal-fields.ts";
import type { Deal, Stage } from "../../lib/types.ts";
import { formatShortDate, isOverdue, StageChip } from "./common.tsx";

export type Sort = { by: string; dir: "asc" | "desc" };

function Th({ id, label, sort, onSort }: { id: string; label: string; sort: Sort; onSort: (s: Sort) => void }) {
  const active = sort.by === id;
  return (
    <th className="whitespace-nowrap px-3 py-2 font-medium">
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-neutral-100 ${active ? "text-slate-900 dark:text-neutral-100" : ""}`}
        onClick={() => onSort({ by: id, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
      >
        {label}
        {active && <span>{sort.dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function DealsTable({ deals, stages, sort, onSort }: { deals: Deal[]; stages: Stage[]; sort: Sort; onSort: (s: Sort) => void }) {
  const location = useLocation();
  const stageBy = new Map(stages.map((s) => [s.key, s]));
  if (deals.length === 0) return <p className="py-10 text-center text-sm muted">Сделок не найдено</p>;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
            <Th id="key" label="Ключ" sort={sort} onSort={onSort} />
            <Th id="title" label="Название" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 font-medium">Клиент</th>
            <th className="px-3 py-2 font-medium">Этап</th>
            <th className="px-3 py-2 font-medium">Исполнитель</th>
            <Th id="dueDate" label="Срок" sort={sort} onSort={onSort} />
            <Th id="priority" label="Приоритет" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 font-medium">Маршрут</th>
            <Th id="updatedAt" label="Изменена" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
          {deals.map((d) => {
            const stage = stageBy.get(d.statusKey);
            return (
              <tr key={d.key} className="hover:bg-slate-50 dark:hover:bg-neutral-800/50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  <Link to={`/deals/${d.key}${location.search}`} className="link">{d.key}</Link>
                </td>
                <td className="min-w-48 px-3 py-2">
                  <Link to={`/deals/${d.key}${location.search}`} className="hover:underline">{d.title}</Link>
                  {d.outcome === "lost" && <span className="ml-2 text-xs text-red-600 dark:text-red-400">отказ</span>}
                  {d.outcome === "won" && <span className="ml-2 text-xs text-green-700 dark:text-green-400">успешно</span>}
                </td>
                <td className="px-3 py-2">{d.clientName ?? <span className="muted">—</span>}</td>
                <td className="max-w-48 px-3 py-2">{stage && <StageChip stage={stage} className="max-w-full" />}</td>
                <td className="whitespace-nowrap px-3 py-2">{d.assigneeName ?? <span className="muted">—</span>}</td>
                <td className={`whitespace-nowrap px-3 py-2 ${isOverdue(d.dueDate, d.outcome !== null) ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
                  {formatShortDate(d.dueDate) || <span className="muted">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{PRIORITIES[d.priority]}</td>
                <td className="whitespace-nowrap px-3 py-2">{d.route ? ROUTES[d.route as keyof typeof ROUTES] : <span className="muted">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs muted">{new Date(d.updatedAt).toLocaleDateString("ru-RU")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
