/** «Сегодня» (кому писать сегодня) и «База» (все отобранные продавцы, фильтры, экспорт) + карточка продавца. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { CONTACT_SOURCES, SELLER_STATUSES, STATUS_ACTIONS, type SellerStatus } from "../../../../shared/leadgen.ts";
import { IconCheck, IconCopy, IconDownload } from "../../components/Icons.tsx";
import { EmptyState, ErrorBox, Modal, Spinner } from "../../components/ui.tsx";
import { api, apiDownload } from "../../lib/api.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import type { LeadCategory, LeadContact, LeadSeller, LeadStatus, SellerDetails, TodayItem } from "./types.ts";

const STATUS_CLASS: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-neutral-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  green: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  neutral: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export function StatusBadge({ status }: { status: SellerStatus }) {
  const s = SELLER_STATUSES[status] ?? SELLER_STATUSES.new;
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[s.color]}`}>{s.label}</span>;
}

function CopyButton({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}

function ContactList({ contacts }: { contacts: LeadContact[] }) {
  const phones = contacts.filter((c) => c.type === "phone");
  const emails = contacts.filter((c) => c.type === "email");
  const sites = contacts.filter((c) => c.type === "site");
  const src = (c: LeadContact) => <span className="ml-1 text-[11px] muted" title={`получен ${formatDateTime(c.receivedAt)}`}>{CONTACT_SOURCES[c.source] ?? c.source}</span>;
  return (
    <div className="space-y-1 text-sm">
      {phones.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {phones.map((c) => (
            <span key={c.id} className="whitespace-nowrap">
              <a className="link tabular-nums" href={`tel:${c.value}`}>{c.value}</a>
              {src(c)}
            </span>
          ))}
        </div>
      )}
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {emails.map((c) => (
            <span key={c.id} className="whitespace-nowrap" title={c.note ?? undefined}>
              {c.valid ? <a className="link" href={`mailto:${c.value}`}>{c.value}</a> : <span className="text-slate-400 line-through dark:text-neutral-500">{c.value}</span>}
              {src(c)}
              {c.valid && <CopyButton text={c.value} label="Копировать адрес" />}
              {!c.valid && <span className="ml-1 text-[11px] text-red-600 dark:text-red-400">{c.note ?? "невалиден"}</span>}
            </span>
          ))}
        </div>
      )}
      {sites.length > 0 && (
        <div className="flex flex-wrap gap-x-3">
          {sites.map((c) => (
            <span key={c.id}>
              <a className="link" href={c.value} target="_blank" rel="noreferrer noopener">{c.value.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
              {src(c)}
            </span>
          ))}
        </div>
      )}
      {!contacts.length && <span className="muted">контактов нет</span>}
    </div>
  );
}

function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { inn: string; status: SellerStatus; comment?: string }) => api<SellerDetails>(`/leadgen/sellers/${v.inn}/status`, { method: "POST", body: { status: v.status, comment: v.comment } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leadgen"] });
    },
  });
}

function FirstLine({ seller }: { seller: LeadSeller }) {
  const qc = useQueryClient();
  const [text, setText] = useState(seller.firstLine);
  useEffect(() => setText(seller.firstLine), [seller.firstLine]);
  const save = useMutation({
    mutationFn: (firstLine: string) => api(`/leadgen/sellers/${seller.inn}`, { method: "PATCH", body: { firstLine } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leadgen"] }),
  });
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="label mb-0">Первая строка письма</span>
        <CopyButton text={text} label="Копировать первую строку" />
      </div>
      <textarea
        className="input min-h-[64px] text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== seller.firstLine && save.mutate(text)}
      />
      <ErrorBox error={save.error} />
    </div>
  );
}

/** Карточка продавца для «Сегодня»: всё, что нужно для письма, и кнопки статуса. */
export function SellerCard({ item }: { item: TodayItem }) {
  const setStatus = useSetStatus();
  const [details, setDetails] = useState(false);
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.brands[0] ?? item.legalName}</span>
            <StatusBadge status={item.status} />
            {item.touch === "followup" && <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[11px] font-medium text-white">повтор</span>}
          </div>
          <div className="text-xs muted">
            {[item.legalName, `ИНН ${item.inn}`, item.region, item.managerName && `${item.managerName}${item.managerPost ? `, ${item.managerPost.toLowerCase()}` : ""}`].filter(Boolean).join(" · ")}
          </div>
          {item.brands.length > 1 && <div className="text-xs muted">Бренды: {item.brands.join(", ")}</div>}
        </div>
        <div className="text-right text-xs muted">
          <div>{item.categoryName}</div>
          {item.plannedDate && <div>план {formatDate(item.plannedDate)}</div>}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <ContactList contacts={item.contacts} />
          <ul className="space-y-0.5 text-sm">
            {item.products.map((p) => (
              <li key={p.nm} className="truncate">
                <a className="link" href={p.url} target="_blank" rel="noreferrer noopener">{p.name || `Товар ${p.nm}`}</a>
              </li>
            ))}
          </ul>
        </div>
        <FirstLine seller={item} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {STATUS_ACTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn btn-sm ${item.status === s ? "btn-primary" : ""}`}
            disabled={setStatus.isPending}
            onClick={() => {
              const comment = s === "bounced" || s === "do_not_contact" || s.startsWith("replied") ? window.prompt(`${SELLER_STATUSES[s].label}: комментарий (можно пусто)`) : "";
              if (comment === null) return;
              setStatus.mutate({ inn: item.inn, status: s, comment });
            }}
          >
            {SELLER_STATUSES[s].label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setDetails(true)}>
          Подробнее
        </button>
      </div>
      <ErrorBox error={setStatus.error} />
      {details && <SellerDialog inn={item.inn} onClose={() => setDetails(false)} />}
    </div>
  );
}

const EVENT_LABEL = (type: string) => SELLER_STATUSES[type as SellerStatus]?.label ?? type;

export function SellerDialog({ inn, onClose }: { inn: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["leadgen", "seller", inn], queryFn: () => api<SellerDetails>(`/leadgen/sellers/${inn}`) });
  const setStatus = useSetStatus();
  const s = data?.seller;
  return (
    <Modal title={s ? s.legalName : "Продавец"} onClose={onClose} wide>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {s && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} />
            <span className="muted">{s.categoryName} · выгрузка {s.batchMonth}</span>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {[
              ["ИНН", s.inn],
              [s.kind === "ip" ? "ОГРНИП" : "ОГРН", s.ogrn],
              ["Бренды", s.brands.join(", ")],
              ["Кабинеты WB", s.wbSupplierIds.map((id) => id).join(", ")],
              ["Руководитель", [s.managerName, s.managerPost].filter(Boolean).join(", ")],
              ["Регистрация", s.regDate && formatDate(s.regDate)],
              ["ОКВЭД", s.okved],
              ["Адрес", s.address],
              ["SKU / отзывов", `${s.skuCount ?? "—"} / ${s.feedbacksTotal ?? "—"}`],
              ["Доля Китая", s.chinaShare === null ? "—" : `${Math.round(s.chinaShare * 100)} %`],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="muted">{k}</dt>
                <dd>{v || "—"}</dd>
              </div>
            ))}
          </dl>
          <ContactList contacts={s.contacts} />
          <FirstLine seller={s} />
          <div className="flex flex-wrap gap-1.5">
            {[...STATUS_ACTIONS, "new" as const].map((st) => (
              <button key={st} type="button" className={`btn btn-sm ${s.status === st ? "btn-primary" : ""}`} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ inn: s.inn, status: st })}>
                {st === "new" ? "Вернуть в план" : SELLER_STATUSES[st].label}
              </button>
            ))}
          </div>
          <div>
            <div className="label">История</div>
            {data.events.length ? (
              <ul className="space-y-0.5">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <span className="muted">{formatDateTime(e.createdAt)}</span> — {EVENT_LABEL(e.type)}
                    {e.comment && <span className="muted"> · {e.comment}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">пока ничего</span>
            )}
          </div>
          <div>
            <div className="label">Касания</div>
            <ul className="space-y-0.5">
              {data.queue.map((q) => (
                <li key={q.id}>
                  {formatDate(q.plannedDate)} — {q.touch === "first" ? "первое письмо" : "повтор"} · {{ planned: "в плане", done: "сделано", cancelled: "снято" }[q.status] ?? q.status}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function TodayTab({ status }: { status: LeadStatus }) {
  const [day, setDay] = useState(status.today);
  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "today", day],
    queryFn: () => api<{ day: string; first: TodayItem[]; followups: TodayItem[]; firstLeft: number }>(`/leadgen/today?day=${day}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          День
          <input type="date" className="input w-auto" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        {data && (
          <span className="text-sm muted">
            первых писем {data.first.length}
            {data.firstLeft > data.first.length ? ` (в плане до этого дня ещё ${data.firstLeft - data.first.length})` : ""} · повторов {data.followups.length}
          </span>
        )}
      </div>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && !data.first.length && !data.followups.length && (
        <EmptyState title="На этот день писем нет">Соберите базу на месяц во вкладке «Сбор» — продавцы разложатся по рабочим дням.</EmptyState>
      )}
      {data && data.followups.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Повторы — нет ответа {status.settings.followupDays} дня после письма</h2>
          {data.followups.map((it) => (
            <SellerCard key={it.queueId} item={it} />
          ))}
        </section>
      )}
      {data && data.first.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Первое письмо</h2>
          {data.first.map((it) => (
            <SellerCard key={it.queueId} item={it} />
          ))}
        </section>
      )}
    </div>
  );
}

export function BaseTab({ status, categories }: { status: LeadStatus; categories: LeadCategory[] }) {
  const [f, setF] = useState({ category: "", month: "", status: "", phone: "", email: "", q: "" });
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "sellers", qs.toString(), limit],
    queryFn: () => api<{ sellers: LeadSeller[]; total: number }>(`/leadgen/sellers?${qs.toString()}&limit=${limit}`),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    setLimit(100);
  };
  const download = (format: "xlsx" | "csv") => {
    setExportError(null);
    apiDownload(`/leadgen/export.${format}?${qs.toString()}`).catch(setExportError);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-auto" value={f.category} onChange={set("category")} aria-label="Категория">
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="input w-auto" value={f.month} onChange={set("month")} aria-label="Месяц выгрузки">
          <option value="">Все месяцы</option>
          {status.months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select className="input w-auto" value={f.status} onChange={set("status")} aria-label="Статус">
          <option value="">Все статусы</option>
          {Object.entries(SELLER_STATUSES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className="input w-auto" value={f.phone} onChange={set("phone")} aria-label="Телефон">
          <option value="">Телефон — любой</option>
          <option value="1">есть телефон</option>
          <option value="0">нет телефона</option>
        </select>
        <select className="input w-auto" value={f.email} onChange={set("email")} aria-label="Email">
          <option value="">Email — любой</option>
          <option value="1">есть валидный email</option>
          <option value="0">нет email</option>
        </select>
        <input type="search" className="input w-48" placeholder="ИНН, название, бренд" value={f.q} onChange={set("q")} />
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn" onClick={() => download("xlsx")}>
            <IconDownload size={14} /> XLSX
          </button>
          <button type="button" className="btn" onClick={() => download("csv")}>
            <IconDownload size={14} /> CSV
          </button>
        </span>
      </div>
      <ErrorBox error={exportError} />
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="text-sm muted">Найдено: {data.total}</div>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <tr>
                  <th className="px-3 py-2 font-medium">Продавец</th>
                  <th className="px-3 py-2 font-medium">Категория</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Телефоны</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium text-right">SKU / отзывы</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                {data.sellers.map((s) => (
                  <tr key={s.inn} className="cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-neutral-800/50" onClick={() => setOpen(s.inn)}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.brands[0] ?? s.legalName}</div>
                      <div className="text-xs muted">
                        {s.legalName} · ИНН {s.inn}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.categoryName}
                      <div className="muted">{s.batchMonth}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {s.contacts.filter((c) => c.type === "phone").map((c) => (
                        <div key={c.id}>{c.value}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.contacts.filter((c) => c.type === "email").map((c) => (
                        <div key={c.id} className={c.valid ? "" : "text-slate-400 line-through"}>{c.value}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {s.skuCount ?? "—"} / {s.feedbacksTotal ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.sellers.length && <EmptyState title="Продавцов нет" />}
          </div>
          {data.total > data.sellers.length && (
            <button type="button" className="btn" onClick={() => setLimit(limit + 100)}>
              Показать ещё ({data.total - data.sellers.length})
            </button>
          )}
        </>
      )}
      {open && <SellerDialog inn={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
