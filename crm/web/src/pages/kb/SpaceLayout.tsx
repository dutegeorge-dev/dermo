/** Пространство: слева дерево страниц, справа — выбранная страница. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Outlet, useOutletContext, useParams } from "react-router";

import { IconChevronDown, IconPlus } from "../../components/Icons.tsx";
import { CreatePageDialog } from "../../components/kb/dialogs.tsx";
import { type MoveTarget, PageTree } from "../../components/kb/PageTree.tsx";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import type { Space, TreePage } from "../../lib/types.ts";

export type SpaceData = { space: Space; pages: TreePage[] };
export type SpaceContext = SpaceData & { createPage: (parentId: number | null) => void };

export function useSpace(): SpaceContext {
  return useOutletContext<SpaceContext>();
}

export function SpaceLayout() {
  const { spaceKey = "", pageId } = useParams();
  const key = spaceKey.toUpperCase();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["space", key],
    queryFn: () => api<SpaceData>(`/kb/spaces/${encodeURIComponent(key)}`),
  });
  const [creating, setCreating] = useState<{ parentId: number | null } | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);

  const move = useMutation({
    mutationFn: ({ id, target }: { id: number; target: MoveTarget }) =>
      api(`/kb/pages/${id}/move`, { method: "POST", body: target }),
    onMutate: ({ id, target }) => {
      // Оптимистично: сразу показываем страницу на новом месте.
      queryClient.setQueryData<SpaceData>(["space", key], (old) => {
        if (!old) return old;
        const siblings = old.pages
          .filter((p) => p.parentId === target.parentId && p.id !== id)
          .sort((a, b) => a.position - b.position);
        const moved = old.pages.find((p) => p.id === id);
        if (!moved) return old;
        siblings.splice(target.index, 0, { ...moved, parentId: target.parentId });
        const positions = new Map(siblings.map((p, i) => [p.id, i]));
        return {
          ...old,
          pages: old.pages.map((p) =>
            positions.has(p.id) ? { ...p, position: positions.get(p.id)!, parentId: p.id === id ? target.parentId : p.parentId } : p,
          ),
        };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["space", key] }),
  });

  if (isLoading) return <div className="px-8"><Spinner /></div>;
  if (error || !data) return <div className="px-8 py-6"><ErrorBox error={error ?? new Error("Пространство не найдено")} /></div>;

  const activeId = pageId ? Number(pageId) : null;
  const parentTitle = creating?.parentId ? data.pages.find((p) => p.id === creating.parentId)?.title : undefined;

  const tree = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <Link to={`/kb/${data.space.key}`} className="truncate text-sm font-semibold hover:text-accent">
          {data.space.name}
        </Link>
        <button type="button" className="icon-btn" title="Новая страница" aria-label="Новая страница" onClick={() => setCreating({ parentId: null })}>
          <IconPlus size={14} />
        </button>
      </div>
      <PageTree
        spaceKey={data.space.key}
        pages={data.pages}
        activeId={activeId}
        onMove={(id, target) => move.mutate({ id, target })}
        onAddChild={(parentId) => setCreating({ parentId })}
      />
      {move.error && <div className="mt-2"><ErrorBox error={move.error} /></div>}
    </>
  );

  return (
    <div className="flex min-h-[calc(100vh-49px)]">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 md:block dark:border-neutral-800">
        <div className="sticky top-[49px] max-h-[calc(100vh-49px)] overflow-y-auto px-2 py-4">{tree}</div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="border-b border-slate-200 px-4 py-2 md:hidden dark:border-neutral-800">
          <button type="button" className="flex w-full items-center justify-between text-sm" onClick={() => setTreeOpen((v) => !v)}>
            <span className="font-medium">{data.space.name}: страницы</span>
            <IconChevronDown size={14} className={treeOpen ? "rotate-180" : ""} />
          </button>
          {treeOpen && <div className="pt-2">{tree}</div>}
        </div>
        <Outlet context={{ ...data, createPage: (parentId: number | null) => setCreating({ parentId }) } satisfies SpaceContext} />
      </div>
      {creating && (
        <CreatePageDialog
          spaceId={data.space.id}
          spaceKey={data.space.key}
          parentId={creating.parentId}
          parentTitle={parentTitle}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}
