/** Диалоги базы знаний: новое пространство, новая страница. */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { api } from "../../lib/api.ts";
import type { Space } from "../../lib/types.ts";
import { ErrorBox, Modal } from "../ui.tsx";

const TRANSLIT: Record<string, string> = {
  а: "A", б: "B", в: "V", г: "G", д: "D", е: "E", ё: "E", ж: "ZH", з: "Z", и: "I", й: "Y", к: "K", л: "L",
  м: "M", н: "N", о: "O", п: "P", р: "R", с: "S", т: "T", у: "U", ф: "F", х: "H", ц: "C", ч: "CH", ш: "SH",
  щ: "SH", ы: "Y", э: "E", ю: "YU", я: "YA",
};

/** Предлагаемый ключ пространства по названию: «Таможня» → TAMOZHNYA. */
export function suggestKey(name: string): string {
  const latin = [...name.toLowerCase()].map((c) => TRANSLIT[c] ?? c.toUpperCase()).join("");
  return latin.replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "").slice(0, 16);
}

export function CreateSpaceDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { space } = await api<{ space: Space }>("/kb/spaces", { method: "POST", body: { name, key, description } });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      onClose();
      navigate(`/kb/${space.key}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title="Новое пространство" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="space-name">Название</label>
          <input
            id="space-name"
            className="input"
            value={name}
            autoFocus
            required
            onChange={(e) => {
              setName(e.target.value);
              if (!keyTouched) setKey(suggestKey(e.target.value));
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="space-key">Ключ (латиница, для адреса)</label>
          <input
            id="space-key"
            className="input font-mono uppercase"
            value={key}
            required
            maxLength={16}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="space-desc">Описание</label>
          <textarea id="space-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}

export function CreatePageDialog({
  spaceId,
  spaceKey,
  parentId,
  parentTitle,
  onClose,
}: {
  spaceId: number;
  spaceKey: string;
  parentId: number | null;
  parentTitle?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { page } = await api<{ page: { id: number } }>("/kb/pages", {
        method: "POST",
        body: { spaceId, parentId, title },
      });
      await queryClient.invalidateQueries({ queryKey: ["space", spaceKey] });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      onClose();
      navigate(`/kb/${spaceKey}/${page.id}/edit`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={parentTitle ? `Новая страница в «${parentTitle}»` : "Новая страница"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="page-title">Заголовок</label>
          <input id="page-title" className="input" value={title} autoFocus required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Создать и редактировать</button>
        </div>
      </form>
    </Modal>
  );
}
