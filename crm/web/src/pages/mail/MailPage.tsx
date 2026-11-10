/**
 * Раздел «Рассылка»: автоотправка писем продавцам из очереди лидогенерации. Вкладки: План (режим, пауза, план дня,
 * журнал), Входящие (ответы, возвраты, автоответы), Шаблоны (+ предпросмотр и тест цепочки), Стоп-лист, Ящики (админ).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { MAIL_MODES, type MailMode, type MailSettings, MAX_MAILBOXES_PER_RUN, PLACEHOLDERS } from "../../../../shared/mail.ts";
import { IconPencil, IconPlus } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatDateTime } from "../../lib/format.ts";

type Mailbox = {
  id: number;
  email: string;
  fromName: string;
  domainId: number;
  domain: string;
  domainStatus: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  signature: string;
  dailyLimit: number;
  todayLimit: number;
  usedToday: number;
  liveSentToday: number;
  remainingToday: number;
  warmupStage: number;
  warmupDays: number;
  warmupStageSent: number;
  warmupBounces: number;
  warmupBounceRate: number;
  warmupHoldReason: string | null;
  warmupFirstsPaused: boolean;
  warmupLimitOverride: number | null;
  usable: boolean;
  availableForRun: boolean;
  warmupStart: string | null;
  status: string;
  pauseReason: string | null;
  pausedUntil: string | null;
  smtpVerifiedAt: string | null;
  smtpError: string | null;
  imapVerifiedAt: string | null;
  imapCheckedAt: string | null;
  imapError: string | null;
  checkRequestedAt: string | null;
  imapPollRequestedAt: string | null;
};
type PlanSummary = { day: string; at: string; planned: number; followups: number; firsts: number; deferred: number; deferredTo: string | null; noEmail: number; skipped: number; perMailbox: Record<string, number>; note?: string };
type MailStatus = {
  settings: MailSettings;
  day: string;
  today: Record<string, number>;
  queueDue: number;
  unresolved: number;
  state: { lastPlan?: PlanSummary };
  run: { id: number; planDay: string; createdAt: string; mailboxIds: number[] } | null;
  worker: { at: string | null; alive: boolean };
  agent: { hasKey: boolean; lastSeenAt: string | null; host: string | null; alive: boolean };
  ai: boolean;
  secretKey: boolean;
  mailboxes: Mailbox[];
};
type Message = { id: number; templateId: number | null; sellerInn: string; brand: string | null; legalName: string | null; mailbox: string; toEmail: string; sentTo: string | null; touch: string; subject: string; status: string; mode: string | null; scheduledAt: string; sentAt: string | null; error: string | null };
type Template = { id: number; categoryId: number | null; forMarking: boolean | null; touch: string; name: string; subject: string; body: string; active: boolean; version: number };
type Category = { id: number; name: string; marking: boolean; slug: string; mailName: string; mailNote: string };
type Inbound = { id: number; mailbox: string; fromEmail: string; fromName: string; subject: string; receivedAt: string | null; kind: string; sellerInn: string | null; brand: string | null; legalName: string | null; sellerStatus: string | null; bouncedEmail: string | null; text: string; refusalHint: boolean; resolution: string | null };
type Domain = { id: number; domain: string; landingBaseUrl: string; status: string; note: string; dkimSelector: string };

const STATUS_LABEL: Record<string, string> = { planned: "в плане", sending: "отправляется", sent: "отправлено", dry_run: "журнал (dry-run)", failed: "ошибка", cancelled: "снято" };
const BOX_STATUS: Record<string, string> = { warming: "прогрев", active: "работает", paused: "пауза", burned: "сожжён" };
const KIND_LABEL: Record<string, string> = { human: "ответ", auto: "автоответ", bounce: "возврат", unknown: "—" };

const TABS = [
  ["plan", "План"],
  ["inbound", "Входящие"],
  ["templates", "Шаблоны"],
  ["stop", "Стоп-лист"],
  ["boxes", "Ящики"],
] as const;
type Tab = (typeof TABS)[number][0];

export function MailPage() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "plan") as Tab;
  const go = (t: Tab) => setParams(t === "plan" ? {} : { tab: t }, { replace: true });
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mail", "status"], queryFn: () => api<MailStatus>("/mail/status"), refetchInterval: 20_000 });
  const pause = useMutation({
    mutationFn: (paused: boolean) => api("/mail/pause", { method: "POST", body: { paused } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }),
  });
  const st = status.data;
  return (
    <Content wide>
      <PageHeader
        title="Рассылка"
        meta="Автоотправка писем продавцам из очереди лидогенерации — только с холодных доменов"
        actions={
          st && (
            <>
              <span className={`rounded px-2 py-1 text-xs font-medium ${st.settings.mode === "live" ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"}`}>
                {st.settings.mode === "live" ? "Боевой режим" : st.settings.mode === "test" ? `Тест → ${st.settings.testAddress || "адрес не задан"}` : "Dry-run: не отправляется"}
              </span>
              {st.settings.paused ? (
                <button type="button" className="btn btn-primary" disabled={!admin || pause.isPending} onClick={() => pause.mutate(false)} title={admin ? "" : "Снять паузу может администратор"}>
                  Снять паузу
                </button>
              ) : (
                <button type="button" className="btn btn-danger" disabled={pause.isPending} onClick={() => window.confirm("Остановить отправку со всех ящиков?") && pause.mutate(true)}>
                  Пауза всей рассылки
                </button>
              )}
            </>
          )
        }
      />
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-neutral-800" aria-label="Вкладки">
        {TABS.filter(([k]) => k !== "boxes" || admin).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => go(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "border-accent font-medium text-accent dark:text-accent-bright" : "border-transparent text-slate-600 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100"}`}
          >
            {label}
            {key === "inbound" && st?.unresolved ? <span className="ml-1 rounded-full bg-accent px-1.5 text-[11px] text-white">{st.unresolved}</span> : null}
          </button>
        ))}
      </nav>
      <ErrorBox error={status.error ?? pause.error} />
      {status.isLoading && <Spinner />}
      {st && (
        <>
          {tab === "plan" && <PlanTab st={st} admin={admin} />}
          {tab === "inbound" && <InboundTab />}
          {tab === "templates" && <TemplatesTab st={st} />}
          {tab === "stop" && <StopTab admin={admin} />}
          {tab === "boxes" && admin && <BoxesTab st={st} />}
        </>
      )}
    </Content>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`rounded px-2 py-1 text-xs ${ok ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200" : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"}`}>{children}</span>;
}

// ── План и журнал ────────────────────────────────────────────────────────────

function RunPanel({ st }: { st: MailStatus }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number[]>(st.run?.mailboxIds ?? []);
  const start = useMutation({
    mutationFn: () => api<{ plan: PlanSummary }>("/mail/run", { method: "POST", body: { mailboxIds: selected } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }),
  });
  const started = Boolean(st.run);
  const chosen = st.run ? st.mailboxes.filter((m) => st.run!.mailboxIds.includes(m.id)) : st.mailboxes.filter((m) => selected.includes(m.id));
  const capacity = chosen.reduce((sum, m) => sum + m.remainingToday, 0);
  const toggle = (id: number) => {
    if (started) return;
    setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : old.length < MAX_MAILBOXES_PER_RUN ? [...old, id] : old);
  };
  const selectAll = () => setSelected(st.mailboxes.filter((m) => m.availableForRun).slice(0, MAX_MAILBOXES_PER_RUN).map((m) => m.id));
  return (
    <div className="panel space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-semibold">{started ? `Рассылка на ${st.day} запущена` : "Запуск рассылки на сегодня"}</div>
          <div className="text-xs muted">
            {started ? `Выбрано ящиков: ${st.run!.mailboxIds.length}. Новые касания можно добавить кнопкой «Допланировать».` : `Выберите до ${MAX_MAILBOXES_PER_RUN} ящиков. Планироваться и отправляться будут только письма с них.`}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div><b>{chosen.length}</b> ящиков · доступно <b>{capacity}</b> писем сегодня</div>
          {!started && <button type="button" className="link text-xs" onClick={selectAll}>Выбрать все доступные (до {MAX_MAILBOXES_PER_RUN})</button>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {st.mailboxes.map((m) => {
          const checked = started ? st.run!.mailboxIds.includes(m.id) : selected.includes(m.id);
          return (
            <label key={m.id} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${checked ? "border-accent bg-accent/5" : "border-slate-200 dark:border-neutral-700"} ${!started && m.availableForRun ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" className="mt-0.5" checked={checked} disabled={started || !m.availableForRun || (!checked && selected.length >= MAX_MAILBOXES_PER_RUN)} onChange={() => toggle(m.id)} />
              <span className="min-w-0">
                <span className="block break-all font-medium">{m.email}</span>
                <span className="muted">
                  {BOX_STATUS[m.status] ?? m.status} · ступень {m.warmupStage}, лимит {m.todayLimit}
                  {` · live отправлено ${m.liveSentToday}, осталось ${m.remainingToday}`}
                </span>
                {!m.usable && <span className="block text-red-600 dark:text-red-400">{m.pauseReason || (m.domainStatus !== "active" ? "домен не активен" : "ящик недоступен")}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {!st.mailboxes.length && <EmptyState title="Сначала добавьте ящики во вкладке «Ящики»" />}
      <ErrorBox error={start.error} />
      {!started && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selected.length || start.isPending || !st.agent.alive}
          title={!st.agent.alive ? "Сначала запустите локального агента на рабочем компьютере" : ""}
          onClick={() => (st.settings.mode !== "live" || window.confirm(`Боевой режим: начать отправку продавцам через ${selected.length} ящиков?`)) && start.mutate()}
        >
          {start.isPending ? "Строим план…" : `Начать рассылку${st.settings.mode === "live" ? "" : st.settings.mode === "test" ? " (тест)" : " (dry-run)"}`}
        </button>
      )}
    </div>
  );
}

function PlanTab({ st, admin }: { st: MailStatus; admin: boolean }) {
  const qc = useQueryClient();
  const [day, setDay] = useState(st.day);
  const [open, setOpen] = useState<number | null>(null);
  const messages = useQuery({ queryKey: ["mail", "messages", day], queryFn: () => api<{ messages: Message[] }>(`/mail/messages?day=${day}`) });
  const plan = useMutation({ mutationFn: () => api<{ plan: PlanSummary }>("/mail/plan", { method: "POST" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }) });
  const cancel = useMutation({ mutationFn: (id: number) => api(`/mail/messages/${id}/cancel`, { method: "POST" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }) });
  const p = st.state.lastPlan;
  const t = st.today;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge ok={st.agent.alive}>{st.agent.alive ? `локальный агент работает${st.agent.host ? `: ${st.agent.host}` : ""}` : "локальный агент не запущен на рабочем ПК"}</Badge>
        <Badge ok={st.secretKey}>{st.secretKey ? "ключ шифрования есть" : "нет MAILBOX_SECRET_KEY"}</Badge>
        <Badge ok={st.mailboxes.some((m) => m.status === "active" || m.status === "warming")}>ящиков в работе: {st.mailboxes.filter((m) => m.status === "active" || m.status === "warming").length}</Badge>
        <Badge ok>
          окно {st.settings.windowStart}–{st.settings.windowEnd}, {st.settings.timezone}
        </Badge>
      </div>
      <RunPanel st={st} />
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <div>
          Сегодня ({st.day}): в плане <b>{t.planned ?? 0}</b>, отправлено <b>{t.sent ?? 0}</b>, журнал dry-run <b>{t.dry_run ?? 0}</b>, ошибок <b>{t.failed ?? 0}</b>, снято {t.cancelled ?? 0}
        </div>
        <div className="muted">в очереди лидогенерации на сегодня и раньше: {st.queueDue}</div>
        {p && (
          <div className="w-full text-xs muted">
            План {p.day} ({formatDateTime(p.at)}): {p.note ? p.note : `запланировано ${p.planned} (повторов ${p.followups}, первых ${p.firsts})`}
            {p.deferred > 0 && ` · перенесено ${p.deferred} на ${p.deferredTo}`}
            {p.noEmail > 0 && ` · без email ${p.noEmail} (остаются в «Сегодня» лидогенерации)`}
            {p.skipped > 0 && ` · снято ${p.skipped} (стоп-лист / уже ответили)`}
          </div>
        )}
        {st.run && (
          <button type="button" className="btn btn-sm ml-auto" disabled={plan.isPending} onClick={() => plan.mutate()} title="Добавить новые касания из очереди для уже выбранных ящиков">
            {plan.isPending ? "Планируем…" : "Допланировать новые касания"}
          </button>
        )}
      </div>
      <ErrorBox error={plan.error ?? cancel.error} />
      {admin && <MailSettingsForm settings={st.settings} />}
      <div className="flex items-center gap-2 text-sm">
        Журнал за
        <input type="date" className="input w-auto" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
      </div>
      {messages.isLoading && <Spinner />}
      {messages.data && !messages.data.messages.length && <EmptyState title="Писем нет" />}
      {messages.data && messages.data.messages.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
              <tr>
                <th className="px-3 py-2 font-medium">Время (МСК)</th>
                <th className="px-3 py-2 font-medium">Продавец</th>
                <th className="px-3 py-2 font-medium">Кому / с ящика</th>
                <th className="px-3 py-2 font-medium">Тема</th>
                <th className="px-3 py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {messages.data.messages.map((m) => (
                <tr key={m.id} className="cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-neutral-800/50" onClick={() => setOpen(m.id)}>
                  <td className="px-3 py-2 text-xs tabular-nums">{new Date(m.sentAt ?? m.scheduledAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: st.settings.timezone })}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-medium">{m.brand ?? m.legalName}</div>
                    <div className="muted">ИНН {m.sellerInn}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{m.sentTo && m.sentTo !== m.toEmail ? `${m.sentTo} (вместо ${m.toEmail})` : m.toEmail}</div>
                    <div className="muted">{m.mailbox}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.touch === "followup" && <span className="mr-1 rounded bg-indigo-600 px-1 text-[10px] text-white">повтор</span>}
                    {m.subject}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className={m.status === "failed" ? "text-red-600 dark:text-red-400" : ""}>{STATUS_LABEL[m.status] ?? m.status}{m.mode && m.status === "sent" ? ` · ${m.mode}` : ""}</div>
                    {m.error && <div className="muted">{m.error}</div>}
                    {m.status === "planned" && (
                      <button
                        type="button"
                        className="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancel.mutate(m.id);
                        }}
                      >
                        снять
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <MessageDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MessageDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error } = useQuery({ queryKey: ["mail", "message", id], queryFn: () => api<{ message: Message & { body: string; messageId: string; inReplyTo: string | null; variants: { subject: number[]; body: number[] }; templateVersion: number | null } }>(`/mail/messages/${id}`) });
  const m = data?.message;
  return (
    <Modal title={m ? m.subject : "Письмо"} onClose={onClose} wide>
      <ErrorBox error={error} />
      {m && (
        <div className="space-y-2 text-sm">
          <div className="text-xs muted">
            Кому: {m.sentTo ?? m.toEmail} · {STATUS_LABEL[m.status] ?? m.status} · шаблон {m.templateId ?? "—"} v{m.templateVersion ?? "—"} · варианты темы [{m.variants.subject.join(", ")}], текста [{m.variants.body.join(", ")}]
          </div>
          <div className="text-xs muted break-all">
            Message-ID: {m.messageId}
            {m.inReplyTo && ` · In-Reply-To: ${m.inReplyTo}`}
          </div>
          <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm dark:bg-neutral-800">{m.body}</pre>
        </div>
      )}
    </Modal>
  );
}

function MailSettingsForm({ settings }: { settings: MailSettings }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...settings, holidays: settings.holidays.join("\n") });
  const save = useMutation({
    mutationFn: () => api("/mail/settings", { method: "PUT", body: { ...v, holidays: v.holidays.split(/\s+/).filter(Boolean) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mail"] });
      setOpen(false);
    },
  });
  return (
    <div>
      <button type="button" className="link text-sm" onClick={() => setOpen(!open)}>
        {open ? "Скрыть настройки" : "Режим и настройки"}
      </button>
      {open && (
        <div className="panel mt-2 space-y-3 p-4 text-sm">
          <fieldset className="space-y-1">
            <legend className="label">Режим</legend>
            {(Object.keys(MAIL_MODES) as MailMode[]).map((k) => (
              <label key={k} className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={v.mode === k} onChange={() => setV({ ...v, mode: k })} />
                <span>{MAIL_MODES[k]}</span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="label">Тестовый адрес</span>
              <input className="input" value={v.testAddress} onChange={(e) => setV({ ...v, testAddress: e.target.value })} placeholder="you@gmail.com" />
            </label>
            <label className="block">
              <span className="label">Окно с</span>
              <input type="time" className="input" value={v.windowStart} onChange={(e) => setV({ ...v, windowStart: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">до</span>
              <input type="time" className="input" value={v.windowEnd} onChange={(e) => setV({ ...v, windowEnd: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Не чаще, мин</span>
              <input type="number" min={1} className="input" value={v.minGapMinutes} onChange={(e) => setV({ ...v, minGapMinutes: Number(e.target.value) })} />
            </label>
            <label className="block">
              <span className="label">Разброс (0,4 = ±40 %)</span>
              <input type="number" step={0.05} min={0} className="input" value={v.jitter} onChange={(e) => setV({ ...v, jitter: Number(e.target.value) })} />
            </label>
          </div>
          <div>
            <span className="label">Рабочие дни</span>
            <div className="flex flex-wrap gap-3">
              {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" checked={v.workdays.includes(i + 1)} onChange={(e) => setV({ ...v, workdays: e.target.checked ? [...v.workdays, i + 1].sort() : v.workdays.filter((x) => x !== i + 1) })} />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="label">Праздники РФ (ГГГГ-ММ-ДД, по одному в строке) — писем нет</span>
            <textarea className="input min-h-[60px] font-mono text-xs" value={v.holidays} onChange={(e) => setV({ ...v, holidays: e.target.value })} />
          </label>
          <ErrorBox error={save.error} />
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => (v.mode !== "live" || window.confirm("Боевой режим: письма пойдут продавцам. Включить?")) && save.mutate()}>
            Сохранить
          </button>
        </div>
      )}
    </div>
  );
}

// ── Входящие ─────────────────────────────────────────────────────────────────

function InboundTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("unresolved");
  const qs = filter === "unresolved" ? "kind=human&unresolved=1" : filter === "all" ? "" : `kind=${filter}`;
  const { data, isLoading, error } = useQuery({ queryKey: ["mail", "inbound", qs], queryFn: () => api<{ inbound: Inbound[] }>(`/mail/inbound?${qs}&days=90`) });
  const resolve = useMutation({
    mutationFn: (v: { id: number; resolution: string }) => api(`/mail/inbound/${v.id}/resolve`, { method: "POST", body: { resolution: v.resolution } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }),
  });
  return (
    <div className="space-y-3">
      <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Фильтр">
        <option value="unresolved">Ответы — не разобраны</option>
        <option value="human">Все ответы</option>
        <option value="bounce">Возвраты</option>
        <option value="auto">Автоответы</option>
        <option value="all">Всё входящее</option>
      </select>
      {isLoading && <Spinner />}
      <ErrorBox error={error ?? resolve.error} />
      {data && !data.inbound.length && <EmptyState title="Пусто" />}
      {data?.inbound.map((m) => (
        <div key={m.id} className="panel p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-neutral-800">{KIND_LABEL[m.kind] ?? m.kind}</span>
              <b>{m.brand ?? m.legalName ?? m.fromName ?? m.fromEmail}</b> <span className="muted">{m.fromEmail}</span>
              {m.sellerInn && <span className="muted"> · ИНН {m.sellerInn}</span>}
            </div>
            <div className="text-xs muted">
              {m.receivedAt && formatDateTime(m.receivedAt)} · {m.mailbox}
            </div>
          </div>
          <div className="mt-1 text-xs muted">{m.subject}</div>
          {m.bouncedEmail && <div className="mt-1 text-xs text-red-600 dark:text-red-400">не доставлено: {m.bouncedEmail}</div>}
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans">{m.text}</pre>
          {m.kind === "human" && m.sellerInn && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {m.refusalHint && !m.resolution && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">похоже на отказ</span>}
              {m.resolution ? (
                <span className="text-xs muted">разобрано: {{ replied_pos: "Ответил +", replied_neg: "Ответил −", stop: "отказ, в стоп-листе" }[m.resolution] ?? m.resolution}</span>
              ) : (
                <>
                  <button type="button" className="btn btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: m.id, resolution: "replied_pos" })}>
                    Ответил +
                  </button>
                  <button type="button" className="btn btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: m.id, resolution: "replied_neg" })}>
                    Ответил −
                  </button>
                  <button type="button" className="btn btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: m.id, resolution: "stop" })}>
                    Отказ — в стоп-лист
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Шаблоны ──────────────────────────────────────────────────────────────────

function TemplatesTab({ st }: { st: MailStatus }) {
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const templates = useQuery({ queryKey: ["mail", "templates"], queryFn: () => api<{ templates: Template[] }>("/mail/templates") });
  const cats = useQuery({ queryKey: ["mail", "categories"], queryFn: () => api<{ categories: Category[] }>("/mail/categories") });
  const catName = (t: Template) =>
    t.categoryId ? (cats.data?.categories.find((c) => c.id === t.categoryId)?.name ?? `#${t.categoryId}`) : t.forMarking === true ? "все с маркировкой" : t.forMarking === false ? "все без маркировки" : "все категории";
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn" onClick={() => setEditing("new")}>
          <IconPlus size={14} /> Шаблон
        </button>
      </div>
      <ErrorBox error={templates.error} />
      <div className="panel divide-line">
        {templates.data?.templates.map((t) => (
          <div key={t.id} className={`flex items-start gap-3 px-4 py-3 text-sm ${t.active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {t.name || t.subject} <span className="text-xs muted">· {t.touch === "first" ? "первое письмо" : "повтор"} · {catName(t)} · v{t.version}</span>
              </div>
              <div className="text-xs muted">Тема: {t.subject}</div>
            </div>
            <button type="button" className="icon-btn" onClick={() => setEditing(t)} aria-label="Изменить">
              <IconPencil size={14} />
            </button>
          </div>
        ))}
      </div>
      <Preview st={st} templates={templates.data?.templates ?? []} />
      {cats.data && <CategoryMailFields categories={cats.data.categories} />}
      {editing && <TemplateDialog template={editing === "new" ? null : editing} categories={cats.data?.categories ?? []} aiEnabled={st.ai} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateDialog({ template, categories, aiEnabled, onClose }: { template: Template | null; categories: Category[]; aiEnabled: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const scopeOf = (t: Template | null) => (t?.categoryId ? String(t.categoryId) : t?.forMarking === true ? "marking" : t?.forMarking === false ? "plain" : "all");
  const [v, setV] = useState({ name: template?.name ?? "", touch: template?.touch ?? "first", scope: scopeOf(template), subject: template?.subject ?? "", body: template?.body ?? "", active: template?.active ?? true });
  const [ai, setAi] = useState({ operation: template ? "improve" : "create", instruction: "" });
  const assist = useMutation({
    mutationFn: () => {
      const category = categories.find((c) => String(c.id) === v.scope);
      return api<{ subject: string; body: string }>("/mail/templates/ai", {
        method: "POST",
        body: {
          operation: ai.operation,
          touch: v.touch,
          category: category?.name ?? (v.scope === "marking" ? "все категории с маркировкой" : v.scope === "plain" ? "все категории без маркировки" : "все категории"),
          marking: v.scope === "marking" || Boolean(category?.marking),
          subject: v.subject,
          body: v.body,
          instruction: ai.instruction,
        },
      });
    },
    onSuccess: (result) => setV((old) => ({ ...old, subject: result.subject, body: result.body })),
  });
  const save = useMutation({
    mutationFn: () => {
      const scope = v.scope === "all" || v.scope === "marking" || v.scope === "plain" ? { categoryId: null, forMarking: v.scope === "marking" ? true : v.scope === "plain" ? false : null } : { categoryId: Number(v.scope), forMarking: null };
      return api(template ? `/mail/templates/${template.id}` : "/mail/templates", { method: template ? "PATCH" : "POST", body: { name: v.name, touch: v.touch, subject: v.subject, body: v.body, active: v.active, ...scope } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mail"] });
      onClose();
    },
  });
  return (
    <Modal
      title={template ? `Шаблон v${template.version}` : "Новый шаблон"}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить{template ? " (новая версия)" : ""}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Название</span>
            <input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Касание</span>
            <select className="input" value={v.touch} onChange={(e) => setV({ ...v, touch: e.target.value })}>
              <option value="first">Первое письмо</option>
              <option value="followup">Повтор</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Для</span>
            <select className="input" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })}>
              <option value="all">Все категории</option>
              <option value="marking">Все с маркировкой</option>
              <option value="plain">Все без маркировки</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        {aiEnabled && (
          <div className="rounded-md border border-slate-200 p-3 dark:border-neutral-700">
            <div className="mb-2 font-medium">Claude · создание и унификация шаблона</div>
            <div className="grid gap-2 sm:grid-cols-[220px_1fr_auto]">
              <select className="input" value={ai.operation} onChange={(e) => setAi({ ...ai, operation: e.target.value })}>
                <option value="create">Создать заново</option>
                <option value="improve">Улучшить текущий</option>
                <option value="unify">Привести к единому стилю</option>
              </select>
              <input className="input" value={ai.instruction} onChange={(e) => setAi({ ...ai, instruction: e.target.value })} placeholder="Например: короче, мягче, без давления" />
              <button type="button" className="btn" disabled={assist.isPending} onClick={() => assist.mutate()}>
                {assist.isPending ? "Claude пишет…" : "Применить ИИ"}
              </button>
            </div>
            <div className="mt-1 text-xs muted">Результат заполнит черновик ниже. Проверьте его и сохраните — в рассылку он попадёт только после сохранения.</div>
            <ErrorBox error={assist.error} />
          </div>
        )}
        <label className="block">
          <span className="label">Тема</span>
          <input className="input" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Текст (только текст, без HTML)</span>
          <textarea className="input min-h-[240px] font-mono text-xs" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
        </label>
        <div className="text-xs muted">
          Варианты: {"{вариант 1|вариант 2}"} — выбирается один, один и тот же для продавца. Подстановки:{" "}
          {Object.entries(PLACEHOLDERS).map(([k, d]) => (
            <span key={k} className="mr-2 inline-block" title={d}>
              <code>{`{${k}}`}</code>
            </span>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          Активен
        </label>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}

function Preview({ st, templates }: { st: MailStatus; templates: Template[] }) {
  const [inn, setInn] = useState("");
  const [touch, setTouch] = useState<"first" | "followup">("first");
  const [templateId, setTemplateId] = useState("");
  const [mailboxId, setMailboxId] = useState(String(st.mailboxes[0]?.id ?? ""));
  const preview = useMutation({
    mutationFn: () => api<{ subject: string; body: string; from: string; templateId: number }>("/mail/preview", { method: "POST", body: { inn: inn.trim(), mailboxId: Number(mailboxId), touch, templateId: templateId ? Number(templateId) : null } }),
  });
  const chain = useMutation({
    mutationFn: () => api<{ queued: boolean; first: { status: string; error?: string }; followup?: { status: string; error?: string } }>("/mail/test-chain", { method: "POST", body: { inn: inn.trim(), mailboxId: Number(mailboxId) } }),
  });
  return (
    <div className="panel space-y-3 p-4 text-sm">
      <div className="font-semibold">Предпросмотр и тест</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">ИНН продавца</span>
          <input className="input w-40" value={inn} onChange={(e) => setInn(e.target.value)} placeholder="из «Базы»" />
        </label>
        <label className="block">
          <span className="label">Ящик</span>
          <select className="input w-auto" value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            {st.mailboxes.map((m) => (
              <option key={m.id} value={m.id}>{m.email}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Касание</span>
          <select className="input w-auto" value={touch} onChange={(e) => setTouch(e.target.value as "first" | "followup")}>
            <option value="first">Первое</option>
            <option value="followup">Повтор</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Шаблон</span>
          <select className="input w-auto" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">как при отправке</option>
            {templates.filter((t) => t.touch === touch).map((t) => (
              <option key={t.id} value={t.id}>{t.name || t.subject}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={!inn.trim() || !mailboxId || preview.isPending} onClick={() => preview.mutate()}>
          Показать
        </button>
        <button
          type="button"
          className="btn"
          disabled={!inn.trim() || !mailboxId || chain.isPending}
          title="Первое письмо и повтор в той же цепочке — сразу на тестовый адрес из настроек; статусы продавца не меняются"
          onClick={() => chain.mutate()}
        >
          Тест цепочки → {st.settings.testAddress || "тестовый адрес не задан"}
        </button>
      </div>
      <ErrorBox error={preview.error ?? chain.error} />
      {chain.data && (
        <div className="text-xs">
          {chain.data.queued
            ? "Первое письмо и повтор поставлены в очередь локального агента. Они будут отправлены на тестовый адрес с сохранением цепочки; статусы продавца и прогрев не меняются."
            : `Первое: ${chain.data.first.status}${chain.data.first.error ? ` (${chain.data.first.error})` : ""}${chain.data.followup ? ` · повтор: ${chain.data.followup.status}${chain.data.followup.error ? ` (${chain.data.followup.error})` : ""}` : ""}`}
        </div>
      )}
      {preview.data && (
        <div className="rounded-md border border-slate-200 p-3 dark:border-neutral-700">
          <div className="text-xs muted">От: {preview.data.from}</div>
          <div className="font-medium">{preview.data.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.data.body}</pre>
        </div>
      )}
    </div>
  );
}

function CategoryMailFields({ categories }: { categories: Category[] }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Category> }) => api(`/mail/categories/${v.id}`, { method: "PATCH", body: v.patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail", "categories"] }),
  });
  return (
    <div className="panel p-4 text-sm">
      <div className="mb-2 font-semibold">Категории в письмах</div>
      <ErrorBox error={save.error} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs muted">
          <tr>
            <th className="py-1 font-medium">Категория</th>
            <th className="py-1 font-medium">Страница /wb/…</th>
            <th className="py-1 font-medium">{"{category}"}</th>
            <th className="py-1 font-medium">{"{marking_note}"}</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className="align-top">
              <td className="py-1 pr-2 text-xs">{c.name}</td>
              {(["slug", "mailName", "mailNote"] as const).map((k) => (
                <td key={k} className="py-1 pr-2">
                  <input
                    className="input text-xs"
                    defaultValue={c[k]}
                    disabled={k === "mailNote" && !c.marking}
                    placeholder={k === "mailNote" && !c.marking ? "без маркировки" : ""}
                    onBlur={(e) => e.target.value !== c[k] && save.mutate({ id: c.id, patch: { [k]: e.target.value } })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Стоп-лист ────────────────────────────────────────────────────────────────

function StopTab({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ inn: "", email: "", reason: "" });
  const { data, isLoading, error } = useQuery({ queryKey: ["mail", "stoplist"], queryFn: () => api<{ stoplist: { id: number; inn: string | null; email: string | null; reason: string; createdAt: string; legalName: string | null }[] }>("/mail/stoplist") });
  const add = useMutation({
    mutationFn: () => api("/mail/stoplist", { method: "POST", body: v }),
    onSuccess: () => {
      setV({ inn: "", email: "", reason: "" });
      void qc.invalidateQueries({ queryKey: ["mail"] });
    },
  });
  const del = useMutation({ mutationFn: (id: number) => api(`/mail/stoplist/${id}`, { method: "DELETE" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }) });
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-end gap-2 p-4 text-sm">
        <label className="block">
          <span className="label">ИНН</span>
          <input className="input w-40" value={v.inn} onChange={(e) => setV({ ...v, inn: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">или email</span>
          <input className="input w-56" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </label>
        <label className="block flex-1">
          <span className="label">Причина</span>
          <input className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </label>
        <button type="button" className="btn btn-primary" disabled={add.isPending || (!v.inn.trim() && !v.email.trim())} onClick={() => add.mutate()}>
          Не писать
        </button>
      </div>
      <ErrorBox error={error ?? add.error ?? del.error} />
      {isLoading && <Spinner />}
      {data && !data.stoplist.length && <EmptyState title="Стоп-лист пуст" />}
      {data && data.stoplist.length > 0 && (
        <div className="panel divide-line text-sm">
          {data.stoplist.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="font-medium">{r.email ?? (r.inn ? `ИНН ${r.inn}` : "—")}</span>
              {r.email && r.inn && <span className="text-xs muted">ИНН {r.inn}</span>}
              {r.legalName && <span className="text-xs muted">{r.legalName}</span>}
              <span className="text-xs muted">{r.reason}</span>
              <span className="ml-auto text-xs muted">{formatDateTime(r.createdAt)}</span>
              {admin && (
                <button type="button" className="link text-xs" onClick={() => window.confirm("Убрать из стоп-листа?") && del.mutate(r.id)}>
                  убрать
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ящики и домены (админ) ───────────────────────────────────────────────────

function BoxesTab({ st }: { st: MailStatus }) {
  const qc = useQueryClient();
  const domains = useQuery({ queryKey: ["mail", "domains"], queryFn: () => api<{ domains: Domain[] }>("/mail/domains") });
  const [newDomain, setNewDomain] = useState("");
  const [editing, setEditing] = useState<Mailbox | "new" | null>(null);
  const [agentToken, setAgentToken] = useState("");
  const addDomain = useMutation({
    mutationFn: () => api("/mail/domains", { method: "POST", body: { domain: newDomain } }),
    onSuccess: () => {
      setNewDomain("");
      void qc.invalidateQueries({ queryKey: ["mail"] });
    },
  });
  const issueToken = useMutation({
    mutationFn: () => api<{ token: string }>("/mail/agent/token", { method: "POST" }),
    onSuccess: (result) => {
      setAgentToken(result.token);
      void qc.invalidateQueries({ queryKey: ["mail"] });
    },
  });
  return (
    <div className="space-y-4">
      <div className="panel space-y-2 p-4 text-sm">
        <div className="font-semibold">Холодные домены</div>
        <p className="text-xs muted">Только отдельные домены для рассылки. tlkbars.ru и его поддомены не принимаются.</p>
        {domains.data?.domains.map((d) => (
          <div key={d.id} className="flex flex-wrap gap-3 text-sm">
            <b>{d.domain}</b>
            <span className="muted">{d.landingBaseUrl}</span>
            <span className="muted">{{ active: "работает", paused: "пауза", burned: "сожжён" }[d.status] ?? d.status}</span>
          </div>
        ))}
        <div className="flex gap-2">
          <input className="input w-64" placeholder="tlkbars-import.ru" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} />
          <button type="button" className="btn" disabled={!newDomain.trim() || addDomain.isPending} onClick={() => addDomain.mutate()}>
            Добавить домен
          </button>
        </div>
        <ErrorBox error={addDomain.error ?? domains.error} />
      </div>
      <div className="panel space-y-2 p-4 text-sm">
        <div className="font-semibold">Локальный агент на рабочем ПК</div>
        <div className="text-xs muted">SMTP и IMAP выполняет только агент. Сервер планирует письма и хранит журнал. Запуск из каталога crm: <code>npm run mail:agent</code>.</div>
        <Badge ok={st.agent.alive}>{st.agent.alive ? `подключён${st.agent.host ? `: ${st.agent.host}` : ""}` : "не подключён"}</Badge>
        <div>
          <button type="button" className="btn btn-sm" disabled={issueToken.isPending} onClick={() => window.confirm("Новый ключ отключит прежний. Выпустить?") && issueToken.mutate()}>
            {st.agent.hasKey ? "Выпустить новый ключ" : "Выпустить ключ агента"}
          </button>
        </div>
        {agentToken && (
          <label className="block">
            <span className="label">Ключ показан один раз — сохраните в CRM_MAIL_AGENT_TOKEN на рабочем ПК</span>
            <textarea className="input font-mono text-xs" readOnly value={agentToken} onFocus={(e) => e.target.select()} />
          </label>
        )}
        <ErrorBox error={issueToken.error} />
      </div>
      <div className="flex justify-end">
        <button type="button" className="btn" disabled={!domains.data?.domains.length} onClick={() => setEditing("new")}>
          <IconPlus size={14} /> Ящик
        </button>
      </div>
      <div className="panel divide-line text-sm">
        {!st.mailboxes.length && <EmptyState title="Ящиков нет" />}
        {st.mailboxes.map((m) => (
          <MailboxRow key={m.id} m={m} testAddress={st.settings.testAddress} onEdit={() => setEditing(m)} />
        ))}
      </div>
      {editing && <MailboxDialog mailbox={editing === "new" ? null : editing} domains={domains.data?.domains ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MailboxRow({ m, testAddress, onEdit }: { m: Mailbox; testAddress: string; onEdit: () => void }) {
  const qc = useQueryClient();
  const [testTo, setTestTo] = useState(testAddress);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [special, setSpecial] = useState({ limit: String(m.warmupLimitOverride ?? m.todayLimit), reason: "" });
  const updated = { onSuccess: () => void qc.invalidateQueries({ queryKey: ["mail"] }) };
  const check = useMutation({ mutationFn: () => api<{ queued: boolean }>(`/mail/mailboxes/${m.id}/check`, { method: "POST", body: { testTo } }), ...updated });
  const poll = useMutation({ mutationFn: () => api<{ queued: boolean }>(`/mail/mailboxes/${m.id}/poll`, { method: "POST" }), ...updated });
  const review = useMutation({ mutationFn: () => api(`/mail/mailboxes/${m.id}/review-bounces`, { method: "POST" }), ...updated });
  const override = useMutation({
    mutationFn: (limit: number | null) => api(`/mail/mailboxes/${m.id}/limit-override`, { method: "POST", body: { limit, reason: special.reason } }),
    ...updated,
  });
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {m.fromName ? `${m.fromName} <${m.email}>` : m.email}{" "}
            <span className="text-xs muted">· {BOX_STATUS[m.status] ?? m.status} · ступень {m.warmupStage}/5 · лимит {m.todayLimit}/день</span>
          </div>
          <div className="text-xs muted">
            Сегодня live: {m.liveSentToday} · занято в плане: {m.usedToday} · осталось: {m.remainingToday} · отправочных дней ступени: {m.warmupDays}/5 · live за ступень: {m.warmupStageSent}/25
          </div>
          <div className="text-xs muted">
            Ручной предел: {m.dailyLimit}{m.warmupLimitOverride !== null ? ` · особый лимит: ${m.warmupLimitOverride}` : ""} · возвраты ступени: {m.warmupBounces} ({(m.warmupBounceRate * 100).toFixed(1)}%)
          </div>
          <div className="text-xs muted">
            SMTP {m.smtpHost}:{m.smtpPort}{m.smtpSecure ? " SSL" : " STARTTLS"} — {m.smtpVerifiedAt ? `проверен ${formatDateTime(m.smtpVerifiedAt)}` : "не проверен"} · IMAP {m.imapHost}:{m.imapPort} — {m.imapVerifiedAt ? `проверен ${formatDateTime(m.imapVerifiedAt)}` : "не проверен"}
          </div>
          {m.warmupHoldReason && <div className="text-xs text-amber-700 dark:text-amber-300">удержание ступени: {m.warmupHoldReason}</div>}
          {m.warmupFirstsPaused && <div className="text-xs text-red-600 dark:text-red-400">Новые первые касания остановлены до проверки базы. Повторы и IMAP продолжаются.</div>}
          {m.pauseReason && <div className="text-xs text-red-600 dark:text-red-400">пауза: {m.pauseReason}{m.pausedUntil ? ` до ${formatDateTime(m.pausedUntil)}` : " до исправления конфигурации"}</div>}
          {m.smtpError && <div className="text-xs text-red-600 dark:text-red-400">SMTP: {m.smtpError}</div>}
          {m.imapError && <div className="text-xs text-red-600 dark:text-red-400">IMAP: {m.imapError}</div>}
        </div>
        <button type="button" className="icon-btn" onClick={onEdit} aria-label="Изменить">
          <IconPencil size={14} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-56 text-xs" placeholder="тестовое письмо на…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <button type="button" className="btn btn-sm" disabled={check.isPending || Boolean(m.checkRequestedAt)} onClick={() => check.mutate()}>
          {m.checkRequestedAt ? "Проверка ждёт агента" : "Проверить через агента"}
        </button>
        <button type="button" className="btn btn-sm" disabled={poll.isPending || Boolean(m.imapPollRequestedAt)} onClick={() => poll.mutate()}>
          {m.imapPollRequestedAt ? "Опрос ждёт агента" : "Проверить входящие"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setSpecialOpen(!specialOpen)}>Особый лимит</button>
        {m.warmupFirstsPaused && <button type="button" className="btn btn-sm" disabled={review.isPending} onClick={() => window.confirm("База и невалидные адреса проверены? Разрешить первые касания заново?") && review.mutate()}>База проверена</button>}
        {(check.data || poll.data) && <span className="text-xs">Задание передано локальному агенту; результат появится после выполнения.</span>}
      </div>
      {specialOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3 text-xs dark:bg-neutral-800/50">
          <label><span className="label">Лимит вместо алгоритма (0–500)</span><input className="input w-32" type="number" value={special.limit} onChange={(e) => setSpecial({ ...special, limit: e.target.value })} /></label>
          <label className="min-w-64 flex-1"><span className="label">Причина (обязательно, пишется в журнал)</span><input className="input" value={special.reason} onChange={(e) => setSpecial({ ...special, reason: e.target.value })} /></label>
          <button type="button" className="btn btn-sm" disabled={override.isPending || !special.reason.trim()} onClick={() => override.mutate(Number(special.limit))}>Применить</button>
          {m.warmupLimitOverride !== null && <button type="button" className="btn btn-sm" disabled={override.isPending} onClick={() => override.mutate(null)}>Снять особый лимит</button>}
        </div>
      )}
      <ErrorBox error={check.error ?? poll.error ?? review.error ?? override.error} />
    </div>
  );
}

function MailboxDialog({ mailbox, domains, onClose }: { mailbox: Mailbox | null; domains: Domain[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    email: mailbox?.email ?? "",
    fromName: mailbox?.fromName ?? "",
    domainId: String(mailbox?.domainId ?? domains[0]?.id ?? ""),
    smtpHost: mailbox?.smtpHost ?? "smtp.yandex.ru",
    smtpPort: String(mailbox?.smtpPort ?? 465),
    smtpSecure: mailbox?.smtpSecure ?? true,
    smtpUser: mailbox?.smtpUser ?? "",
    imapHost: mailbox?.imapHost ?? "imap.yandex.ru",
    imapPort: String(mailbox?.imapPort ?? 993),
    imapUser: mailbox?.imapUser ?? "",
    password: "",
    signature: mailbox?.signature ?? "",
    dailyLimit: String(mailbox?.dailyLimit ?? 25),
    status: mailbox?.status ?? "warming",
  });
  const save = useMutation({
    mutationFn: () =>
      api(mailbox ? `/mail/mailboxes/${mailbox.id}` : "/mail/mailboxes", {
        method: mailbox ? "PATCH" : "POST",
        body: { ...v, domainId: Number(v.domainId), smtpPort: Number(v.smtpPort), imapPort: Number(v.imapPort), dailyLimit: Number(v.dailyLimit), smtpUser: v.smtpUser || v.email, imapUser: v.imapUser || v.email },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mail"] });
      onClose();
    },
  });
  const field = (k: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} />
    </label>
  );
  return (
    <Modal
      title={mailbox ? mailbox.email : "Новый ящик"}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          {field("email", "Email", { disabled: Boolean(mailbox), placeholder: "ivan@tlkbars-import.ru" })}
          {field("fromName", "Имя отправителя", { placeholder: "Иван Петров" })}
          <label className="block">
            <span className="label">Домен</span>
            <select className="input" value={v.domainId} disabled={Boolean(mailbox)} onChange={(e) => setV({ ...v, domainId: e.target.value })}>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.domain}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {field("smtpHost", "SMTP сервер")}
          {field("smtpPort", "порт", { inputMode: "numeric" })}
          <label className="mt-6 flex items-center gap-2">
            <input type="checkbox" checked={v.smtpSecure} onChange={(e) => setV({ ...v, smtpSecure: e.target.checked })} /> SSL (465)
          </label>
          {field("smtpUser", "логин SMTP", { placeholder: "= email" })}
          {field("imapHost", "IMAP сервер")}
          {field("imapPort", "порт", { inputMode: "numeric" })}
          {field("imapUser", "логин IMAP", { placeholder: "= email" })}
        </div>
        {field("password", mailbox ? "Пароль приложения (пусто — не менять)" : "Пароль приложения", { type: "password", autoComplete: "new-password" })}
        <label className="block">
          <span className="label">Подпись (текст; без ссылок на tlkbars.ru)</span>
          <textarea className="input min-h-[90px]" value={v.signature} onChange={(e) => setV({ ...v, signature: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("dailyLimit", "Ручной верхний предел писем в день", { inputMode: "numeric", min: 0, max: 500 })}
          <label className="block">
            <span className="label">Статус</span>
            <select className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
              {Object.entries(BOX_STATUS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
