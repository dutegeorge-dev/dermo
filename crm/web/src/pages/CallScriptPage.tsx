/** Справочник для звонков: список в порядке разговора, поиск, правка. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { type TopicDraft, TopicEditor } from "../components/calls/TopicEditor.tsx";
import { TopicView } from "../components/calls/TopicView.tsx";
import { useTopicSearch } from "../components/calls/useTopicSearch.ts";
import { IconArrowDown, IconArrowUp, IconGrip, IconPencil, IconPlus, IconSearch, IconTrash, IconX } from "../components/Icons.tsx";
import { Content } from "../components/Layout.tsx";
import { ConfirmDialog, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatRelative } from "../lib/format.ts";
import type { CallTopic } from "../lib/types.ts";

export type CallScriptResponse = {
  topics: CallTopic[];
  version: { version: number; note: string; createdAt: string; createdByName: string | null } | null;
};

export function CallScriptPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["calls"],
    queryFn: () => api<CallScriptResponse>("/calls"),
  });
  const topics = useMemo(() => data?.topics ?? [], [data]);

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openQ, setOpenQ] = useState<Set<string>>(new Set());

  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CallTopic | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);

  const search = useTopicSearch(topics, query);

  // Совпадения в вопросах и ответах раскрываются автоматически при каждом новом
  // запросе (но не при обновлении данных после правки — раскрытое не схлопывается).
  const searchKey = search.terms.join(" ");
  const loaded = data !== undefined;
  useEffect(() => {
    if (!loaded) return;
    setExpanded(new Set(search.autoRows));
    setOpenQ(new Set(search.autoQuestions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, loaded]);

  // Переход из глобального поиска: ?topic=<id>&q=<запрос>.
  const focusTopic = params.get("topic");
  useEffect(() => {
    const q = params.get("q");
    if (q !== null) setQuery(q);
  }, [params]);
  useEffect(() => {
    if (!focusTopic || topics.length === 0) return;
    setExpanded((s) => new Set(s).add(focusTopic));
    requestAnimationFrame(() =>
      document.getElementById(`topic-${focusTopic}`)?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTopic, loaded]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["calls"] });

  const saveTopic = async (topic: CallTopic, draft: TopicDraft) => {
    await api(`/calls/topics/${encodeURIComponent(topic.id)}`, {
      method: "PUT",
      body: { topic: draft, baseUpdatedAt: topic.updatedAt },
    });
    setEditingId(null);
    await refresh();
  };
  const addTopic = async (draft: TopicDraft) => {
    await api("/calls/topics", { method: "POST", body: { topic: draft } });
    setAdding(false);
    await refresh();
  };
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api("/calls/reorder", { method: "POST", body: { ids } }),
    onSuccess: async () => {
      await refresh();
      setOrder(null);
    },
  });

  // В режиме правки порядок меняется локально и сохраняется одной версией.
  const ordered = useMemo(() => {
    if (!order) return search.visible;
    const byId = new Map(topics.map((t) => [t.id, t]));
    return order.map((id) => byId.get(id)).filter((t): t is CallTopic => !!t);
  }, [order, topics, search.visible]);

  const move = (id: string, targetIndex: number) => {
    const ids = order ?? topics.map((t) => t.id);
    const next = ids.filter((x) => x !== id);
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
    setOrder(next.join() === topics.map((t) => t.id).join() ? null : next);
  };

  const searching = search.terms.length > 0;
  const orderDirty = order !== null;
  const busyRow = orderDirty || editingId !== null || adding;

  return (
    <Content>
      <PageHeader
        title="Справочник для звонков"
        meta={
          data?.version ? (
            <>
              Изменено {formatRelative(data.version.createdAt)}
              {data.version.createdByName ? ` · ${data.version.createdByName}` : ""} ·{" "}
              <Link to="/calls/history" className="link">
                история версий
              </Link>
            </>
          ) : null
        }
        actions={
          <button
            type="button"
            className={editMode ? "btn btn-primary" : "btn"}
            onClick={() => {
              setEditMode((v) => !v);
              setEditingId(null);
              setAdding(false);
              setOrder(null);
              setQuery("");
            }}
            disabled={orderDirty || editingId !== null || adding}
            title={orderDirty ? "Сначала сохраните или отмените порядок" : undefined}
          >
            {editMode ? "Готово" : (
              <>
                <IconPencil size={14} /> Редактировать
              </>
            )}
          </button>
        }
      />

      {isLoading && <Spinner />}
      <ErrorBox error={error} />

      {data && (
        <div className="panel overflow-hidden">
          {!editMode && (
            <div className="relative border-b border-slate-200 dark:border-neutral-800">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (params.has("topic") || params.has("q")) setParams({}, { replace: true });
                }}
                placeholder="Поиск по вопросам, темам и ответам"
                className="w-full bg-transparent py-2.5 pl-10 pr-9 text-sm outline-none placeholder:text-slate-400"
                aria-label="Поиск по справочнику"
              />
              {query && (
                <button
                  type="button"
                  className="icon-btn absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setQuery("")}
                  aria-label="Очистить поиск"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          )}

          {editMode && orderDirty && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-accent-soft/60 px-4 py-2 text-sm dark:border-neutral-800 dark:bg-accent/10">
              <span className="flex-1">Порядок строк изменён.</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={reorder.isPending} onClick={() => reorder.mutate(order)}>
                Сохранить порядок
              </button>
              <button type="button" className="btn btn-sm" disabled={reorder.isPending} onClick={() => setOrder(null)}>
                Отменить
              </button>
              {reorder.error && <div className="w-full"><ErrorBox error={reorder.error} /></div>}
            </div>
          )}

          <ul className="divide-line">
            {ordered.map((topic, index) => (
              <li
                key={topic.id}
                className={
                  dropHint?.id === topic.id
                    ? dropHint.after
                      ? "shadow-[inset_0_-2px_0_0_#1E3FD0]"
                      : "shadow-[inset_0_2px_0_0_#1E3FD0]"
                    : ""
                }
                onDragOver={(e) => {
                  if (!dragId || dragId === topic.id) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropHint({ id: topic.id, after: e.clientY > rect.top + rect.height / 2 });
                }}
                onDragLeave={() => setDropHint((h) => (h?.id === topic.id ? null : h))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dropHint) {
                    const ids = (order ?? topics.map((t) => t.id)).filter((x) => x !== dragId);
                    const at = ids.indexOf(dropHint.id) + (dropHint.after ? 1 : 0);
                    move(dragId, at);
                  }
                  setDragId(null);
                  setDropHint(null);
                }}
              >
                {editingId === topic.id ? (
                  <TopicEditor topic={topic} onSave={(draft) => saveTopic(topic, draft)} onCancel={() => setEditingId(null)} />
                ) : (
                  <TopicView
                    topic={topic}
                    terms={search.terms}
                    expanded={expanded.has(topic.id)}
                    openQuestions={
                      new Set(topic.qa.map((_, i) => i).filter((i) => openQ.has(`${topic.id}:${i}`)))
                    }
                    onToggle={() => setExpanded((s) => toggle(s, topic.id))}
                    onToggleQuestion={(i) => setOpenQ((s) => toggle(s, `${topic.id}:${i}`))}
                    controls={
                      editMode ? (
                        <>
                          <span
                            draggable={!editingId && !adding}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", topic.id);
                              setDragId(topic.id);
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setDropHint(null);
                            }}
                            className="icon-btn hidden cursor-grab sm:inline-flex"
                            title="Перетащите, чтобы переставить"
                          >
                            <IconGrip size={14} />
                          </span>
                          <button type="button" className="icon-btn" title="Выше" disabled={index === 0 || editingId !== null} onClick={() => move(topic.id, index - 1)}>
                            <IconArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Ниже"
                            disabled={index === ordered.length - 1 || editingId !== null}
                            onClick={() => move(topic.id, index + 1)}
                          >
                            <IconArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={orderDirty ? "Сначала сохраните порядок" : "Изменить строку"}
                            disabled={busyRow}
                            onClick={() => setEditingId(topic.id)}
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn hover:text-red-600"
                            title={orderDirty ? "Сначала сохраните порядок" : "Удалить строку"}
                            disabled={busyRow}
                            onClick={() => setDeleting(topic)}
                          >
                            <IconTrash size={14} />
                          </button>
                        </>
                      ) : undefined
                    }
                  />
                )}
              </li>
            ))}
          </ul>

          {searching && ordered.length === 0 && <p className="px-4 py-6 text-center text-sm muted">Ничего не найдено</p>}
          {!searching && topics.length === 0 && !adding && (
            <p className="px-4 py-6 text-center text-sm muted">Справочник пуст. Включите «Редактировать», чтобы добавить строку.</p>
          )}

          {editMode && (
            <div className="border-t border-slate-200 dark:border-neutral-800">
              {adding ? (
                <TopicEditor onSave={addTopic} onCancel={() => setAdding(false)} />
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-accent hover:bg-slate-50 disabled:opacity-50 dark:text-accent-bright dark:hover:bg-neutral-800/50"
                  onClick={() => setAdding(true)}
                  disabled={busyRow}
                >
                  <IconPlus size={14} /> Добавить строку
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Удалить строку?"
          message={
            <>
              Строка «{deleting.ask[0] || deleting.title}» и все её ответы будут удалены. Вернуть их можно через историю версий.
            </>
          }
          onConfirm={async () => {
            await api(`/calls/topics/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
            await refresh();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Content>
  );
}
