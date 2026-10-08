/** Мелкие общие компоненты интерфейса. */

import { type ReactNode, useEffect, useRef, useState } from "react";

import { errorMessage } from "../lib/api.ts";
import { IconX } from "./Icons.tsx";

export function Spinner({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-accent dark:border-neutral-700 dark:border-t-accent-bright" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[10vh] dark:bg-black/60" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-lg border border-slate-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconX />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-neutral-800">{footer}</div>}
      </div>
    </div>
  );
}

/** Окно подтверждения опасного действия. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Удалить",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e);
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{message}</div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-12 text-center">
      <p className="font-medium text-slate-700 dark:text-neutral-200">{title}</p>
      {children && <div className="mt-2 text-sm muted">{children}</div>}
    </div>
  );
}

/** Заголовок экрана: название слева, действия справа. */
export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="page-title break-words">{title}</h1>
        {meta && <div className="mt-1 text-xs muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
