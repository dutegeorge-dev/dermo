/** Форма правки строки справочника. */

import { useEffect, useRef, useState } from "react";

import type { CallQa, CallTopic } from "../../lib/types.ts";
import { IconArrowDown, IconArrowUp, IconPlus, IconX } from "../Icons.tsx";
import { ErrorBox } from "../ui.tsx";

export type TopicDraft = { title: string; ask: string[]; qa: CallQa[] };

/** Textarea, растущая по содержимому. */
function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const { minRows = 2, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} className={`input resize-none ${rest.className ?? ""}`} />;
}

export function TopicEditor({
  topic,
  onSave,
  onCancel,
}: {
  topic?: CallTopic;
  onSave: (draft: TopicDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [askText, setAskText] = useState((topic?.ask ?? []).join("\n"));
  const [title, setTitle] = useState(topic?.title ?? "");
  const [qa, setQa] = useState<CallQa[]>(topic?.qa.map((x) => ({ ...x })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const updateQa = (index: number, patch: Partial<CallQa>) =>
    setQa((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const moveQa = (index: number, delta: number) =>
    setQa((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        ask: askText.split("\n").map((s) => s.trim()).filter(Boolean),
        qa: qa.filter((item) => item.q.trim() || item.a.trim()),
      });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 bg-slate-50/70 px-3 py-4 sm:px-4 dark:bg-neutral-800/30">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label className="label" htmlFor="ask">
            Вопросы клиенту — каждый с новой строки
          </label>
          <AutoTextarea id="ask" value={askText} onChange={(e) => setAskText(e.target.value)} minRows={2} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="title">
            Тема (коротко)
          </label>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
      </div>

      <div>
        <p className="label">Если клиент спрашивает</p>
        <ol className="space-y-3">
          {qa.map((item, i) => (
            <li key={i} className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    className="input font-medium"
                    placeholder="Вопрос клиента"
                    value={item.q}
                    onChange={(e) => updateQa(i, { q: e.target.value })}
                  />
                  <AutoTextarea
                    placeholder="Ответ — копируется в чат ровно как набран"
                    value={item.a}
                    onChange={(e) => updateQa(i, { a: e.target.value })}
                    minRows={3}
                  />
                </div>
                <div className="flex flex-col">
                  <button type="button" className="icon-btn" title="Выше" disabled={i === 0} onClick={() => moveQa(i, -1)}>
                    <IconArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Ниже"
                    disabled={i === qa.length - 1}
                    onClick={() => moveQa(i, 1)}
                  >
                    <IconArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn hover:text-red-600"
                    title="Удалить вопрос"
                    onClick={() => setQa((list) => list.filter((_, j) => j !== i))}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setQa((list) => [...list, { q: "", a: "" }])}>
          <IconPlus size={14} /> Вопрос клиента
        </button>
        <p className="mt-2 text-xs muted">
          В ответе: пустая строка — новый абзац; строка с «— » — пункт списка; «1. » — нумерованный пункт.
        </p>
      </div>

      <ErrorBox error={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </form>
  );
}
