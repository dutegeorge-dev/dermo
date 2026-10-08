/** Редактирование страницы: заголовок + TipTap. Ctrl+S — сохранить. */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";

import { Content } from "../../components/Layout.tsx";
import { DocEditor } from "../../components/RichText.tsx";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { api, fileUrl } from "../../lib/api.ts";
import type { Doc } from "../../lib/types.ts";
import { Breadcrumbs, usePage } from "./PageView.tsx";
import { useSpace } from "./SpaceLayout.tsx";

export function PageEdit() {
  const { pageId } = useParams();
  const id = Number(pageId);
  const { space } = useSpace();
  const { data, isLoading, error } = usePage(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [title, setTitle] = useState<string | null>(null);
  const doc = useRef<Doc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    if (data && title === null) setTitle(data.page.title);
  }, [data, title]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savedRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("Есть несохранённые изменения. Уйти без сохранения?")) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!data || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api(`/kb/pages/${id}`, {
        method: "PUT",
        body: { title: title ?? data.page.title, content: doc.current ?? data.page.content, baseVersion: data.page.version },
      });
      savedRef.current = true;
      await queryClient.invalidateQueries({ queryKey: ["page", id] });
      await queryClient.invalidateQueries({ queryKey: ["space", space.key] });
      navigate(`/kb/${space.key}/${id}`);
    } catch (e) {
      setSaveError(e);
      setSaving(false);
    }
  }, [data, saving, id, title, queryClient, space.key, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  if (isLoading) return <Content><Spinner /></Content>;
  if (error || !data) return <Content><ErrorBox error={error} /></Content>;

  const uploadImage = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { attachment } = await api<{ attachment: { id: string } }>(`/kb/pages/${id}/attachments`, { method: "POST", form });
    void queryClient.invalidateQueries({ queryKey: ["page", id] });
    return fileUrl(attachment.id);
  };

  return (
    <Content wide>
      <Breadcrumbs data={data} />
      <input
        className="mb-4 w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight outline-none placeholder:text-slate-300"
        value={title ?? ""}
        placeholder="Заголовок страницы"
        aria-label="Заголовок"
        onChange={(e) => {
          setTitle(e.target.value);
          setDirty(true);
        }}
      />
      <DocEditor
        initial={data.page.content}
        uploadImage={uploadImage}
        onError={setSaveError}
        onChange={(next) => {
          doc.current = next;
          setDirty(true);
        }}
      />
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 dark:border-neutral-800 dark:bg-neutral-900/95">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !title?.trim()}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        <Link to={`/kb/${space.key}/${id}`} className="btn">
          Отмена
        </Link>
        <span className="text-xs muted">{dirty ? "Есть несохранённые изменения · Ctrl+S" : "Изменений нет"}</span>
        {saveError != null && <div className="w-full"><ErrorBox error={saveError} /></div>}
      </div>
    </Content>
  );
}
