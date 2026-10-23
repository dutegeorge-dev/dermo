/**
 * Каталоги фабрик из рассылки (только админ): загрузить файлы пачкой (или папку) и скриншоты окна «Файлы»
 * WeChat (кто какой файл прислал) → ИИ в фоне определяет компанию и категории → проверка группами (файлы
 * одного контакта) → «Подтвердить выбранные»: новая или найденная фабрика, файлы — в её карточке.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { CATALOG_STATUSES, type CatalogStatus, normCategory } from "../../../../shared/factories.ts";
import { IconCheck, IconFile, IconHistory, IconTrash, IconUpload, IconX } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { api, apiUpload, errorMessage, fileUrl } from "../../lib/api.ts";
import { formatSize } from "../../lib/format.ts";
import type { CatalogGroup, CatalogItem, CatalogsData } from "../../lib/types.ts";

/** Правки группы на экране проверки (до подтверждения). */
type Edit = { selected: boolean; nameRu: string; categories: string[]; useMatch: boolean };

type UploadState = { total: number; done: number; skipped: number; duplicates: number; errors: string[]; current: string; part: number; running: boolean };

/** Служебные файлы из папки WeChat / Windows / macOS — не каталоги. */
const isJunk = (f: File) => /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i.test(f.name) || f.size === 0;

const METHOD: Record<string, string> = { text: "текст", images: "картинки", none: "не разбирали" };

function defaultEdit(group: CatalogGroup, items: CatalogItem[]): Edit {
  const results = items.map((i) => i.result).filter((r) => r !== null);
  const categories = [...new Set(results.flatMap((r) => r.categories))];
  const failed = items.some((i) => i.status === "failed");
  return {
    selected: Boolean(group.sender) && categories.length > 0 && !failed,
    nameRu: results.map((r) => r.nameRu).find(Boolean) ?? "",
    categories,
    useMatch: group.match !== null,
  };
}

export function CatalogsPage() {
  const queryClient = useQueryClient();
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const shotsRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["catalogs"],
    queryFn: () => api<CatalogsData>("/catalogs"),
    refetchInterval: (q) => {
      const c = q.state.data?.counts;
      return (c?.queued ?? 0) + (c?.processing ?? 0) > 0 ? 4000 : false;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["catalogs"] });

  async function uploadFiles(list: FileList | File[] | null) {
    const files = [...(list ?? [])].filter((f) => !isJunk(f));
    if (!files.length) return;
    setMessage(null);
    setError(null);
    const state: UploadState = { total: files.length, done: 0, skipped: 0, duplicates: 0, errors: [], current: "", part: 0, running: true };
    setUpload({ ...state });
    abort.current = new AbortController();
    try {
      // Уже загруженные (имя + размер) не шлём — можно спокойно загрузить ту же папку ещё раз.
      const exists: boolean[] = [];
      for (let i = 0; i < files.length; i += 500) {
        const chunk = files.slice(i, i + 500);
        exists.push(...(await api<{ exists: boolean[] }>("/catalogs/check", { method: "POST", body: { files: chunk.map((f) => ({ name: f.name, size: f.size })) } })).exists);
      }
      for (const [i, file] of files.entries()) {
        if (abort.current.signal.aborted) break;
        if (exists[i]) {
          state.skipped++;
          state.done++;
          setUpload({ ...state });
          continue;
        }
        state.current = file.name;
        state.part = 0;
        setUpload({ ...state });
        const form = new FormData();
        form.append("file", file, file.name);
        try {
          const r = await apiUpload<{ duplicate: boolean }>("/catalogs", form, (part) => setUpload({ ...state, part }), abort.current.signal);
          if (r.duplicate) state.duplicates++;
        } catch (e) {
          if (abort.current.signal.aborted) break;
          state.errors.push(`${file.name}: ${errorMessage(e)}`);
        }
        state.done++;
        setUpload({ ...state });
        if (state.done % 5 === 0) void refresh();
      }
    } catch (e) {
      setError(e);
    } finally {
      state.running = false;
      state.current = "";
      setUpload({ ...state });
      void refresh();
    }
  }

  async function uploadShots(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      let rows = 0;
      let matched = 0;
      const skipped: string[] = [];
      // По 8 скриншотов за запрос — иначе ответ ИИ получается слишком длинным.
      for (let i = 0; i < files.length; i += 8) {
        const form = new FormData();
        for (const f of files.slice(i, i + 8)) form.append("file", f, f.name);
        const r = await api<{ rows: number; matched: number; skipped: string[] }>("/catalogs/senders", { method: "POST", form });
        rows += r.rows;
        matched += r.matched;
        skipped.push(...r.skipped);
      }
      setMessage(`Со скриншотов прочитано файлов: ${rows}. Отправитель найден у каталогов: ${matched}.${skipped.length ? ` Пропущено: ${skipped.join("; ")}` : ""}`);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Spinner />;
  if (!data) return <ErrorBox error={loadError} />;

  const byId = new Map(data.items.map((i) => [i.id, i]));
  const groups = data.groups.map((g) => {
    const items = g.catalogIds.map((id) => byId.get(id)).filter((i): i is CatalogItem => i !== undefined);
    return { g, items, edit: edits[g.key] ?? defaultEdit(g, items) };
  });
  // Уверенные — сверху: их подтверждают одной кнопкой; остальным нужно внимание.
  groups.sort((a, b) => Number(b.edit.selected) - Number(a.edit.selected));
  const selected = groups.filter((x) => x.edit.selected);
  const setEdit = (key: string, base: Edit, patch: Partial<Edit>) => setEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? base), ...patch } }));
  const pending = data.items.filter((i) => i.status === "queued" || i.status === "processing");

  async function confirm() {
    await act(async () => {
      const r = await api<{ created: number; updated: number; errors: string[] }>("/catalogs/confirm", {
        method: "POST",
        body: {
          groups: selected.map(({ g, edit }) => ({ catalogIds: g.catalogIds, factoryId: edit.useMatch && g.match ? g.match.id : null, nameRu: edit.nameRu, categories: edit.categories })),
        },
      });
      setEdits({});
      setMessage(`Новых фабрик: ${r.created}, дополнено: ${r.updated}.${r.errors.length ? ` Не получилось: ${r.errors.join("; ")}` : ""}`);
      void queryClient.invalidateQueries({ queryKey: ["factories"] });
    });
  }

  return (
    <Content wide>
      <PageHeader
        title="Каталоги фабрик"
        meta="Файлы из рассылки → ИИ определяет компанию и категории → вы проверяете и подтверждаете"
        actions={
          <Link to="/factories" className="btn">
            Все фабрики
          </Link>
        }
      />
      {!data.ai && <div className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">ИИ не подключён — файлы сохранятся, категории укажете вручную.</div>}

      <section className="panel mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={upload?.running} onClick={() => filesRef.current?.click()}>
            <IconUpload /> Выбрать файлы
          </button>
          <button type="button" className="btn" disabled={upload?.running} onClick={() => folderRef.current?.click()}>
            Выбрать папку
          </button>
          <button type="button" className="btn" disabled={busy || !data.ai} onClick={() => shotsRef.current?.click()} title="Окно «Файлы» (Manage Files) WeChat: имя файла и «отправитель | чат»">
            Скриншоты «Файлы» WeChat
          </button>
          {upload?.running && (
            <button type="button" className="btn btn-ghost" onClick={() => abort.current?.abort()}>
              <IconX /> Остановить
            </button>
          )}
          <input ref={filesRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files).finally(() => (e.target.value = ""))} />
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(e) => void uploadFiles(e.target.files).finally(() => (e.target.value = ""))}
          />
          <input ref={shotsRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => void uploadShots(e.target.files).finally(() => (e.target.value = ""))} />
        </div>
        <p className="mt-2 text-xs muted">
          Каталоги — PDF (и сканы), Word, Excel, PowerPoint, картинки. Скриншоты окна «Файлы» WeChat (13–15 файлов на экран) — чтобы знать, какой контакт прислал
          каталог; их можно загрузить до или после файлов. Ту же папку можно загрузить ещё раз — уже загруженные файлы пропустятся.
        </p>
        {upload && (
          <div className="mt-2 text-sm">
            {upload.running ? "Загружается" : "Загружено"}: {upload.done} из {upload.total}
            {upload.skipped > 0 && ` · уже были: ${upload.skipped}`}
            {upload.duplicates > 0 && ` · повторы: ${upload.duplicates}`}
            {upload.current && (
              <span className="muted">
                {" "}
                · {upload.current} — {Math.round(upload.part * 100)} %
              </span>
            )}
            {upload.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-red-700 dark:text-red-400">
                {upload.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {data.items.length + data.done.length > 0 && <span className="muted">Файлы:</span>}
          {(Object.keys(CATALOG_STATUSES) as CatalogStatus[]).map((s) =>
            data.counts[s] ? (
              <span key={s} className={s === "failed" ? "text-red-700 dark:text-red-400" : ""}>
                {CATALOG_STATUSES[s]}: <b>{data.counts[s]}</b>
              </span>
            ) : null,
          )}
          {pending.length > 0 && <span className="muted">разбор идёт в фоне — страницу можно закрыть</span>}
          {(data.counts.failed ?? 0) > 0 && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act(() => api("/catalogs/all/retry", { method: "POST" }))}>
              <IconHistory /> Повторить все с ошибкой
            </button>
          )}
        </div>
        {busy && <Spinner label="Подождите…" />}
        {message && <div className="mt-2 rounded-md bg-green-50 p-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">{message}</div>}
        <ErrorBox error={error} />
      </section>

      <datalist id="catalog-categories">
        {data.categories.map((c) => (
          <option key={c.c} value={c.c} />
        ))}
      </datalist>
      <datalist id="catalog-senders">
        {data.senders.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {groups.length > 0 && (
        <section className="mb-4">
          <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 bg-white/90 py-2 backdrop-blur dark:bg-neutral-950/90">
            <h2 className="mr-auto text-base font-semibold">Контакты на проверке: {groups.length}</h2>
            <button type="button" className="btn btn-sm" onClick={() => setEdits(Object.fromEntries(groups.map((x) => [x.g.key, { ...x.edit, selected: true }])))}>
              Выбрать все
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEdits(Object.fromEntries(groups.map((x) => [x.g.key, { ...x.edit, selected: false }])))}>
              Снять все
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={() => void confirm()}>
              <IconCheck /> Подтвердить выбранные ({selected.length})
            </button>
          </div>
          <ul className="space-y-2">
            {groups.map(({ g, items, edit }) => (
              <GroupRow
                key={g.key}
                group={g}
                items={items}
                edit={edit}
                busy={busy}
                onEdit={(patch) => setEdit(g.key, edit, patch)}
                onSender={(sender) => void act(() => Promise.all(items.map((i) => api(`/catalogs/${i.id}`, { method: "PATCH", body: { sender } }))))}
                onRetry={(id) => void act(() => api(`/catalogs/${id}/retry`, { method: "POST" }))}
                onDelete={(id) => void act(() => api(`/catalogs/${id}`, { method: "DELETE" }))}
              />
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="panel mb-4 p-3 text-sm">
          <h2 className="mb-1 font-semibold">В очереди и разбирается: {pending.length}</h2>
          <ul className="max-h-40 overflow-auto text-xs muted">
            {pending.slice(0, 200).map((i) => (
              <li key={i.id}>
                {i.status === "processing" ? "⏳ " : ""}
                {i.filename} · {formatSize(i.size)}
                {i.sender && ` · ${i.sender}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CategoriesBlock categories={data.categories} busy={busy} onRename={(from, to) => void act(() => api("/factories/categories/rename", { method: "POST", body: { from, to } }))} />

      {data.done.length > 0 && (
        <section className="panel p-3 text-sm">
          <h2 className="mb-1 font-semibold">Недавно подтверждённые</h2>
          <ul className="space-y-0.5 text-xs">
            {data.done.map((i) => (
              <li key={i.id} className="truncate">
                {i.filename} → {i.factoryId && <Link to={`/factories/${i.factoryId}`} className="text-blue-700 hover:underline dark:text-blue-400">{i.factoryNameRu || i.factoryName}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Content>
  );
}

function GroupRow({
  group,
  items,
  edit,
  busy,
  onEdit,
  onSender,
  onRetry,
  onDelete,
}: {
  group: CatalogGroup;
  items: CatalogItem[];
  edit: Edit;
  busy: boolean;
  onEdit: (patch: Partial<Edit>) => void;
  onSender: (sender: string) => void;
  onRetry: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [sender, setSender] = useState(group.sender ?? "");
  const [category, setCategory] = useState("");
  const result = items.map((i) => i.result).find((r) => r !== null) ?? null;
  const addCategory = () => {
    const c = normCategory(category);
    if (c && !edit.categories.includes(c)) onEdit({ categories: [...edit.categories, c] });
    setCategory("");
  };
  const contacts = result ? [result.company, result.location, result.phone, result.website, result.email].filter(Boolean).join(" · ") : "";

  return (
    <li className={`panel flex gap-3 p-3 text-sm ${edit.selected ? "border-blue-400" : ""}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={edit.selected} onChange={(e) => onEdit({ selected: e.target.checked })} aria-label="Подтвердить" />
      <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          {group.sender ? (
            <div className="font-medium">
              {group.sender}
              {group.chat && group.chat !== group.sender && <span className="text-xs font-normal muted"> · чат {group.chat}</span>}
            </div>
          ) : (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (sender.trim()) onSender(sender.trim());
              }}
            >
              <input className="input py-1 text-sm" list="catalog-senders" placeholder="Кто прислал? (контакт WeChat)" value={sender} onChange={(e) => setSender(e.target.value)} />
              <button type="submit" className="btn btn-sm" disabled={busy || !sender.trim()}>
                OK
              </button>
            </form>
          )}
          <ul className="mt-1 space-y-0.5">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-1.5 text-xs">
                <IconFile className="shrink-0 text-slate-400" />
                {i.attachmentId ? (
                  <a href={fileUrl(i.attachmentId)} target="_blank" rel="noreferrer" className="truncate text-blue-700 hover:underline dark:text-blue-400">
                    {i.filename}
                  </a>
                ) : (
                  <span className="truncate">{i.filename}</span>
                )}
                <span className="shrink-0 muted">
                  {formatSize(i.size)}
                  {i.method && ` · ${METHOD[i.method]}`}
                  {i.pages ? `, ${i.pages} стр.` : ""}
                </span>
                <button type="button" className="shrink-0 text-slate-400 hover:text-blue-600" title="Разобрать заново" disabled={busy} onClick={() => onRetry(i.id)}>
                  <IconHistory size={14} />
                </button>
                <button type="button" className="shrink-0 text-slate-400 hover:text-red-600" title="Удалить файл" disabled={busy} onClick={() => onDelete(i.id)}>
                  <IconTrash size={14} />
                </button>
              </li>
            ))}
          </ul>
          {items
            .filter((i) => i.note)
            .map((i) => (
              <div key={i.id} className={`mt-1 text-xs ${i.status === "failed" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                {items.length > 1 && `${i.filename}: `}
                {i.note}
              </div>
            ))}
          {contacts && <div className="mt-1 text-xs muted">{contacts}</div>}
          {result?.notes && <div className="mt-0.5 text-xs muted">{result.notes}</div>}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            {edit.categories.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                {c}
                <button type="button" aria-label={`Убрать ${c}`} onClick={() => onEdit({ categories: edit.categories.filter((x) => x !== c) })}>
                  <IconX size={12} />
                </button>
              </span>
            ))}
            <input
              className="input w-40 py-0.5 text-xs"
              list="catalog-categories"
              placeholder="+ категория"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onBlur={addCategory}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCategory();
                }
              }}
            />
          </div>
          <input className="input py-1 text-sm" placeholder="Коротко по-русски: «Chengda — ковролин»" value={edit.nameRu} onChange={(e) => onEdit({ nameRu: e.target.value })} />
          <select className="input py-1 text-sm" value={edit.useMatch && group.match ? "match" : "new"} onChange={(e) => onEdit({ useMatch: e.target.value === "match" })}>
            <option value="new">Новая фабрика{group.sender ? ` «${group.sender}»` : ""}</option>
            {group.match && (
              <option value="match">
                Дополнить фабрику «{group.match.nameRu || group.match.name}» — совпало: {group.match.reason}
              </option>
            )}
          </select>
        </div>
      </div>
    </li>
  );
}

function CategoriesBlock({ categories, busy, onRename }: { categories: { c: string; n: number }[]; busy: boolean; onRename: (from: string, to: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!categories.length) return null;
  return (
    <section className="panel mb-4 p-3 text-sm">
      <h2 className="mb-1 font-semibold">Категории ({categories.length})</h2>
      <p className="mb-2 text-xs muted">Рядом — сколько фабрик в категории. ИИ заводит категории сам. Получилось два названия одного товара — переименуйте одно в другое, они объединятся во всех фабриках.</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {categories.map((c) => (
          <button key={c.c} type="button" className="rounded-full border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800" onClick={() => setFrom(c.c)}>
            {c.c} <span className="muted">{c.n || "новая"}</span>
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(from, to);
          setFrom("");
          setTo("");
        }}
      >
        <input className="input w-48 py-1 text-sm" list="catalog-categories" placeholder="Категория" value={from} onChange={(e) => setFrom(e.target.value)} />
        →
        <input className="input w-48 py-1 text-sm" list="catalog-categories" placeholder="Новое название или другая категория" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={busy || !from.trim() || !to.trim()}>
          Переименовать / объединить
        </button>
      </form>
    </section>
  );
}
