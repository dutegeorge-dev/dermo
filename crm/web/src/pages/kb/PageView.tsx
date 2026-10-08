/** Страница базы знаний: крошки, заголовок, кто изменил, содержимое, вложения. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { IconFile, IconHistory, IconPaperclip, IconPencil, IconPlus, IconTrash } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { DocView } from "../../components/RichText.tsx";
import { ConfirmDialog, ErrorBox, Spinner } from "../../components/ui.tsx";
import { api, fileUrl } from "../../lib/api.ts";
import { formatDateTime, formatRelative, formatSize } from "../../lib/format.ts";
import type { Attachment, PageResponse } from "../../lib/types.ts";
import { useSpace } from "./SpaceLayout.tsx";

export function Breadcrumbs({ data }: { data: PageResponse }) {
  return (
    <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs muted" aria-label="Путь">
      <Link to="/kb" className="hover:underline">База знаний</Link>
      <span>/</span>
      <Link to={`/kb/${data.space.key}`} className="hover:underline">{data.space.name}</Link>
      {data.breadcrumbs.map((b) => (
        <span key={b.id} className="flex items-center gap-1">
          <span>/</span>
          <Link to={`/kb/${data.space.key}/${b.id}`} className="hover:underline">{b.title}</Link>
        </span>
      ))}
    </nav>
  );
}

export function usePage(pageId: number) {
  return useQuery({
    queryKey: ["page", pageId],
    queryFn: () => api<PageResponse>(`/kb/pages/${pageId}`),
  });
}

export function PageView() {
  const { pageId } = useParams();
  const id = Number(pageId);
  const { space, pages, createPage } = useSpace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = usePage(id);
  const [deleting, setDeleting] = useState(false);
  const [deletingFile, setDeletingFile] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (isLoading) return <Content><Spinner /></Content>;
  if (error || !data) return <Content><ErrorBox error={error} /></Content>;

  const { page } = data;
  const childCount = (() => {
    let n = 0;
    const walk = (pid: number) => pages.filter((p) => p.parentId === pid).forEach((p) => { n++; walk(p.id); });
    walk(page.id);
    return n;
  })();

  const upload = async (files: File[]) => {
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        await api(`/kb/pages/${page.id}/attachments`, { method: "POST", form });
      }
      await queryClient.invalidateQueries({ queryKey: ["page", page.id] });
    } catch (e) {
      setUploadError(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Content>
      <Breadcrumbs data={data} />
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <h1 className="page-title min-w-0 break-words text-2xl">{page.title}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Link to={`/kb/${space.key}/${page.id}/edit`} className="btn btn-primary">
            <IconPencil size={14} /> Редактировать
          </Link>
          <button type="button" className="btn" title="Дочерняя страница" onClick={() => createPage(page.id)}>
            <IconPlus size={14} />
            <span className="hidden sm:inline">Дочерняя</span>
          </button>
          <button type="button" className="btn" title="Удалить страницу" aria-label="Удалить страницу" onClick={() => setDeleting(true)}>
            <IconTrash size={14} />
          </button>
        </div>
      </div>
      <p className="mb-6 text-xs muted">
        Изменил{page.updatedByName ? ` ${page.updatedByName}` : "и"} {formatRelative(page.updatedAt)} ·{" "}
        <Link to={`/kb/${space.key}/${page.id}/history`} className="link inline-flex items-center gap-1">
          <IconHistory size={12} /> версия {page.version}
        </Link>
        {page.createdByName && ` · создал ${page.createdByName} ${formatDateTime(page.createdAt)}`}
      </p>

      <DocView doc={page.content} />

      <section className="mt-10 border-t border-slate-200 pt-4 dark:border-neutral-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <IconPaperclip size={14} /> Вложения {data.attachments.length > 0 && <span className="font-normal muted">{data.attachments.length}</span>}
          </h2>
          <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Загрузка…" : "Прикрепить файл"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void upload(files);
            }}
          />
        </div>
        <ErrorBox error={uploadError} />
        {data.attachments.length === 0 ? (
          <p className="text-xs muted">Файлов нет.</p>
        ) : (
          <ul className="divide-line">
            {data.attachments.map((file) => (
              <li key={file.id} className="group flex items-center gap-2 py-1.5 text-sm">
                <IconFile size={14} className="shrink-0 text-slate-400" />
                <a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="min-w-0 truncate link">
                  {file.filename}
                </a>
                <span className="shrink-0 text-xs muted">
                  {formatSize(file.size)} · {file.createdByName ?? "—"} · {formatRelative(file.createdAt)}
                </span>
                <button
                  type="button"
                  className="icon-btn ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="Удалить файл"
                  aria-label="Удалить файл"
                  onClick={() => setDeletingFile(file)}
                >
                  <IconTrash size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {deleting && (
        <ConfirmDialog
          title="Удалить страницу?"
          message={
            <>
              Страница «{page.title}»{childCount > 0 ? ` и ${childCount} дочерн. страниц` : ""} будут удалены вместе с историей и
              вложениями. Это действие нельзя отменить.
            </>
          }
          onConfirm={async () => {
            await api(`/kb/pages/${page.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["space", space.key] });
            await queryClient.invalidateQueries({ queryKey: ["spaces"] });
            navigate(page.parentId ? `/kb/${space.key}/${page.parentId}` : `/kb/${space.key}`);
          }}
          onClose={() => setDeleting(false)}
        />
      )}
      {deletingFile && (
        <ConfirmDialog
          title="Удалить файл?"
          message={`Файл «${deletingFile.filename}» будет удалён. Если это картинка со страницы, на странице она пропадёт.`}
          onConfirm={async () => {
            await api(`/files/${deletingFile.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["page", page.id] });
          }}
          onClose={() => setDeletingFile(null)}
        />
      )}
    </Content>
  );
}
