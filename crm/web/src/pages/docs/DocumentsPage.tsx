/** Реестр документов: фильтры по группе и типу, поиск, долги, истекающие. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { DOC_GROUPS, DOC_TYPES, type DocGroup } from "../../../../shared/documents.ts";
import { DocumentsTable } from "../../components/docs/common.tsx";
import { IconPlus, IconSearch } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import type { DocumentRow } from "../../lib/types.ts";

export function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const group = params.get("group") ?? "";
  const type = params.get("type") ?? "";
  const view = params.get("view") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const query = new URLSearchParams();
  if (group) query.set("group", group);
  if (type) query.set("type", type);
  if (view === "debt") query.set("payment", "debt");
  if (view === "expiring") query.set("expiring", "30");
  if (debounced) query.set("q", debounced);
  const { data, isLoading, error } = useQuery({
    queryKey: ["documents", query.toString()],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?${query}`),
    placeholderData: (prev) => prev,
  });

  return (
    <Content wide>
      <PageHeader
        title="Документы"
        actions={
          <Link to={`/documents/new${type ? `?type=${type}` : ""}`} className="btn btn-primary">
            <IconPlus size={14} /> Загрузить документ
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[
          ["", "Все"],
          ["debt", "Не оплачены"],
          ["expiring", "Истекают в течение 30 дней"],
        ].map(([v, l]) => (
          <button key={v} type="button" onClick={() => set({ view: v })} className={`btn btn-sm ${view === v ? "btn-primary" : ""}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="relative block w-full max-w-sm">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" className="input pl-8" placeholder="Номер, контрагент, товар" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="input w-auto" value={group} onChange={(e) => set({ group: e.target.value, type: "" })} aria-label="Группа">
          <option value="">Все группы</option>
          {Object.entries(DOC_GROUPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input w-auto" value={type} onChange={(e) => set({ type: e.target.value })} aria-label="Тип">
          <option value="">Все типы</option>
          {Object.entries(DOC_TYPES)
            .filter(([, s]) => !group || s.group === (group as DocGroup))
            .map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </div>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && <DocumentsTable rows={data.documents} />}
    </Content>
  );
}
