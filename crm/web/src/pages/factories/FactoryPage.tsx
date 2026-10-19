/**
 * Фабрика: новая (/factories/new) и карточка. Работник кидает скриншоты WeChat, фото и прайсы — ИИ заполняет
 * анкету и цены, работник проверяет и сохраняет. Дубли ловятся по WeChat ID, телефону и имени.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { EMPTY_PROFILE, FACTORY_FILE_LABELS, FACTORY_STATUSES, type FactoryFileLabel, type FactoryProfile, type Offer, PROFILE_QUESTIONS, YES_NO, type YesNo } from "../../../../shared/factories.ts";
import { useDirectory } from "../../components/crm/common.tsx";
import { OffersEditor } from "../../components/factories/common.tsx";
import { IconFile, IconSparkles, IconTrash, IconUpload, IconX } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { useAiEnabled } from "../../lib/ai.ts";
import { api, errorMessage, fileUrl } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatSize } from "../../lib/format.ts";
import type { FactoryResponse } from "../../lib/types.ts";

type Form = {
  name: string;
  nameRu: string;
  wechatId: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  location: string;
  categories: string;
  status: string;
  profile: FactoryProfile;
  notes: string;
  foundBy: number | null;
  offers: Offer[];
};

type Pending = { file: File; label: FactoryFileLabel; url: string | null };
type Draft = Partial<Omit<Form, "categories">> & { categories?: string[]; skipped?: string[] };

const EMPTY: Form = {
  name: "",
  nameRu: "",
  wechatId: "",
  contactName: "",
  phone: "",
  email: "",
  website: "",
  location: "",
  categories: "",
  status: "new",
  profile: EMPTY_PROFILE,
  notes: "",
  foundBy: null,
  offers: [],
};

const guessLabel = (f: File): FactoryFileLabel => (f.type.startsWith("image/") ? "screenshot" : "catalog");

export function FactoryPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const q = useQuery({ queryKey: ["factory", id], queryFn: () => api<FactoryResponse>(`/factories/${id}`), enabled: !isNew });
  if (!isNew && !q.data) return <Content>{q.error ? <ErrorBox error={q.error} /> : <Spinner />}</Content>;
  return <FactoryForm key={id ?? "new"} data={isNew ? null : q.data!} />;
}

function FactoryForm({ data }: { data: FactoryResponse | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const aiEnabled = useAiEnabled();
  const directory = useDirectory();
  const f = data?.factory;
  const [form, setForm] = useState<Form>(() =>
    f
      ? {
          name: f.name,
          nameRu: f.nameRu ?? "",
          wechatId: f.wechatId ?? "",
          contactName: f.contactName ?? "",
          phone: f.phone ?? "",
          email: f.email ?? "",
          website: f.website ?? "",
          location: f.location ?? "",
          categories: f.categories.join(", "),
          status: f.status,
          profile: { ...EMPTY_PROFILE, ...f.profile },
          notes: f.notes,
          foundBy: f.foundBy,
          offers: data.offers,
        }
      : EMPTY,
  );
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Form>) => setForm((x) => ({ ...x, ...patch }));
  const setProfile = (key: keyof FactoryProfile, value: string) => set({ profile: { ...form.profile, [key]: value } });

  // Дубли: по WeChat ID, телефону, имени.
  const dupParams = new URLSearchParams({ wechatId: form.wechatId.trim(), phone: form.phone.trim(), name: form.name.trim(), except: String(f?.id ?? "") });
  const [dupKey, setDupKey] = useState(dupParams.toString());
  useEffect(() => {
    const t = setTimeout(() => setDupKey(dupParams.toString()), 500);
    return () => clearTimeout(t);
  });
  const dups = useQuery({
    queryKey: ["factories", "duplicates", dupKey],
    queryFn: () => api<{ duplicates: { id: number | null; name: string | null; foundByName: string | null }[] }>(`/factories/duplicates?${dupKey}`),
    enabled: !!(form.wechatId.trim() || form.phone.trim() || form.name.trim()),
  });

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const added = [...list].map((file) => ({ file, label: guessLabel(file), url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }));
    setPending((p) => [...p, ...added]);
    // Новая фабрика с пустой формой — сразу распознаём.
    if (aiEnabled && !f && !form.name && !form.offers.length) void recognize(added.map((a) => a.file));
  };
  useEffect(() => () => pending.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** ИИ заполняет пустые поля и добавляет цены; заполненное вручную не трогает. */
  const recognize = async (files: File[]) => {
    setBusy("ai");
    setError(null);
    setAiNote(null);
    try {
      const fd = new FormData();
      for (const file of files) fd.append("file", file);
      const { draft } = await api<{ draft: Draft }>("/ai/recognize-factory", { method: "POST", form: fd });
      setForm((x) => {
        const pick = (k: "name" | "nameRu" | "wechatId" | "contactName" | "phone" | "email" | "website" | "location") => x[k] || (draft[k] as string | null) || "";
        const profile = { ...x.profile };
        for (const k of Object.keys(EMPTY_PROFILE) as (keyof FactoryProfile)[]) {
          const v = draft.profile?.[k];
          if (!profile[k] && v) (profile as Record<string, string>)[k] = v;
        }
        const cats = new Set([...x.categories.split(",").map((c) => c.trim()).filter(Boolean), ...(draft.categories ?? [])]);
        return {
          ...x,
          name: pick("name"),
          nameRu: pick("nameRu"),
          wechatId: pick("wechatId"),
          contactName: pick("contactName"),
          phone: pick("phone"),
          email: pick("email"),
          website: pick("website"),
          location: pick("location"),
          categories: [...cats].join(", "),
          profile,
          notes: x.notes || draft.notes || "",
          offers: [...x.offers, ...(draft.offers ?? [])],
        };
      });
      setAiNote(`Заполнено ИИ — проверьте.${draft.skipped?.length ? ` Не разобраны: ${draft.skipped.join("; ")}.` : ""}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const payload = { ...form, categories: form.categories.split(","), foundBy: user?.role === "admin" ? form.foundBy : undefined };
      const res = f
        ? await api<{ factory: { id: number } }>(`/factories/${f.id}`, { method: "PATCH", body: payload })
        : await api<{ factory: { id: number } }>("/factories", { method: "POST", body: payload });
      const fid = res.factory.id;
      for (const p of pending) {
        const fd = new FormData();
        fd.append("file", p.file);
        await api(`/factories/${fid}/files?label=${p.label}`, { method: "POST", form: fd });
      }
      setPending([]);
      void queryClient.invalidateQueries({ queryKey: ["factories"] });
      await queryClient.invalidateQueries({ queryKey: ["factory", String(fid)] });
      if (!f) navigate(`/factories/${fid}`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      void queryClient.invalidateQueries({ queryKey: ["factories"] });
      await queryClient.invalidateQueries({ queryKey: ["factory", String(f?.id)] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const text = (key: "name" | "nameRu" | "wechatId" | "contactName" | "phone" | "email" | "website" | "location", label: string, placeholder = "") => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={form[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );
  const canDelete = f && (user?.role === "admin" || (!f.counterpartyId && f.foundBy === user?.id));
  const images = data?.files.filter((x) => x.mime.startsWith("image/")) ?? [];
  const docs = data?.files.filter((x) => !x.mime.startsWith("image/")) ?? [];
  const dupList = (dups.data?.duplicates ?? []).filter((d) => d.id !== f?.id);

  return (
    <Content wide>
      <div className="mb-2 text-sm">
        <Link to="/factories" className="link">Фабрики</Link>
      </div>
      <PageHeader
        title={f ? f.nameRu || f.name : "Новая фабрика"}
        meta={
          f ? (
            <>
              {f.nameRu && <span className="mr-2">{f.name}</span>}
              {data?.foundBy && <span className="mr-2">нашёл(а) {data.foundBy.name}</span>}
              {data?.supplier && (
                <Link to={`/suppliers/${data.supplier.id}`} className="link">
                  поставщик «{data.supplier.name}»
                </Link>
              )}
            </>
          ) : (
            "Скиньте скриншоты профиля и переписки в WeChat, фото и прайсы — ИИ заполнит карточку"
          )
        }
        actions={
          f && (
            <>
              {!f.counterpartyId && (
                <button type="button" className="btn" disabled={!!busy} onClick={() => void act("supplier", () => api(`/factories/${f.id}/supplier`, { method: "POST" }))} title="Договор подписан — фабрика станет поставщиком, её увидят все">
                  Сделать поставщиком
                </button>
              )}
              {canDelete && (
                <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => setConfirmDelete(true)}>
                  <IconTrash /> Удалить
                </button>
              )}
            </>
          )
        }
      />

      <div className="space-y-4">
        <section
          className="panel p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-semibold">Скриншоты, фото, каталоги</h2>
            {aiEnabled && pending.length > 0 && (
              <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void recognize(pending.map((p) => p.file))}>
                <IconSparkles size={14} /> {busy === "ai" ? "Распознаём…" : "Заполнить по файлам"}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()}>
              <IconUpload size={14} /> Добавить файлы
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept="image/*,.pdf,.xlsx,.docx,.txt"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {busy === "ai" && <p className="mb-2 text-sm muted">ИИ читает файлы — 10–30 секунд…</p>}
          {aiNote && <p className="mb-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-300">{aiNote}</p>}
          {pending.length === 0 && images.length === 0 && docs.length === 0 && (
            <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm muted dark:border-neutral-700">
              Перетащите сюда скриншоты WeChat (профиль, переписка), фото товара, прайсы и каталоги
            </p>
          )}
          {pending.length > 0 && (
            <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {pending.map((p, i) => (
                <li key={i} className="relative rounded-md border border-dashed border-blue-300 p-1.5 text-xs dark:border-blue-800">
                  <button type="button" className="icon-btn absolute right-1 top-1 bg-white/80 dark:bg-neutral-900/80" aria-label="Убрать" onClick={() => setPending((x) => x.filter((_, j) => j !== i))}>
                    <IconX size={12} />
                  </button>
                  {p.url ? <img src={p.url} alt="" className="mb-1 h-24 w-full rounded object-cover" /> : <div className="mb-1 flex h-24 items-center justify-center"><IconFile size={24} /></div>}
                  <div className="truncate" title={p.file.name}>{p.file.name}</div>
                  <select className="input mt-1 px-1 py-0.5 text-xs" value={p.label} onChange={(e) => setPending((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value as FactoryFileLabel } : y)))}>
                    {Object.entries(FACTORY_FILE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {pending.length > 0 && <p className="mb-3 text-xs muted">Новые файлы сохранятся вместе с карточкой.</p>}
          {images.length > 0 && (
            <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {images.map((x) => (
                <li key={x.id} className="group relative">
                  <a href={fileUrl(x.id)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(x.id)} alt={x.filename} loading="lazy" className="h-24 w-full rounded object-cover" />
                  </a>
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{FACTORY_FILE_LABELS[x.label as FactoryFileLabel] ?? "Файл"}</span>
                  <button type="button" className="icon-btn absolute right-1 top-1 hidden bg-white/80 group-hover:inline-flex dark:bg-neutral-900/80" aria-label="Удалить файл" onClick={() => void act("file", () => api(`/files/${x.id}`, { method: "DELETE" }))}>
                    <IconTrash size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {docs.length > 0 && (
            <ul className="divide-line text-sm">
              {docs.map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-1.5">
                  <IconFile size={14} />
                  <a href={fileUrl(x.id)} target="_blank" rel="noreferrer" className="link truncate">{x.filename}</a>
                  <span className="text-xs muted">{FACTORY_FILE_LABELS[x.label as FactoryFileLabel] ?? ""} · {formatSize(x.size)}</span>
                  <button type="button" className="icon-btn ml-auto" aria-label="Удалить файл" onClick={() => void act("file", () => api(`/files/${x.id}`, { method: "DELETE" }))}>
                    <IconTrash size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold">Фабрика и контакт</h2>
          {dupList.length > 0 && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Похоже, эта фабрика уже есть в базе:{" "}
              {dupList.map((d, i) => (
                <span key={i}>
                  {i > 0 && "; "}
                  {d.id ? <Link to={`/factories/${d.id}`} className="link">{d.name}</Link> : "заведена другим сотрудником"}
                  {d.foundByName && ` (нашёл(а) ${d.foundByName})`}
                </span>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {text("name", "Имя в WeChat *", "A-某某地板厂-小王")}
            {text("wechatId", "WeChat ID", "wxid_demo123")}
            {text("nameRu", "Коротко по-русски", "Демо-фабрика — SPC-ламинат")}
            {text("contactName", "Менеджер", "小王")}
            {text("phone", "Телефон")}
            {text("email", "Email")}
            {text("website", "Сайт / магазин")}
            <label className="block">
              <span className="label">Категории (через запятую)</span>
              <input className="input" value={form.categories} placeholder="искусственная трава, ковролин" onChange={(e) => set({ categories: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Статус</span>
              <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value })}>
                {Object.entries(FACTORY_STATUSES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </label>
            {user?.role === "admin" && f && (
              <label className="block">
                <span className="label">Нашёл(а)</span>
                <select className="input" value={form.foundBy ?? ""} onChange={(e) => set({ foundBy: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {directory.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold">Анкета поставщика</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROFILE_QUESTIONS.map((question, n) => (
              <label key={question.key} className="block">
                <span className="label">
                  {n + 1}. {question.label}
                </span>
                {question.key === "location" ? (
                  <input className="input" value={form.location} placeholder={question.hint} onChange={(e) => set({ location: e.target.value })} />
                ) : question.yesNo ? (
                  <select className="input" value={form.profile[question.key]} onChange={(e) => setProfile(question.key as keyof FactoryProfile, e.target.value as YesNo)}>
                    {(Object.keys(YES_NO) as YesNo[]).map((k) => <option key={k} value={k}>{k ? YES_NO[k] : "не знаем"}</option>)}
                  </select>
                ) : (
                  <input className="input" value={form.profile[question.key as keyof FactoryProfile]} placeholder={question.hint} onChange={(e) => setProfile(question.key as keyof FactoryProfile, e.target.value)} />
                )}
              </label>
            ))}
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold">Цены</h2>
          <p className="mb-3 text-xs muted">Товар попадёт в справочник «Товары» — там видны цены всех фабрик и расчёт для клиента. Размер рулона и цвет — в «Позиции», это не новый товар.</p>
          <OffersEditor offers={form.offers} onChange={(offers) => set({ offers })} />
        </section>

        <section className="panel p-4">
          <label className="block">
            <span className="label">Заметки</span>
            <textarea className="input" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </section>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 sm:mx-0 sm:rounded-md sm:border">
          <button type="button" className="btn btn-primary" disabled={!!busy || !form.name.trim()} onClick={() => void save()}>
            {busy === "save" ? "Сохраняем…" : f ? "Сохранить" : "Сохранить фабрику"}
          </button>
          {!form.name.trim() && <span className="text-xs muted">Нужно имя в WeChat</span>}
          {error != null && <span className="text-sm text-red-700 dark:text-red-400">{errorMessage(error)}</span>}
        </div>
      </div>
      {confirmDelete && f && (
        <ConfirmDialog
          title="Удалить фабрику?"
          message="Анкета, цены и файлы фабрики будут удалены."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api(`/factories/${f.id}`, { method: "DELETE" });
            void queryClient.invalidateQueries({ queryKey: ["factories"] });
            navigate("/factories");
          }}
        />
      )}
    </Content>
  );
}
