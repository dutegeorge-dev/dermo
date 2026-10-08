/** Журнал действий (только admin). */

import { useInfiniteQuery } from "@tanstack/react-query";

import { Content } from "../components/Layout.tsx";
import { ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";

type Entry = {
  id: number;
  action: string;
  entityType: string;
  summary: string;
  ip: string | null;
  createdAt: string;
  userName: string | null;
};

export function AuditPage() {
  const query = useInfiniteQuery({
    queryKey: ["audit"],
    queryFn: ({ pageParam }) =>
      api<{ entries: Entry[]; nextBefore: number | null }>(`/audit?limit=100${pageParam ? `&before=${pageParam}` : ""}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <Content wide>
      <PageHeader title="Журнал действий" meta="Кто, когда и что создал, изменил или удалил" />
      {query.isLoading && <Spinner />}
      <ErrorBox error={query.error} />
      {entries.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <th className="whitespace-nowrap px-4 py-2 font-medium">Когда</th>
                <th className="px-4 py-2 font-medium">Кто</th>
                <th className="px-4 py-2 font-medium">Что</th>
                <th className="px-4 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-1.5 text-xs muted">{formatDateTime(e.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-1.5">{e.userName ?? "система"}</td>
                  <td className="px-4 py-1.5">{e.summary}</td>
                  <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs muted">{e.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <div className="mt-4 text-center">
          <button type="button" className="btn" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Показать ещё
          </button>
        </div>
      )}
    </Content>
  );
}
