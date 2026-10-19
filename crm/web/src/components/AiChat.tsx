/**
 * Окно чата с ИИ (кнопка в шапке, окно — в правом нижнем углу): вопросы по данным CRM простыми словами.
 * История — в sessionStorage вкладки; на сервер уходит только текст переписки.
 */

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";

import { useAiEnabled } from "../lib/ai.ts";
import { api, errorMessage } from "../lib/api.ts";
import { IconChat, IconSend, IconSparkles, IconTrash, IconX } from "./Icons.tsx";

type Message = { role: "user" | "assistant"; content: string; error?: boolean };

const STORAGE_KEY = "crm-ai-chat";

const SUGGESTIONS = [
  "Что по сделкам на этой неделе?",
  "Какие счета не оплачены?",
  "Где сейчас контейнеры и когда прибытие?",
  "Какие документы скоро истекают?",
];

function loadHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

/** **жирный** и [текст](/путь) внутри строки. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={`${key}-${i}`}>{inline(m[1], `${key}-${i++}b`)}</b>);
    else {
      const href = m[3].replace(/^\/crm(?=\/)/, "");
      out.push(
        href.startsWith("/") ? (
          <Link key={`${key}-${i++}`} to={href} className="text-accent underline dark:text-accent-bright">{m[2]}</Link>
        ) : /^https?:\/\//.test(href) ? (
          <a key={`${key}-${i++}`} href={href} target="_blank" rel="noreferrer" className="text-accent underline dark:text-accent-bright">{m[2]}</a>
        ) : (
          m[2]
        ),
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Немного markdown: абзацы, заголовки, списки, жирный, ссылки. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{inline(it, `li${blocks.length}-${j}`)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={blocks.length} className="list-disc space-y-0.5 pl-5">{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold">{inline(heading[1], `h${blocks.length}`)}</p>
      ) : (
        <p key={blocks.length}>{inline(line, `p${blocks.length}`)}</p>
      ),
    );
  }
  flush();
  return <div className="space-y-1.5">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}

export function AiChat() {
  const enabled = useAiEnabled();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // приватный режим — история просто не сохранится
    }
  }, [messages]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!enabled) return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Message[] = [...messages.filter((m) => !m.error), { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { reply } = await api<{ reply: string }>("/ai/chat", {
        method: "POST",
        body: { messages: next.map(({ role, content }) => ({ role, content })), page: location.pathname },
      });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: errorMessage(err), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const trigger = (
    <button type="button" className={`btn shrink-0 ${open ? "bg-accent-soft text-accent dark:bg-accent/20 dark:text-accent-bright" : ""}`} onClick={() => setOpen(!open)} title="Спросить ИИ о сделках, документах, оплатах">
      <IconChat size={14} />
      <span className="hidden sm:inline">Спросить ИИ</span>
    </button>
  );
  if (!open) return trigger;

  // Окно — порталом в body: у шапки backdrop-blur, внутри неё fixed позиционировался бы от шапки.
  const panel = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100vh-2rem))] sm:w-[420px] sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-2xl dark:bg-neutral-900 sm:dark:border-neutral-700">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-neutral-800">
        <IconSparkles className="text-accent dark:text-accent-bright" />
        <span className="mr-auto text-sm font-semibold">Помощник</span>
        {messages.length > 0 && (
          <button type="button" className="icon-btn" onClick={() => setMessages([])} title="Новый разговор" aria-label="Новый разговор" disabled={busy}>
            <IconTrash />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="Свернуть" aria-label="Свернуть">
          <IconX />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="muted">Спросите о сделках, контейнерах, оплатах, документах, клиентах — ИИ посмотрит в CRM и ответит. Только чтение: сам ничего не меняет.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="rounded-full border border-slate-200 px-3 py-1 text-left text-xs hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 dark:bg-accent/15">{m.content}</div>
          ) : (
            <div key={i} className={`mr-4 ${m.error ? "text-red-700 dark:text-red-400" : ""}`}>
              {m.error ? m.content : <Markdown text={m.content} />}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 muted">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Смотрю в CRM…
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          className="input max-h-40 min-h-[40px] flex-1 resize-none"
          rows={1}
          value={input}
          placeholder="Например: что с контейнером DEMU1000011?"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="btn btn-primary h-10 px-3" disabled={busy || !input.trim()} aria-label="Отправить">
          <IconSend />
        </button>
      </form>
    </div>
  );
  return (
    <>
      {trigger}
      {createPortal(panel, document.body)}
    </>
  );
}
