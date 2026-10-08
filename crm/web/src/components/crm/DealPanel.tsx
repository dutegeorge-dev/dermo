/** Карточка сделки — боковая панель поверх доски/таблицы: все поля, клиент, комментарии, активность. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { DEAL_FIELD_GROUPS, DEAL_FIELDS, type DealField, MESSENGERS } from "../../../../shared/deal-fields.ts";
import { api, fileUrl } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatDateTime, formatRelative, formatSize } from "../../lib/format.ts";
import type { Contact, DealResponse, Stage } from "../../lib/types.ts";
import { IconFile, IconPaperclip, IconTrash, IconX } from "../Icons.tsx";
import { ConfirmDialog, ErrorBox, Modal, Spinner } from "../ui.tsx";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "./CounterpartyPicker.tsx";
import { DealDocs } from "./DealDocs.tsx";
import { StageChip, useDirectory, useStages } from "./common.tsx";

type Save = (patch: Record<string, unknown>) => Promise<void>;

/** Поле сделки: сохраняется само — select/дата сразу, текст по уходу с поля. */
function FieldInput({ field, value, save }: { field: DealField; value: unknown; save: Save }) {
  const spec = DEAL_FIELDS[field];
  const users = useDirectory().data?.users ?? [];
  const initial = value === null || value === undefined ? "" : String(value).replace(".", spec.kind === "number" ? "," : ".");
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const commit = () => {
    if (draft.trim() !== initial) void save({ [field]: draft.trim() || null });
  };

  if (spec.kind === "enum") {
    const values = "values" in spec ? (spec.values as Record<string, string>) : {};
    return (
      <select className="input" value={initial} onChange={(e) => void save({ [field]: e.target.value || null })}>
        {field !== "priority" && <option value="">—</option>}
        {Object.entries(values).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  if (spec.kind === "user") {
    return (
      <select className="input" value={initial} onChange={(e) => void save({ [field]: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Не назначен</option>
        {users.filter((u) => u.isActive || String(u.id) === initial).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    );
  }
  if (spec.kind === "date") {
    return <input type="date" className="input" value={initial} onChange={(e) => void save({ [field]: e.target.value || null })} />;
  }
  return (
    <input
      className="input"
      inputMode={spec.kind === "number" ? "decimal" : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(initial);
      }}
    />
  );
}

function Labels({ value, save }: { value: string[]; save: Save }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) void save({ labels: [...value, v] });
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((l) => (
        <span key={l} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
          {l}
          <button type="button" aria-label={`Убрать метку ${l}`} className="text-slate-400 hover:text-red-600" onClick={() => void save({ labels: value.filter((x) => x !== l) })}>
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-slate-400"
        placeholder="+ метка"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid items-center gap-1 sm:grid-cols-[180px_1fr] sm:gap-3">
      <span className="text-xs muted">{label}</span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Шкала этапов: клик — перевести сделку. */
function StageBar({ stages, current, onPick, disabled }: { stages: Stage[]; current: string; onPick: (key: string) => void; disabled: boolean }) {
  const idx = stages.findIndex((s) => s.key === current);
  return (
    <div className="flex gap-0.5 overflow-x-auto pb-1">
      {stages.map((s, i) => (
        <button key={s.key} type="button" disabled={disabled} onClick={() => s.key !== current && onPick(s.key)} title={s.name} className="min-w-0 shrink-0 disabled:cursor-not-allowed">
          <StageChip stage={s} dim={i > idx} className={`h-7 ${s.key === current ? "max-w-60" : "max-w-28"}`}>
            {s.key === current ? s.name : i < idx ? "✓" : s.name}
          </StageChip>
        </button>
      ))}
    </div>
  );
}

function eventText(e: DealResponse["events"][number]): ReactNode {
  const label = e.field && e.field in DEAL_FIELDS ? DEAL_FIELDS[e.field as DealField].label : e.field;
  switch (e.kind) {
    case "created":
      return <>создал сделку{e.newValue ? <> на этапе «{e.newValue}»</> : null}</>;
    case "status_changed":
      return <>перевёл с этапа «{e.oldValue}» на «{e.newValue}»</>;
    case "field_changed":
      return (
        <>
          изменил «{label}»: <span className="muted line-through">{e.oldValue ?? "—"}</span> → <b className="font-medium">{e.newValue ?? "—"}</b>
        </>
      );
    case "lost":
      return <>закрыл как отказ{e.newValue ? `: ${e.newValue}` : ""}</>;
    case "reopened":
      return <>вернул в работу</>;
    case "attachment_added":
      return <>прикрепил файл «{e.newValue}»</>;
    case "document_added":
      return <>добавил документ: {e.newValue}</>;
    case "document_removed":
      return <>удалил документ: {e.oldValue}</>;
    case "payment_changed":
      return <>отметил оплату — {e.oldValue}: <b className="font-medium">{e.newValue}</b></>;
    case "party_added":
      return <>добавил подрядчика {e.newValue}</>;
    case "party_removed":
      return <>убрал подрядчика {e.oldValue}</>;
    default:
      return e.kind;
  }
}

function ClientBlock({ data, save }: { data: DealResponse; save: Save }) {
  const { deal } = data;
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const contacts = useQuery({
    queryKey: ["counterparty", deal.clientId],
    queryFn: () => api<{ contacts: Contact[] }>(`/counterparties/${deal.clientId}`),
    enabled: !!deal.clientId && editing,
  });

  if (editing) {
    return (
      <div className="space-y-2">
        <CounterpartyPicker role="client" value={picked ?? (deal.clientId ? { id: deal.clientId, name: deal.clientName ?? "" } : null)} onChange={setPicked} autoFocus />
        {deal.clientId && contacts.data && contacts.data.contacts.length > 0 && !picked && (
          <select className="input" value={deal.contactId ?? ""} onChange={(e) => void save({ contactId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Контакт не выбран</option>
            {contacts.data.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              const id = picked ? await ensureCounterparty(picked, "client") : null;
              if (id && id !== deal.clientId) await save({ clientId: id, contactId: null });
              setEditing(false);
              setPicked(null);
            }}
          >
            Готово
          </button>
          {deal.clientId && (
            <button type="button" className="btn btn-sm" onClick={async () => { await save({ clientId: null, contactId: null }); setEditing(false); }}>
              Отвязать клиента
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-0.5 text-sm">
      {deal.clientId ? (
        <Link to={`/clients/${deal.clientId}`} className="link font-medium">{deal.clientName}</Link>
      ) : (
        <span className="muted">Клиент не указан</span>
      )}
      {deal.clientInn && <div className="text-xs muted">ИНН {deal.clientInn}</div>}
      {deal.contactName && <div className="pt-1">{deal.contactName}</div>}
      {deal.contactPhone && <a href={`tel:${deal.contactPhone.replace(/[^\d+]/g, "")}`} className="link block">{deal.contactPhone}</a>}
      {deal.contactMessenger && (
        <div className="text-xs muted">
          {MESSENGERS[deal.contactMessenger as keyof typeof MESSENGERS]}
          {deal.contactMessengerHandle ? `: ${deal.contactMessengerHandle}` : ""}
        </div>
      )}
      {deal.contactEmail && <a href={`mailto:${deal.contactEmail}`} className="link block text-xs">{deal.contactEmail}</a>}
      <button type="button" className="btn btn-ghost btn-sm -ml-2 mt-1" onClick={() => setEditing(true)}>Изменить</button>
    </div>
  );
}

export function DealPanel({ dealKey, onClose }: { dealKey: string; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stages = useStages().data?.stages ?? [];
  const query = useQuery({ queryKey: ["deal", dealKey], queryFn: () => api<DealResponse>(`/deals/${dealKey}`) });
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comment, setComment] = useState("");
  const [losing, setLosing] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["deal", dealKey] });
    await queryClient.invalidateQueries({ queryKey: ["deals"] });
    await queryClient.invalidateQueries({ queryKey: ["stages"] });
  };
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e);
      await queryClient.invalidateQueries({ queryKey: ["deal", dealKey] });
    }
  };
  const save: Save = (patch) => run(() => api(`/deals/${dealKey}`, { method: "PATCH", body: patch }));

  const data = query.data;
  const deal = data?.deal;
  const closed = deal?.outcome === "lost";

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 dark:bg-black/50" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-4xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" aria-label="Сделка">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-neutral-800">
          <span className="font-mono text-xs muted">{deal?.key ?? dealKey.toUpperCase()}</span>
          {deal?.outcome === "won" && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">успешно</span>}
          {closed && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">отказ</span>}
          <span className="flex-1" />
          {deal && !closed && <button type="button" className="btn btn-sm" onClick={() => setLosing(true)}>Отказ</button>}
          {deal && closed && <button type="button" className="btn btn-sm" onClick={() => void run(() => api(`/deals/${dealKey}/reopen`, { method: "POST" }))}>Вернуть в работу</button>}
          {deal && user?.role === "admin" && (
            <button type="button" className="icon-btn" title="Удалить сделку" aria-label="Удалить сделку" onClick={() => setDeleting(true)}>
              <IconTrash size={14} />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconX />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {query.isLoading && <div className="px-5"><Spinner /></div>}
          <div className="px-5 pt-3"><ErrorBox error={query.error ?? error} /></div>
          {deal && data && (
            <div className="grid gap-6 px-5 pb-8 pt-2 lg:grid-cols-[1fr_260px]">
              <div className="min-w-0 space-y-5">
                <TitleInput value={deal.title} onSave={(title) => save({ title })} />
                {closed && deal.lostReason && <p className="text-sm text-red-700 dark:text-red-300">Причина отказа: {deal.lostReason}</p>}
                <StageBar stages={stages} current={deal.statusKey} disabled={closed} onPick={(statusKey) => void run(() => api(`/deals/${dealKey}/move`, { method: "POST", body: { statusKey, beforeKey: null } }))} />

                <DealDocs data={data} save={save} run={run} />

                <DescriptionInput value={deal.description} onSave={(description) => save({ description })} />

                {DEAL_FIELD_GROUPS.map((group) => (
                  <section key={group.title}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{group.title}</h3>
                    <div className="space-y-2">
                      {group.fields.map((f) => (
                        <Row key={f} label={DEAL_FIELDS[f].label}>
                          <FieldInput field={f} value={(deal as Record<string, unknown>)[f]} save={save} />
                        </Row>
                      ))}
                    </div>
                  </section>
                ))}

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide muted">
                      <IconPaperclip size={12} /> Вложения
                    </h3>
                    <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? "Загрузка…" : "Прикрепить"}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = [...(e.target.files ?? [])];
                        e.target.value = "";
                        setUploading(true);
                        await run(async () => {
                          for (const file of files) {
                            const form = new FormData();
                            form.append("file", file);
                            await api(`/deals/${dealKey}/attachments`, { method: "POST", form });
                          }
                        });
                        setUploading(false);
                      }}
                    />
                  </div>
                  {data.attachments.length === 0 ? (
                    <p className="text-xs muted">Файлов нет.</p>
                  ) : (
                    <ul className="divide-line">
                      {data.attachments.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 py-1.5 text-sm">
                          <IconFile size={14} className="shrink-0 text-slate-400" />
                          <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="link min-w-0 truncate">{f.filename}</a>
                          <span className="ml-auto shrink-0 text-xs muted">{formatSize(f.size)} · {formatRelative(f.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <div className="mb-3 flex gap-4 border-b border-slate-200 text-sm dark:border-neutral-800">
                    {(["comments", "activity"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        className={`-mb-px border-b-2 pb-2 ${tab === t ? "border-accent font-medium text-accent dark:text-accent-bright" : "border-transparent muted"}`}
                      >
                        {t === "comments" ? `Комментарии ${data.comments.length || ""}` : "Активность"}
                      </button>
                    ))}
                  </div>
                  {tab === "comments" ? (
                    <div className="space-y-3">
                      {data.comments.map((c) => (
                        <div key={c.id} className="group text-sm">
                          <div className="flex items-baseline gap-2 text-xs">
                            <span className="font-medium text-slate-800 dark:text-neutral-200">{c.authorName ?? "—"}</span>
                            <span className="muted">{formatDateTime(c.createdAt)}</span>
                            {(c.authorId === user?.id || user?.role === "admin") && (
                              <button
                                type="button"
                                className="ml-auto text-xs text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                                onClick={() => void run(() => api(`/deals/${dealKey}/comments/${c.id}`, { method: "DELETE" }))}
                              >
                                удалить
                              </button>
                            )}
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                        </div>
                      ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!comment.trim()) return;
                          void run(async () => {
                            await api(`/deals/${dealKey}/comments`, { method: "POST", body: { body: comment } });
                            setComment("");
                          });
                        }}
                        className="space-y-2"
                      >
                        <textarea
                          className="input"
                          rows={2}
                          placeholder="Комментарий… (Ctrl+Enter — отправить)"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
                          }}
                        />
                        <button type="submit" className="btn btn-sm" disabled={!comment.trim()}>Отправить</button>
                      </form>
                    </div>
                  ) : (
                    <ol className="space-y-2 text-sm">
                      {data.events.map((e) => (
                        <li key={e.id}>
                          <span className="font-medium">{e.userName ?? "Система"}</span> {eventText(e)}
                          <span className="ml-2 text-xs muted">{formatDateTime(e.createdAt)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>

              <aside className="space-y-4 lg:border-l lg:border-slate-200 lg:pl-5 lg:dark:border-neutral-800">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide muted">Клиент</h3>
                  <ClientBlock data={data} save={save} />
                </div>
                <label className="block">
                  <span className="label">Исполнитель</span>
                  <FieldInput field="assigneeId" value={deal.assigneeId} save={save} />
                </label>
                <label className="block">
                  <span className="label">Срок</span>
                  <FieldInput field="dueDate" value={deal.dueDate} save={save} />
                </label>
                <label className="block">
                  <span className="label">Приоритет</span>
                  <FieldInput field="priority" value={deal.priority} save={save} />
                </label>
                <div>
                  <span className="label">Метки</span>
                  <Labels value={deal.labels} save={save} />
                </div>
                <p className="text-xs muted">
                  Создал{deal.createdByName ? ` ${deal.createdByName}` : "а система"} {formatDateTime(deal.createdAt)}
                  <br />
                  Изменена {formatRelative(deal.updatedAt)}
                  {deal.source !== "manual" && <><br />Источник: {deal.source === "site" ? "заявка с сайта" : deal.source}</>}
                </p>
              </aside>
            </div>
          )}
        </div>
      </aside>

      {losing && (
        <Modal
          title="Закрыть сделку как отказ"
          onClose={() => setLosing(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setLosing(false)}>Отмена</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await run(() => api(`/deals/${dealKey}/lose`, { method: "POST", body: { reason: lostReason } }));
                  setLosing(false);
                  setLostReason("");
                }}
              >
                Закрыть как отказ
              </button>
            </>
          }
        >
          <label className="label" htmlFor="lost-reason">Причина (необязательно)</label>
          <textarea id="lost-reason" className="input" rows={3} value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Например: выбрали карго, дорого, пропал" />
          <p className="mt-2 text-xs muted">Сделка уйдёт с доски; найти её можно в таблице с фильтром «Отказ».</p>
        </Modal>
      )}
      {deleting && deal && (
        <ConfirmDialog
          title={`Удалить ${deal.key}?`}
          message="Сделка, комментарии, журнал и вложения будут удалены без возможности восстановления. Обычно достаточно закрыть сделку как отказ."
          onConfirm={async () => {
            await api(`/deals/${dealKey}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["deals"] });
            navigate("/deals");
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

function TitleInput({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      rows={1}
      aria-label="Название сделки"
      className="w-full resize-none border-0 bg-transparent p-0 text-xl font-semibold tracking-tight outline-none focus:ring-0"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== value) void onSave(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function DescriptionInput({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <div>
      <span className="label">Описание</span>
      <textarea
        className="input min-h-20"
        rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
        placeholder="Что нужно клиенту, договорённости, нюансы…"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) void onSave(draft);
        }}
      />
    </div>
  );
}

