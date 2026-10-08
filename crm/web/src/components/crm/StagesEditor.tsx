/** Редактор этапов воронки (admin): порядок, названия, цвета. Последний этап — завершающий. */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { STAGE_COLORS } from "../../../../shared/deal-fields.ts";
import { api } from "../../lib/api.ts";
import type { Stage } from "../../lib/types.ts";
import { IconArrowDown, IconArrowUp, IconGrip, IconPencil, IconPlus, IconTrash } from "../Icons.tsx";
import { ErrorBox, Modal } from "../ui.tsx";
import { StageChip } from "./common.tsx";

type Draft = { key?: string; name: string; color: string; dealCount: number; uid: string };

export function StagesEditor({ stages, onClose }: { stages: Stage[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [list, setList] = useState<Draft[]>(() =>
    stages.map((s) => ({ key: s.key, name: s.name, color: s.color, dealCount: s.dealCount, uid: s.key })),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [overUid, setOverUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (uid: string, patch: Partial<Draft>) => setList((l) => l.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  const moveTo = (uid: string, index: number) =>
    setList((l) => {
      const from = l.findIndex((s) => s.uid === uid);
      const next = [...l];
      const [item] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/stages", { method: "PUT", body: { stages: list.map(({ key, name, color }) => ({ key, name, color })) } });
      await queryClient.invalidateQueries({ queryKey: ["stages"] });
      await queryClient.invalidateQueries({ queryKey: ["deals"] });
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Этапы воронки"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs muted">
        Перетащите этап за ручку или стрелками. Последний этап — завершающий: сделка в нём считается успешной.
        Этап, на котором есть сделки, удалить нельзя — сначала перенесите их.
      </p>
      <ol className="space-y-1.5">
        {list.map((stage, i) => (
          <li
            key={stage.uid}
            onDragOver={(e) => {
              if (!dragUid || dragUid === stage.uid) return;
              e.preventDefault();
              setOverUid(stage.uid);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragUid) moveTo(dragUid, i);
              setDragUid(null);
              setOverUid(null);
            }}
            className={`rounded-md ${overUid === stage.uid ? "ring-2 ring-accent/50" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", stage.uid);
                  setDragUid(stage.uid);
                }}
                onDragEnd={() => {
                  setDragUid(null);
                  setOverUid(null);
                }}
                className="icon-btn cursor-grab"
                title="Перетащите"
              >
                <IconGrip size={14} />
              </span>
              <span className="w-5 text-right text-sm tabular-nums muted">{i + 1}</span>
              <StageChip stage={stage} className="h-9 flex-1 text-sm" />
              <span className="w-16 shrink-0 text-right text-xs muted">
                {stage.dealCount > 0 ? `${stage.dealCount} сд.` : ""}
                {i === list.length - 1 && <span className="block">финал</span>}
              </span>
              <button
                type="button"
                className="icon-btn"
                title="Изменить"
                aria-label={`Изменить этап ${stage.name}`}
                onClick={() => setEditing(editing === stage.uid ? null : stage.uid)}
              >
                <IconPencil size={14} />
              </button>
            </div>

            {editing === stage.uid && (
              <div className="ml-14 mr-10 mt-2 space-y-2 rounded-md border border-slate-200 p-3 dark:border-neutral-700">
                <input
                  className="input"
                  value={stage.name}
                  maxLength={60}
                  autoFocus
                  aria-label="Название этапа"
                  onChange={(e) => update(stage.uid, { name: e.target.value })}
                />
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Цвет">
                  {STAGE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={stage.color === c}
                      aria-label={c}
                      onClick={() => update(stage.uid, { color: c })}
                      className={`h-7 w-7 rounded-full border border-black/10 ${stage.color === c ? "ring-2 ring-accent ring-offset-2 dark:ring-offset-neutral-900" : ""}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => moveTo(stage.uid, i - 1)}>
                    <IconArrowUp size={12} /> Выше
                  </button>
                  <button type="button" className="btn btn-sm" disabled={i === list.length - 1} onClick={() => moveTo(stage.uid, i + 1)}>
                    <IconArrowDown size={12} /> Ниже
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm ml-auto text-red-600"
                    disabled={stage.dealCount > 0 || list.length <= 2}
                    title={stage.dealCount > 0 ? "На этапе есть сделки" : undefined}
                    onClick={() => {
                      setList((l) => l.filter((s) => s.uid !== stage.uid));
                      setEditing(null);
                    }}
                  >
                    <IconTrash size={12} /> Удалить этап
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn btn-ghost btn-sm mt-3"
        onClick={() => {
          const uid = `new-${Date.now()}`;
          // Новый этап — перед завершающим.
          setList((l) => [...l.slice(0, -1), { name: "Новый этап", color: "#94A3B8", dealCount: 0, uid }, ...l.slice(-1)]);
          setEditing(uid);
        }}
      >
        <IconPlus size={14} /> Добавить этап
      </button>
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
