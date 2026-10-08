/** Левая панель экрана документа: перетащить файл и посмотреть его рядом с формой. */

import { useEffect, useMemo, useRef, useState } from "react";

import { IconFile } from "../Icons.tsx";

export function FilePreview({ url, mime, name }: { url: string; mime: string; name: string }) {
  if (mime === "application/pdf") return <iframe src={url} title={name} className="h-[75vh] w-full rounded border border-slate-200 bg-white dark:border-neutral-800" />;
  if (mime.startsWith("image/")) return <img src={url} alt={name} className="max-h-[75vh] w-full rounded border border-slate-200 object-contain dark:border-neutral-800" />;
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded border border-dashed border-slate-300 text-sm muted dark:border-neutral-700">
      <IconFile size={24} />
      {name}
      <span className="text-xs">Предпросмотр есть для PDF и картинок</span>
    </div>
  );
}

export function FileDrop({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input ref={inputRef} type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file && url ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{file.name}</span>
            <span className="flex shrink-0 gap-1">
              <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>Другой файл</button>
              <button type="button" className="btn btn-sm" onClick={() => onFile(null)}>Убрать</button>
            </span>
          </div>
          <FilePreview url={url} mime={file.type} name={file.name} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`flex h-64 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm lg:h-[60vh] ${
            over ? "border-accent bg-accent-soft text-accent dark:bg-accent/10" : "border-slate-300 muted hover:border-slate-400 dark:border-neutral-700"
          }`}
        >
          <IconFile size={28} />
          <span className="font-medium">Перетащите файл сюда</span>
          <span className="text-xs">PDF, Excel, Word, фото — или нажмите, чтобы выбрать</span>
        </button>
      )}
    </div>
  );
}
