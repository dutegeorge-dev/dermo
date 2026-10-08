/** История версий справочника: просмотр любого снимка и откат. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { TopicView } from "../components/calls/TopicView.tsx";
import { Content } from "../components/Layout.tsx";
import { ConfirmDialog, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import type { CallTopic, VersionRow } from "../lib/types.ts";

type Snapshot = VersionRow & { topics: CallTopic[] };

export function CallScriptHistory() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const versions = useQuery({
    queryKey: ["calls", "versions"],
    queryFn: () => api<{ versions: (VersionRow & { note: string })[] }>("/calls/versions"),
  });
  const list = versions.data?.versions ?? [];
  const latest = list[0]?.version;
  const selected = Number(params.get("v")) || latest;

  const snapshot = useQuery({
    queryKey: ["calls", "version", selected],
    queryFn: () => api<{ version: Snapshot }>(`/calls/versions/${selected}`),
    enabled: !!selected,
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openQ, setOpenQ] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);

  return (
    <Content wide>
      <PageHeader
        title="История справочника"
        meta={
          <Link to="/calls" className="link">
            ← к справочнику
          </Link>
        }
      />
      {versions.isLoading && <Spinner />}
      <ErrorBox error={versions.error} />

      {list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <ol className="panel max-h-[70vh] divide-line overflow-y-auto">
            {list.map((v) => (
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
                    {v.version === latest && <span className="text-[11px] muted">текущая</span>}
                  </span>
                  <span className="block text-xs text-slate-700 dark:text-neutral-300">{v.note}</span>
                  <span className="block text-xs muted">
                    {formatDateTime(v.createdAt)} · {v.createdByName ?? "импорт"}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className="min-w-0">
            {snapshot.isLoading && <Spinner />}
            <ErrorBox error={snapshot.error} />
            {snapshot.data && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm muted">
                    Версия {snapshot.data.version.version} · {snapshot.data.version.topics.length} строк
                  </p>
                  {snapshot.data.version.version !== latest && (
                    <button type="button" className="btn" onClick={() => setRestoring(true)}>
                      Откатить к этой версии
                    </button>
                  )}
                </div>
                <ul className="panel divide-line overflow-hidden">
                  {snapshot.data.version.topics.map((topic) => (
                    <li key={topic.id}>
                      <TopicView
                        topic={topic}
                        terms={[]}
                        expanded={expanded.has(topic.id)}
                        openQuestions={new Set(topic.qa.map((_, i) => i).filter((i) => openQ.has(`${topic.id}:${i}`)))}
                        onToggle={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(topic.id)) n.delete(topic.id);
                            else n.add(topic.id);
                            return n;
                          })
                        }
                        onToggleQuestion={(i) =>
                          setOpenQ((s) => {
                            const n = new Set(s);
                            const k = `${topic.id}:${i}`;
                            if (n.has(k)) n.delete(k);
                            else n.add(k);
                            return n;
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {restoring && snapshot.data && (
        <ConfirmDialog
          title={`Откатить к версии ${snapshot.data.version.version}?`}
          message="Справочник станет таким, как в этой версии. Текущее состояние останется в истории — к нему можно будет вернуться."
          confirmLabel="Откатить"
          danger={false}
          onConfirm={async () => {
            await api(`/calls/versions/${snapshot.data!.version.version}/restore`, { method: "POST" });
            await queryClient.invalidateQueries({ queryKey: ["calls"] });
            setParams({});
          }}
          onClose={() => setRestoring(false)}
        />
      )}
    </Content>
  );
}
