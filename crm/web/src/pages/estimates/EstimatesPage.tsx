/** Раздел «Расчёт»: список расчётов по заявкам клиентов на их товары. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { formatMoney } from "../../../../shared/documents.ts";
import { ESTIMATE_SCHEMES, type EstimateScheme } from "../../../../shared/estimate.ts";
import { formatDay } from "../../components/docs/common.tsx";
import { IconCalculator, IconPlus, IconSearch } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";

export type EstimateRow = {
  id: number;
  title: string;
  clientName: string;
  scheme: EstimateScheme;
  totalRub: number;
  goods: number;
  goodsCurrency: string;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
  createdByName: string | null;
};

export function EstimatesPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["estimates"], queryFn: () => api<{ estimates: EstimateRow[] }>("/estimates") });
  const needle = q.trim().toLowerCase();
  const rows = (data?.estimates ?? []).filter((e) => !needle || `${e.title} ${e.clientName}`.toLowerCase().includes(needle));
  return (
    <Content wide>
      <PageHeader
        title="Расчёт"
        meta="Заявки клиентов на их товары: доставка, растаможка, КП"
        actions={
          <Link to="/estimates/new" className="btn btn-primary">
            <IconPlus size={14} /> Новый расчёт
          </Link>
        }
      />
      <label className="relative mb-4 block w-full max-w-xs">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="search" className="input pl-8" placeholder="Груз, клиент" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.estimates.length === 0 && (
        <EmptyState title="Расчётов пока нет">
          Вставьте заявку клиента — ИИ разложит её по полям: груз, вес, объём, маршрут, ТН ВЭД. <Link to="/estimates/new" className="link">Новый расчёт</Link>
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="panel divide-line">
          {rows.map((e) => (
            <Link key={e.id} to={`/estimates/${e.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-neutral-800/50">
              <IconCalculator className="shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.title}</div>
                <div className="truncate text-xs muted">
                  {[e.clientName || "без клиента", ESTIMATE_SCHEMES[e.scheme] ?? e.scheme, `товар ${formatMoney(e.goods, e.goodsCurrency)}`].join(" · ")}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">{formatMoney(e.totalRub, "RUB")}</div>
                <div className="text-xs muted">
                  {formatDay(e.updatedAt.slice(0, 10))}
                  {e.createdByName ? ` · ${e.createdByName}` : ""}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Content>
  );
}
