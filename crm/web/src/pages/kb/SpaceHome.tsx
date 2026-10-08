/** Главная пространства: описание, страницы верхнего уровня, настройки. */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { IconPlus } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, EmptyState, ErrorBox, Modal } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatRelative, plural } from "../../lib/format.ts";
import { useSpace } from "./SpaceLayout.tsx";

export function SpaceHome() {
  const { space, pages, createPage } = useSpace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [error, setError] = useState<unknown>(null);

  const roots = pages.filter((p) => p.parentId === null).sort((a, b) => a.position - b.position);
  const recent = [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  return (
    <Content>
      <div className="mb-1 text-xs muted">
        <Link to="/kb" className="hover:underline">База знаний</Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{space.name}</h1>
          {space.description && <p className="mt-1 text-sm muted">{space.description}</p>}
          <p className="mt-1 text-xs muted">
            {pages.length} {plural(pages.length, "страница", "страницы", "страниц")} · ключ {space.key}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => setEditing(true)}>Настройки</button>
          <button type="button" className="btn btn-primary" onClick={() => createPage(null)}>
            <IconPlus size={14} /> Страница
          </button>
        </div>
      </div>

      {roots.length === 0 ? (
        <EmptyState title="В пространстве пока нет страниц">Создайте первую страницу кнопкой «Страница».</EmptyState>
      ) : (
        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Разделы</h2>
            <ul className="divide-line border-y border-slate-200 dark:border-neutral-800">
              {roots.map((p) => (
                <li key={p.id}>
                  <Link to={`/kb/${space.key}/${p.id}`} className="block py-2 text-sm hover:text-accent">{p.title}</Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Недавно изменённые</h2>
            <ul className="divide-line border-y border-slate-200 dark:border-neutral-800">
              {recent.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-2 py-2">
                  <Link to={`/kb/${space.key}/${p.id}`} className="truncate text-sm hover:text-accent">{p.title}</Link>
                  <span className="shrink-0 text-xs muted">{formatRelative(p.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {editing && (
        <Modal
          title="Настройки пространства"
          onClose={() => setEditing(false)}
          footer={
            <>
              {user?.role === "admin" && (
                <button type="button" className="btn btn-ghost mr-auto text-red-600" onClick={() => setDeleting(true)}>
                  Удалить пространство
                </button>
              )}
              <button type="button" className="btn" onClick={() => setEditing(false)}>Отмена</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await api(`/kb/spaces/${space.id}`, { method: "PATCH", body: { name, description } });
                    await queryClient.invalidateQueries({ queryKey: ["space", space.key] });
                    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
                    setEditing(false);
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Сохранить
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="sp-name">Название</label>
              <input id="sp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="sp-desc">Описание</label>
              <textarea id="sp-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <ErrorBox error={error} />
          </div>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Удалить пространство?"
          message={
            <>
              Пространство «{space.name}» и все его страницы ({pages.length}) вместе с вложениями будут удалены без возможности
              восстановления.
            </>
          }
          onConfirm={async () => {
            await api(`/kb/spaces/${space.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["spaces"] });
            navigate("/kb");
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Content>
  );
}
