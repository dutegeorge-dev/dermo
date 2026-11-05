/**
 * Раздел «Лидогенерация»: раз в месяц собираем базу продавцов WB с китайским товаром (полные телефоны и email),
 * дальше каждый день — 30 писем. Вкладки: Сегодня, База, Категории, Сбор (кнопка, прогресс, пороги), Итоги.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { DEFAULT_LEADGEN_SETTINGS, JOB_SOURCES, JOB_STAGES, JOB_STATUSES, type JobSource, type LeadgenSettings, SETTINGS_FIELDS, TEMPLATE_MARKING, TEMPLATE_PLAIN } from "../../../../shared/leadgen.ts";
import { IconPencil, IconPlus } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { api, apiDownload } from "../../lib/api.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { BaseTab, TodayTab } from "./LeadgenSellers.tsx";
import type { LeadCategory, LeadJob, LeadStatus, StatsRow } from "./types.ts";

const TABS = [
  ["today", "Сегодня"],
  ["base", "База"],
  ["categories", "Категории"],
  ["collect", "Сбор"],
  ["stats", "Итоги"],
] as const;
type Tab = (typeof TABS)[number][0];

export function LeadgenPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "today") as Tab;
  const go = (t: Tab) => setParams(t === "today" ? {} : { tab: t }, { replace: true });
  const [starting, setStarting] = useState(false);
  const status = useQuery({ queryKey: ["leadgen", "status"], queryFn: () => api<LeadStatus>("/leadgen/status") });
  const categories = useQuery({ queryKey: ["leadgen", "categories"], queryFn: () => api<{ categories: LeadCategory[] }>("/leadgen/categories") });

  return (
    <Content wide>
      <PageHeader
        title="Лидогенерация"
        meta="Продавцы Wildberries с китайским товаром: раз в месяц — сбор базы, каждый день — письма"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}>
            Собрать базу на месяц
          </button>
        }
      />
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-neutral-800" aria-label="Вкладки">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => go(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "border-accent font-medium text-accent dark:text-accent-bright" : "border-transparent text-slate-600 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <ErrorBox error={status.error ?? categories.error} />
      {(status.isLoading || categories.isLoading) && <Spinner />}
      {status.data && categories.data && (
        <>
          {tab === "today" && <TodayTab status={status.data} />}
          {tab === "base" && <BaseTab status={status.data} categories={categories.data.categories} />}
          {tab === "categories" && <CategoriesTab categories={categories.data.categories} />}
          {tab === "collect" && <CollectTab status={status.data} categories={categories.data.categories} onStart={() => setStarting(true)} />}
          {tab === "stats" && <StatsTab status={status.data} />}
        </>
      )}
      {starting && (
        <StartDialog
          categories={categories.data?.categories ?? []}
          onClose={() => setStarting(false)}
          onStarted={() => {
            setStarting(false);
            go("collect");
          }}
        />
      )}
    </Content>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

function StartDialog({ categories, onClose, onStarted }: { categories: LeadCategory[]; onClose: () => void; onStarted: () => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [quota, setQuota] = useState("");
  const [source, setSource] = useState<JobSource>("browser");
  const active = categories.filter((c) => c.active && c.queries.length);
  const start = useMutation({
    mutationFn: () => api<{ job: LeadJob }>("/leadgen/jobs", { method: "POST", body: { month, quota: quota ? Number(quota) : null, source } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leadgen"] });
      onStarted();
    },
  });
  const total = active.reduce((s, c) => s + (quota ? Number(quota) || 0 : c.quota), 0);
  return (
    <Modal
      title="Собрать базу на месяц"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={start.isPending || !active.length} onClick={() => start.mutate()}>
            Запустить
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="muted">
          Сбор идёт в фоне несколько часов: выдача WB по запросам категорий → фильтры → реквизиты DaData → контакты Checko → случайный отбор по квоте → раскладка по рабочим
          дням. Можно остановить и продолжить с места остановки.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Месяц выгрузки</span>
            <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label>
            <span className="label">Квота на категорию (пусто — из категорий)</span>
            <input type="number" min={1} className="input" placeholder="например, 10 для пробы" value={quota} onChange={(e) => setQuota(e.target.value)} />
          </label>
        </div>
        <fieldset className="space-y-1">
          <legend className="label">Откуда брать выдачу WB</legend>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={source === "browser"} onChange={() => setSource("browser")} />
            <span>
              Расширение «Ирбис · сборщик WB» в вашем Chrome <span className="muted">— WB закрыл поиск для серверов; расширение открывает страницы в браузере сотрудника</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={source === "direct"} onChange={() => setSource("direct")} />
            <span>
              С сервера <span className="muted">— только если поиск WB отвечает серверу (npm run leadgen:check)</span>
            </span>
          </label>
        </fieldset>
        <div>
          Категорий: {active.length}, отобрать всего: <b>{total}</b>
        </div>
        <ErrorBox error={start.error} />
      </div>
    </Modal>
  );
}

// ── Категории ────────────────────────────────────────────────────────────────

function CategoriesTab({ categories }: { categories: LeadCategory[] }) {
  const [editing, setEditing] = useState<LeadCategory | "new" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn" onClick={() => setEditing("new")}>
          <IconPlus size={14} /> Категория
        </button>
      </div>
      {!categories.length && <EmptyState title="Категорий нет" />}
      <div className="panel divide-line">
        {categories.map((c) => (
          <div key={c.id} className={`flex flex-wrap items-start gap-3 px-4 py-3 ${c.active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                {c.marking ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Честный знак{c.markingNote ? `: ${c.markingNote}` : ""}</span>
                ) : (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-neutral-800 dark:text-neutral-400">без маркировки</span>
                )}
                {!c.active && <span className="text-xs muted">выключена</span>}
              </div>
              <div className="mt-1 text-xs">
                <span className="muted">Запросы:</span> {c.queries.join("; ") || "—"}
              </div>
              <div className="text-xs">
                <span className="muted">Стоп-слова:</span> {c.stopWords.join("; ") || "—"}
              </div>
            </div>
            <div className="text-right text-xs">
              <div>
                квота <b>{c.quota}</b>
              </div>
              <div className="muted">в базе {c.sellers}</div>
            </div>
            <button type="button" className="icon-btn" onClick={() => setEditing(c)} aria-label="Изменить">
              <IconPencil size={14} />
            </button>
          </div>
        ))}
      </div>
      {editing && <CategoryDialog category={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CategoryDialog({ category, onClose }: { category: LeadCategory | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: category?.name ?? "",
    queries: (category?.queries ?? []).join("\n"),
    stopWords: (category?.stopWords ?? []).join("\n"),
    marking: category?.marking ?? false,
    markingNote: category?.markingNote ?? "",
    quota: String(category?.quota ?? 150),
    template: category?.template ?? TEMPLATE_PLAIN,
    active: category?.active ?? true,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api(category ? `/leadgen/categories/${category.id}` : "/leadgen/categories", {
        method: category ? "PATCH" : "POST",
        body: { ...v, quota: Number(v.quota), queries: v.queries.split("\n"), stopWords: v.stopWords.split("\n") },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leadgen"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/leadgen/categories/${category!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leadgen"] });
      onClose();
    },
  });
  const field = (k: keyof typeof v) => ({ value: v[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Modal
      title={category ? category.name : "Новая категория"}
      onClose={onClose}
      wide
      footer={
        <>
          {category && (
            <button type="button" className="btn btn-ghost mr-auto text-red-600" onClick={() => setConfirmDelete(true)}>
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="label">Название</span>
          <input className="input" {...field("name")} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Поисковые запросы WB — по одному в строке</span>
            <textarea className="input min-h-[150px]" {...field("queries")} />
          </label>
          <label className="block">
            <span className="label">Стоп-слова (часть слова) — товары с ними отбрасываются</span>
            <textarea className="input min-h-[150px]" {...field("stopWords")} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.marking}
              onChange={(e) => {
                const marking = e.target.checked;
                // Шаблон по умолчанию меняется вместе с маркировкой, свой — не трогаем.
                const template = v.template === TEMPLATE_PLAIN || v.template === TEMPLATE_MARKING ? (marking ? TEMPLATE_MARKING : TEMPLATE_PLAIN) : v.template;
                setV({ ...v, marking, template });
              }}
            />
            Маркируется Честным знаком
          </label>
          <label className="block">
            <span className="label">Пометка (с какой даты)</span>
            <input className="input" {...field("markingNote")} placeholder="с 01.12.2026" />
          </label>
          <label className="block">
            <span className="label">Квота продавцов на месяц</span>
            <input type="number" min={1} className="input" {...field("quota")} />
          </label>
        </div>
        <label className="block">
          <span className="label">Первая строка письма — {"{brand}"} и {"{product}"} подставляются</span>
          <textarea className="input min-h-[90px]" {...field("template")} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          Активна — участвует в сборе
        </label>
        <ErrorBox error={save.error ?? remove.error} />
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Удалить категорию?"
          message="Категорию с продавцами удалить нельзя — её можно выключить."
          onConfirm={() => remove.mutateAsync()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}

// ── Сбор ─────────────────────────────────────────────────────────────────────

const ACTIVE = new Set(["queued", "running", "stopping", "collecting"]);

function CollectTab({ status, categories, onStart }: { status: LeadStatus; categories: LeadCategory[]; onStart: () => void }) {
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ["leadgen", "jobs"],
    queryFn: () => api<{ jobs: LeadJob[] }>("/leadgen/jobs"),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => ACTIVE.has(j.status)) ? 3000 : false),
  });
  const action = useMutation({
    mutationFn: (v: { id: number; act: "stop" | "resume" | "cancel" }) => api(`/leadgen/jobs/${v.id}/${v.act}`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leadgen"] }),
  });
  const current = jobs.data?.jobs[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-xs">
        <Check ok={status.worker.alive} label={status.worker.alive ? "воркер работает" : `воркер не запущен${status.worker.at ? ` (был ${formatDateTime(status.worker.at)})` : ""} — служба bars-crm-leadgen`} />
        <Check ok={status.dadata} label={status.dadata ? "DaData: ключ есть" : "DaData: нет DADATA_TOKEN"} />
        <Check ok={status.checko} label={status.checko ? "Checko: ключ есть" : "Checko: нет CHECKO_API_KEY (контакты только с WB)"} />
        <Check ok label={status.proxy ? "WB с сервера: через прокси" : "WB с сервера: напрямую"} />
      </div>
      <CollectorKey status={status} />
      {jobs.isLoading && <Spinner />}
      <ErrorBox error={jobs.error ?? action.error} />
      {!current && (
        <EmptyState title="Сборов ещё не было">
          <button type="button" className="btn btn-primary mt-2" onClick={onStart}>
            Собрать базу на месяц
          </button>
        </EmptyState>
      )}
      {current && <JobView job={current} categories={categories} busy={action.isPending} onAction={(act) => action.mutate({ id: current.id, act })} />}
      {jobs.data && jobs.data.jobs.length > 1 && (
        <div>
          <h2 className="mb-2 font-semibold">Прошлые сборы</h2>
          <div className="panel divide-line text-sm">
            {jobs.data.jobs.slice(1).map((j) => {
              const cats = Object.values(j.progress.categories ?? {});
              return (
                <div key={j.id} className="flex flex-wrap gap-x-4 px-4 py-2">
                  <span className="font-medium">№ {j.id} · {j.month}</span>
                  <span className="muted">{JOB_STATUSES[j.status]}</span>
                  <span>отобрано {cats.reduce((s, c) => s + c.selected, 0)} из {cats.reduce((s, c) => s + c.quota, 0)}</span>
                  <span className="muted">{formatDateTime(j.createdAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <SettingsForm settings={status.settings} />
    </div>
  );
}

function CollectorKey({ status }: { status: LeadStatus }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const issue = useMutation({
    mutationFn: () => api<{ token: string }>("/leadgen/collector/token", { method: "POST" }),
    onSuccess: (d) => {
      setToken(d.token);
      void qc.invalidateQueries({ queryKey: ["leadgen", "status"] });
    },
  });
  const c = status.collector;
  const seen = c.lastSeenAt ? Date.now() - Date.parse(c.lastSeenAt) < 2 * 60_000 : false;
  return (
    <div className="panel space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Сборщик в браузере</div>
          <div className="text-xs muted">
            Расширение Chrome «Ирбис · сборщик WB» открывает выдачу и страницы продавцов WB в вашем браузере. Установка: скачать и распаковать архив →
            chrome://extensions → «Режим разработчика» → «Загрузить распакованное расширение» → папка irbis-wb-extension; в расширении — адрес Ирбиса и ключ.
            {c.lastSeenAt ? ` Последняя связь: ${formatDateTime(c.lastSeenAt)}${c.lastTask ? ` (${c.lastTask})` : ""}.` : " Ещё не подключался."}
          </div>
        </div>
        <span className="flex items-center gap-2">
          <Check ok={seen} label={seen ? "на связи" : "не на связи"} />
          <button type="button" className="btn btn-sm" onClick={() => void apiDownload("/leadgen/collector/extension.zip").catch(() => {})}>
            Скачать расширение
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={issue.isPending}
            onClick={() => (!c.hasKey || window.confirm("Выпустить новый ключ? Старый в расширении перестанет работать.")) && issue.mutate()}
          >
            {c.hasKey ? "Новый ключ" : "Выпустить ключ"}
          </button>
        </span>
      </div>
      {token && (
        <div className="rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-900/30">
          Ключ показывается один раз — вставьте его в расширение (поле «Ключ сборщика»), адрес Ирбиса — <b>{window.location.origin}/crm</b>:
          <div className="mt-1 flex items-center gap-2">
            <code className="break-all font-mono text-sm">{token}</code>
            <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(token)}>
              Копировать
            </button>
          </div>
        </div>
      )}
      <ErrorBox error={issue.error} />
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded px-2 py-1 ${ok ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200" : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"}`}>
      {ok ? "✓" : "!"} {label}
    </span>
  );
}

function JobView({ job, categories, busy, onAction }: { job: LeadJob; categories: LeadCategory[]; busy: boolean; onAction: (act: "stop" | "resume" | "cancel") => void }) {
  const [showErrors, setShowErrors] = useState(false);
  const rows = job.categoryIds.map((id) => ({ id, p: job.progress.categories?.[id], name: categories.find((c) => c.id === id)?.name ?? `#${id}` }));
  const total = rows.reduce((s, r) => s + (r.p?.selected ?? 0), 0);
  const quota = rows.reduce((s, r) => s + (r.p?.quota ?? job.quotas[r.id] ?? 0), 0);
  const req = job.progress.requests ?? { wb: 0, dadata: 0, checko: 0, site: 0 };
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">
            Сбор № {job.id} на {job.month}
          </div>
          <div className="text-sm">
            <b>{JOB_STATUSES[job.status]}</b> · этап: {JOB_STAGES[job.stage]} · отобрано {total} из {quota} · {JOB_SOURCES[job.source ?? "direct"]}
          </div>
          <div className="text-xs muted">
            {job.startedAt && `начат ${formatDateTime(job.startedAt)}`}
            {job.finishedAt && ` · закончен ${formatDateTime(job.finishedAt)}`}
            {job.status === "running" && job.heartbeatAt && ` · отметка воркера ${formatDateTime(job.heartbeatAt)}`}
            {job.retryAt && ` · воркер сам продолжит ${formatDateTime(job.retryAt)}`}
            {` · запросов: WB ${req.wb}, DaData ${req.dadata}, Checko ${req.checko}, сайты ${req.site}`}
          </div>
        </div>
        <div className="flex gap-2">
          {(job.status === "running" || job.status === "queued" || job.status === "collecting") && (
            <button type="button" className="btn" disabled={busy} onClick={() => onAction("stop")}>
              Остановить
            </button>
          )}
          {(job.status === "paused" || job.status === "failed") && (
            <>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAction("resume")}>
                Продолжить
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                title="Не искать дальше: уже отобранные — разложить по дням"
                onClick={() => window.confirm("Завершить сбор досрочно? Уже отобранные продавцы останутся и разложатся по дням.") && onAction("cancel")}
              >
                Завершить досрочно
              </button>
            </>
          )}
        </div>
      </div>
      {job.status === "collecting" && (
        <div className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-900/30 dark:text-blue-100">
          {job.stage === "collect" ? "Сервер ждёт выдачу WB" : `Сервер ждёт страницы продавцов (${rows.reduce((s, r) => s + (r.p?.waiting ?? 0), 0)})`} от расширения «Ирбис · сборщик WB». Откройте его в Chrome и нажмите «Запустить» —
          браузер с вкладкой WB должен быть открыт.
        </div>
      )}
      {job.progress.scheduled && job.progress.scheduled.sellers > 0 && (
        <div className="mt-2 text-sm">
          Разложено {job.progress.scheduled.sellers} продавцов: с {formatDate(job.progress.scheduled.from)} по {formatDate(job.progress.scheduled.to)}
        </div>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Категория</th>
              <th className="px-2 py-1 text-right font-medium">Запросы</th>
              <th className="px-2 py-1 text-right font-medium">Собрано продавцов</th>
              <th className="px-2 py-1 text-right font-medium">Проверено</th>
              <th className="px-2 py-1 text-right font-medium">Прошли фильтры</th>
              <th className="px-2 py-1 text-right font-medium">С контактами</th>
              <th className="px-2 py-1 text-right font-medium">Отобрано</th>
              <th className="py-1 pl-3 font-medium">Чаще всего отсеяны</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 tabular-nums dark:divide-neutral-800">
            {rows.map(({ id, p, name }) => (
              <tr key={id} className="align-top">
                <td className="py-1.5 pr-3">{name}</td>
                <td className="px-2 py-1.5 text-right">{p ? `${p.queriesDone}/${p.queriesTotal}` : "—"}</td>
                <td className="px-2 py-1.5 text-right">{p?.collected ?? 0}</td>
                <td className="px-2 py-1.5 text-right">{p?.checked ?? 0}</td>
                <td className="px-2 py-1.5 text-right">{p?.passed ?? 0}</td>
                <td className="px-2 py-1.5 text-right">{p?.withContacts ?? 0}</td>
                <td className="px-2 py-1.5 text-right font-semibold">
                  {p?.selected ?? 0} / {p?.quota ?? job.quotas[id]}
                </td>
                <td className="py-1.5 pl-3 text-xs muted">
                  {Object.entries(p?.rejected ?? {})
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([r, n]) => `${r} — ${n}`)
                    .join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {job.errors.length > 0 && (
        <div className="mt-3">
          <button type="button" className="link text-sm" onClick={() => setShowErrors(!showErrors)}>
            {showErrors ? "Скрыть" : "Показать"} журнал ошибок ({job.errors.length})
          </button>
          {showErrors && (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
              {[...job.errors].reverse().map((e, i) => (
                <li key={i}>
                  <span className="muted">{formatDateTime(e.at)} · {e.stage}</span> — {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsForm({ settings }: { settings: LeadgenSettings }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(SETTINGS_FIELDS.map((f) => [f.key, String(settings[f.key])])));
  const [workdays, setWorkdays] = useState(settings.workdays);
  const [holidays, setHolidays] = useState(settings.holidays.join("\n"));
  const save = useMutation({
    mutationFn: () => api("/leadgen/settings", { method: "PUT", body: { ...v, workdays, holidays: holidays.split(/\s+/).filter(Boolean) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leadgen"] });
      setOpen(false);
    },
  });
  return (
    <div>
      <button type="button" className="link text-sm" onClick={() => setOpen(!open)}>
        {open ? "Скрыть" : "Пороги фильтров и настройки"}
      </button>
      {open && (
        <div className="panel mt-2 space-y-3 p-4 text-sm">
          <p className="text-xs muted">Новые пороги действуют на следующий сбор (идущий сбор работает с порогами на момент запуска).</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SETTINGS_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="label">
                  {f.label}
                  {f.hint ? <span className="muted"> ({f.hint})</span> : null}
                </span>
                <input
                  type="number"
                  step={f.step ?? 1}
                  min={0}
                  className="input"
                  value={v[f.key]}
                  placeholder={String(DEFAULT_LEADGEN_SETTINGS[f.key])}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div>
            <span className="label">Рабочие дни</span>
            <div className="flex flex-wrap gap-3">
              {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" checked={workdays.includes(i + 1)} onChange={(e) => setWorkdays(e.target.checked ? [...workdays, i + 1].sort() : workdays.filter((x) => x !== i + 1))} />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="label">Праздники (ГГГГ-ММ-ДД, по одному в строке) — в эти дни писем нет</span>
            <textarea className="input min-h-[60px] font-mono text-xs" value={holidays} onChange={(e) => setHolidays(e.target.value)} />
          </label>
          <ErrorBox error={save.error} />
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </div>
      )}
    </div>
  );
}

// ── Итоги ────────────────────────────────────────────────────────────────────

function StatsTab({ status }: { status: LeadStatus }) {
  const [month, setMonth] = useState(status.months[0] ?? "");
  const { data, isLoading, error } = useQuery({ queryKey: ["leadgen", "stats", month], queryFn: () => api<{ rows: StatsRow[] }>(`/leadgen/stats${month ? `?month=${month}` : ""}`) });
  const sum = (k: keyof StatsRow) => (data?.rows ?? []).reduce((s, r) => s + (r[k] as number), 0);
  const p = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "—");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        Выгрузка
        <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">Все месяцы</option>
          {status.months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
              <tr>
                <th className="px-3 py-2 font-medium">Категория</th>
                <th className="px-3 py-2 text-right font-medium">В базе</th>
                <th className="px-3 py-2 text-right font-medium">Отправлено</th>
                <th className="px-3 py-2 text-right font-medium">Возвраты</th>
                <th className="px-3 py-2 text-right font-medium">Ответы</th>
                <th className="px-3 py-2 text-right font-medium">Положительные</th>
                <th className="px-3 py-2 text-right font-medium">% ответов</th>
                <th className="px-3 py-2 text-right font-medium">% положительных</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {data.rows.map((r) => (
                <tr key={r.categoryId ?? 0}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.sellers}</td>
                  <td className="px-3 py-2 text-right">{r.sent}</td>
                  <td className="px-3 py-2 text-right">
                    {r.bounced} <span className="text-xs muted">({r.bouncedPct} %)</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.replies}</td>
                  <td className="px-3 py-2 text-right">{r.positive}</td>
                  <td className="px-3 py-2 text-right">{r.sent ? `${r.repliesPct} %` : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{r.sent ? `${r.positivePct} %` : "—"}</td>
                </tr>
              ))}
              {data.rows.length > 1 && (
                <tr className="font-semibold">
                  <td className="px-3 py-2">Всего</td>
                  <td className="px-3 py-2 text-right">{sum("sellers")}</td>
                  <td className="px-3 py-2 text-right">{sum("sent")}</td>
                  <td className="px-3 py-2 text-right">{sum("bounced")}</td>
                  <td className="px-3 py-2 text-right">{sum("replies")}</td>
                  <td className="px-3 py-2 text-right">{sum("positive")}</td>
                  <td className="px-3 py-2 text-right">{p(sum("replies"), sum("sent"))}</td>
                  <td className="px-3 py-2 text-right">{p(sum("positive"), sum("sent"))}</td>
                </tr>
              )}
            </tbody>
          </table>
          {!data.rows.length && <EmptyState title="Пока нечего считать" />}
        </div>
      )}
      <p className="text-xs muted">Проценты — от отправленных. Ответ и возврат считаются по истории статусов: «Не писать» после ответа ответ не отменяет.</p>
    </div>
  );
}
