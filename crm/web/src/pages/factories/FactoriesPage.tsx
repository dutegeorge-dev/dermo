/** База фабрик: поиск по названию, WeChat, товару, категории; фильтры по анкете. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { FACTORY_STATUSES } from "../../../../shared/factories.ts";
import { formatMoney } from "../../../../shared/documents.ts";
import { FactoryStatusChip } from "../../components/factories/common.tsx";
import { IconFactory, IconPlus, IconSearch, IconUpload } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api, fileUrl } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import type { FactoryRow } from "../../lib/types.ts";

const FLAGS = { export: "Экспортная лицензия", vtb: "ВТБ Шанхай", russia: "Работали с РФ" } as const;

export function FactoriesPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [flag, setFlag] = useState("");
  const params = new URLSearchParams({ q: q.trim(), status, category, flag });
  const { data, isLoading, error } = useQuery({
    queryKey: ["factories", params.toString()],
    queryFn: () => api<{ factories: FactoryRow[]; categories: { c: string; n: number }[] }>(`/factories?${params}`),
    placeholderData: (prev) => prev,
  });
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`;

  return (
    <Content wide>
      <PageHeader
        title="Фабрики"
        meta={user?.role === "admin" ? "Заводы из WeChat: кандидаты и поставщики" : "Фабрики, которые нашли вы, и поставщики компании"}
        actions={
          <>
            {user?.role === "admin" && (
              <Link to="/factories/catalogs" className="btn">
                <IconUpload /> Каталоги из рассылки
              </Link>
            )}
            <Link to="/factories/new" className="btn btn-primary">
              <IconPlus /> Добавить фабрику
            </Link>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative block w-full max-w-sm">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" className="input pl-8" placeholder="Название, WeChat, товар, город…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {data && data.categories.length > 0 && (
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
            <option value="">Все категории</option>
            {data.categories.map((c) => (
              <option key={c.c} value={c.c}>
                {c.c} ({c.n})
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button type="button" className={chip(!status)} onClick={() => setStatus("")}>Все</button>
        {Object.entries(FACTORY_STATUSES).map(([k, s]) => (
          <button key={k} type="button" className={chip(status === k)} onClick={() => setStatus(status === k ? "" : k)}>
            {s.label}
          </button>
        ))}
        <button type="button" className={chip(status === "supplier")} onClick={() => setStatus(status === "supplier" ? "" : "supplier")}>Поставщики</button>
        <span className="mx-1 w-px self-stretch bg-slate-200 dark:bg-neutral-800" />
        {Object.entries(FLAGS).map(([k, label]) => (
          <button key={k} type="button" className={chip(flag === k)} onClick={() => setFlag(flag === k ? "" : k)}>
            {label}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.factories.length === 0 && (
        <EmptyState title={q || status || category || flag ? "Ничего не найдено" : "Фабрик пока нет"}>
          Добавьте фабрику: скриншот профиля WeChat и переписки — ИИ заполнит анкету и цены.
        </EmptyState>
      )}
      {data && data.factories.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.factories.map((f) => (
            <li key={f.id}>
              <Link to={`/factories/${f.id}`} className="panel flex h-full gap-3 p-3 hover:border-blue-400">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-neutral-800">
                  {f.photoId ? <img src={fileUrl(f.photoId)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <IconFactory size={28} className="text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{f.nameRu || f.name}</div>
                  {f.nameRu && <div className="truncate text-xs muted">{f.name}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {f.counterpartyId ? <span className="rounded bg-green-100 px-1.5 text-[11px] text-green-800 dark:bg-green-950 dark:text-green-300">поставщик</span> : <FactoryStatusChip status={f.status} />}
                    {f.categories.slice(0, 2).map((c) => (
                      <span key={c} className="rounded bg-slate-100 px-1.5 text-[11px] dark:bg-neutral-800">{c}</span>
                    ))}
                  </div>
                  {f.offers.length > 0 && (
                    <div className="mt-1 truncate text-xs">
                      {f.offers
                        .slice(0, 2)
                        .map((o) => `${o.name}${o.price !== null ? ` — ${formatMoney(o.price, o.currency)}${o.unit ? `/${o.unit}` : ""}` : ""}`)
                        .join(" · ")}
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-[11px] muted">
                    {[f.location, f.wechatId && `WeChat ${f.wechatId}`, user?.role === "admin" && f.foundByName && `нашёл(а) ${f.foundByName}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Content>
  );
}
