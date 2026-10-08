/**
 * Дерево страниц пространства. Перетаскивание: верхняя четверть строки —
 * поставить перед, нижняя — после, середина — вложить внутрь.
 */

import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";

import type { TreePage } from "../../lib/types.ts";
import { IconChevronRight, IconPlus } from "../Icons.tsx";

type Zone = "before" | "inside" | "after";

export type MoveTarget = { parentId: number | null; index: number };

function buildChildren(pages: TreePage[]): Map<number | null, TreePage[]> {
  const map = new Map<number | null, TreePage[]>();
  for (const page of pages) {
    const list = map.get(page.parentId) ?? [];
    list.push(page);
    map.set(page.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.position - b.position || a.id - b.id);
  return map;
}

export function PageTree({
  spaceKey,
  pages,
  activeId,
  onMove,
  onAddChild,
}: {
  spaceKey: string;
  pages: TreePage[];
  activeId: number | null;
  onMove: (id: number, target: MoveTarget) => void;
  onAddChild: (parentId: number) => void;
}) {
  const children = useMemo(() => buildChildren(pages), [pages]);
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dragId, setDragId] = useState<number | null>(null);
  const [hint, setHint] = useState<{ id: number; zone: Zone } | null>(null);

  // Путь к открытой странице всегда раскрыт.
  useEffect(() => {
    if (!activeId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = byId.get(activeId)?.parentId ?? null;
      while (cur) {
        next.add(cur);
        cur = byId.get(cur)?.parentId ?? null;
      }
      return next;
    });
  }, [activeId, byId]);

  /** Сам перетаскиваемый узел и его потомки — бросать на них нельзя. */
  const forbidden = useMemo(() => {
    const set = new Set<number>();
    if (dragId === null) return set;
    const walk = (id: number) => {
      set.add(id);
      for (const c of children.get(id) ?? []) walk(c.id);
    };
    walk(dragId);
    return set;
  }, [dragId, children]);

  const drop = (targetId: number, zone: Zone) => {
    if (dragId === null || forbidden.has(targetId)) return;
    const target = byId.get(targetId);
    if (!target) return;
    if (zone === "inside") {
      const count = (children.get(targetId) ?? []).filter((p) => p.id !== dragId).length;
      onMove(dragId, { parentId: targetId, index: count });
      setExpanded((s) => new Set(s).add(targetId));
    } else {
      const siblings = (children.get(target.parentId) ?? []).filter((p) => p.id !== dragId);
      const idx = siblings.findIndex((p) => p.id === targetId);
      onMove(dragId, { parentId: target.parentId, index: zone === "before" ? idx : idx + 1 });
    }
  };

  const reset = () => {
    setDragId(null);
    setHint(null);
  };

  const renderLevel = (parentId: number | null, depth: number) => (
    <ul>
      {(children.get(parentId) ?? []).map((page) => {
        const kids = children.get(page.id) ?? [];
        const open = expanded.has(page.id);
        const h = hint?.id === page.id ? hint.zone : null;
        return (
          <li key={page.id}>
            <div
              className={`group relative flex items-center rounded ${h === "inside" ? "bg-accent-soft ring-1 ring-accent/40 dark:bg-accent/20" : ""} ${
                dragId === page.id ? "opacity-40" : ""
              }`}
              style={{ paddingLeft: depth * 14 }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(page.id));
                setDragId(page.id);
              }}
              onDragEnd={reset}
              onDragOver={(e) => {
                if (dragId === null || forbidden.has(page.id)) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const y = (e.clientY - rect.top) / rect.height;
                setHint({ id: page.id, zone: y < 0.25 ? "before" : y > 0.75 ? "after" : "inside" });
              }}
              onDragLeave={() => setHint((cur) => (cur?.id === page.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (hint?.id === page.id) drop(page.id, hint.zone);
                reset();
              }}
            >
              {h === "before" && <span className="pointer-events-none absolute -top-px left-0 right-0 h-0.5 bg-accent" />}
              {h === "after" && <span className="pointer-events-none absolute -bottom-px left-0 right-0 h-0.5 bg-accent" />}
              <button
                type="button"
                className={`flex h-6 w-5 shrink-0 items-center justify-center text-slate-400 ${kids.length ? "" : "invisible"}`}
                onClick={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(page.id)) n.delete(page.id);
                    else n.add(page.id);
                    return n;
                  })
                }
                aria-label={open ? "Свернуть" : "Развернуть"}
              >
                <IconChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
              <NavLink
                to={`/kb/${spaceKey}/${page.id}`}
                draggable={false}
                className={({ isActive }) =>
                  `min-w-0 flex-1 truncate rounded px-1.5 py-1 text-[13px] ${
                    isActive || page.id === activeId
                      ? "bg-accent-soft font-medium text-accent dark:bg-accent/20 dark:text-accent-bright"
                      : "text-slate-700 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`
                }
                title={page.title}
              >
                {page.title}
              </NavLink>
              <button
                type="button"
                className="icon-btn ml-0.5 h-6 w-6 opacity-0 focus:opacity-100 group-hover:opacity-100"
                title="Создать дочернюю страницу"
                aria-label="Создать дочернюю страницу"
                onClick={() => onAddChild(page.id)}
              >
                <IconPlus size={12} />
              </button>
            </div>
            {open && kids.length > 0 && renderLevel(page.id, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  const roots = children.get(null) ?? [];
  return (
    <div>
      {roots.length === 0 ? <p className="px-2 py-2 text-xs muted">Страниц пока нет</p> : renderLevel(null, 0)}
      {dragId !== null && (
        <div
          className={`mt-1 rounded border border-dashed px-2 py-1.5 text-center text-[11px] ${
            hint?.id === -1 ? "border-accent text-accent" : "border-slate-300 muted dark:border-neutral-700"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setHint({ id: -1, zone: "after" });
          }}
          onDragLeave={() => setHint(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId !== null) {
              const count = roots.filter((p) => p.id !== dragId).length;
              onMove(dragId, { parentId: null, index: count });
            }
            reset();
          }}
        >
          В корень пространства
        </div>
      )}
    </div>
  );
}
