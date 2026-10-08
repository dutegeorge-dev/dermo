/** История версий страницы: просмотр и откат. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Content } from "../../components/Layout.tsx";
import { DocView } from "../../components/RichText.tsx";
import { ConfirmDialog, ErrorBox, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import type { Doc, VersionRow } from "../../lib/types.ts";
import { Breadcrumbs, usePage } from "./PageView.tsx";
import { useSpace } from "./SpaceLayout.tsx";

export function PageHistory() {
  const { pageId } = useParams();
  const id = Number(pageId);
  const { space } = useSpace();
  const page = usePage(id);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [restoring, setRestoring] = useState(false);

  const versions = useQuery({
    queryKey: ["page", id, "versions"],
    queryFn: () => api<{ versions: (VersionRow & { title: string })[] }>(`/kb/pages/${id}/versions`),
  });
  const current = page.data?.page.version;
  const selected = Number(params.get("v")) || current;
  const version = useQuery({
    queryKey: ["page", id, "version", selected],
    queryFn: () => api<{ version: VersionRow & { title: string; content: Doc } }>(`/kb/pages/${id}/versions/${selected}`),
    enabled: !!selected,
  });

  if (page.isLoading || versions.isLoading) return <Content><Spinner /></Content>;
  if (!page.data) return <Content><ErrorBox error={page.error} /></Content>;

  return (
    <Content wide>
      <Breadcrumbs data={page.data} />
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">История: {page.data.page.title}</h1>
        <Link to={`/kb/${space.key}/${id}`} className="link text-sm">← к странице</Link>
      </div>
      <ErrorBox error={versions.error} />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ol className="panel max-h-[70vh] divide-line overflow-y-auto">
          {versions.data?.versions.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                onClick={() => setParams({ v: String(v.version) })}
                className={`block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-neutral-800/50 ${
                  v.version === selected ? "bg-accent-soft dark:bg-accent/15" : ""
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">Версия {v.version}</span>
                  {v.version === current && <span className="text-[11px] muted">текущая</span>}
                </span>
                {v.note && <span className="block text-xs text-slate-700 dark:text-neutral-300">{v.note}</span>}
                <span className="block text-xs muted">
                  {formatDateTime(v.createdAt)} · {v.createdByName ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="min-w-0">
          {version.isLoading && <Spinner />}
          <ErrorBox error={version.error} />
          {version.data && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-neutral-800">
                <p className="text-sm muted">
                  Версия {version.data.version.version} · {formatDateTime(version.data.version.createdAt)} ·{" "}
                  {version.data.version.createdByName ?? "—"}
                </p>
                {version.data.version.version !== current && (
                  <button type="button" className="btn" onClick={() => setRestoring(true)}>
                    Восстановить эту версию
                  </button>
                )}
              </div>
              <h2 className="mb-4 text-2xl font-semibold tracking-tight">{version.data.version.title}</h2>
              <DocView doc={version.data.version.content} />
            </>
          )}
        </div>
      </div>
      {restoring && version.data && (
        <ConfirmDialog
          title={`Восстановить версию ${version.data.version.version}?`}
          message="Содержимое этой версии станет текущим и сохранится новой версией. Текущий текст останется в истории."
          confirmLabel="Восстановить"
          danger={false}
          onConfirm={async () => {
            await api(`/kb/pages/${id}/versions/${version.data!.version.version}/restore`, { method: "POST" });
            await queryClient.invalidateQueries({ queryKey: ["page", id] });
            await queryClient.invalidateQueries({ queryKey: ["space", space.key] });
            setParams({});
          }}
          onClose={() => setRestoring(false)}
        />
      )}
    </Content>
  );
}
