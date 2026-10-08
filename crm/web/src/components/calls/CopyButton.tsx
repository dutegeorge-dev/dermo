import { useEffect, useState } from "react";

import { IconCheck, IconCopy } from "../Icons.tsx";

/** Копирует текст в буфер ровно как набран. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Запасной путь (http, старые браузеры).
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await copyText(text);
          setState("done");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "done" ? <IconCheck size={14} className="text-green-600" /> : <IconCopy size={14} />}
      {state === "done" ? "Скопировано" : state === "error" ? "Не удалось" : "Копировать"}
    </button>
  );
}
