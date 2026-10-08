/** Список пространств базы знаний. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { IconPlus } from "../../components/Icons.tsx";
import { CreateSpaceDialog } from "../../components/kb/dialogs.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatRelative, plural } from "../../lib/format.ts";
import type { Space } from "../../lib/types.ts";

export function KbHome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["spaces"],
    queryFn: () => api<{ spaces: Space[] }>("/kb/spaces"),
  });
  const [creating, setCreating] = useState(false);

  return (
    <Content>
      <PageHeader
        title="База знаний"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> Пространство
          </button>
        }
      />
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.spaces.length === 0 && (
        <EmptyState title="Пространств пока нет">Создайте первое — например, «Продажи» или «Таможня».</EmptyState>
      )}
      {data && data.spaces.length > 0 && (
        <ul className="panel divide-line">
          {data.spaces.map((space) => (
            <li key={space.id}>
              <Link to={`/kb/${space.key}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-neutral-800/50">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{space.name}</span>
                  {space.description && <span className="mt-0.5 block text-sm muted">{space.description}</span>}
                </span>
                <span className="hidden shrink-0 text-right text-xs muted sm:block">
                  {space.pageCount ?? 0} {plural(space.pageCount ?? 0, "страница", "страницы", "страниц")}
                  <span className="block">{formatRelative(space.lastPageUpdatedAt ?? space.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateSpaceDialog onClose={() => setCreating(false)} />}
    </Content>
  );
}
