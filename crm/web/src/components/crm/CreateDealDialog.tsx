/** Новая сделка: название, клиент (существующий или новый), контакт, этап, исполнитель. */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { COMPANY_KINDS, MESSENGERS } from "../../../../shared/deal-fields.ts";
import { SCHEMES } from "../../../../shared/documents.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { ErrorBox, Modal } from "../ui.tsx";
import { CounterpartyPicker, type Picked } from "./CounterpartyPicker.tsx";
import { useDirectory, useStages } from "./common.tsx";

export function CreateDealDialog({ onClose, initialStage }: { onClose: () => void; initialStage?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stages = useStages().data?.stages ?? [];
  const users = useDirectory().data?.users.filter((u) => u.isActive) ?? [];

  const [title, setTitle] = useState("");
  const [product, setProduct] = useState("");
  const [client, setClient] = useState<Picked | null>(null);
  const [scheme, setScheme] = useState<keyof typeof SCHEMES>("commission");
  const [kind, setKind] = useState<keyof typeof COMPANY_KINDS>("ooo");
  const [inn, setInn] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [messenger, setMessenger] = useState("");
  const [statusKey, setStatusKey] = useState(initialStage ?? "");
  const [assigneeId, setAssigneeId] = useState(String(user?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { deal } = await api<{ deal: { key: string } }>("/deals", {
        method: "POST",
        body: {
          title,
          product,
          scheme,
          statusKey: statusKey || stages[0]?.key,
          assigneeId: assigneeId ? Number(assigneeId) : null,
          clientId: client?.id ?? null,
          newClient: client && client.id === null ? { name: client.name, kind, inn } : undefined,
          newContact: !client?.id && (contactName || phone) ? { name: contactName, phone, messenger: messenger || null } : undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["deals"] });
      await queryClient.invalidateQueries({ queryKey: ["stages"] });
      onClose();
      navigate(`/deals/${deal.key}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title="Новая сделка" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="d-title">Название</label>
            <input id="d-title" className="input" required autoFocus maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Ламинат, 2 фуры" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="d-product">Товар</label>
            <input id="d-product" className="input" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Клиент</label>
            <CounterpartyPicker role="client" value={client} onChange={setClient} />
          </div>
          {client && client.id === null && (
            <>
              <div>
                <label className="label" htmlFor="d-kind">Форма</label>
                <select id="d-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof COMPANY_KINDS)}>
                  {Object.entries(COMPANY_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="d-inn">ИНН</label>
                <input id="d-inn" className="input" inputMode="numeric" value={inn} onChange={(e) => setInn(e.target.value)} />
              </div>
            </>
          )}
          {!client?.id && (
            <>
              <div>
                <label className="label" htmlFor="d-cname">Контакт — имя</label>
                <input id="d-cname" className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="d-phone">Телефон</label>
                <input id="d-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="d-msg">Мессенджер</label>
                <select id="d-msg" className="input" value={messenger} onChange={(e) => setMessenger(e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(MESSENGERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor="d-scheme">Схема</label>
            <select id="d-scheme" className="input" value={scheme} onChange={(e) => setScheme(e.target.value as keyof typeof SCHEMES)}>
              {Object.entries(SCHEMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="d-stage">Этап</label>
            <select id="d-stage" className="input" value={statusKey || stages[0]?.key || ""} onChange={(e) => setStatusKey(e.target.value)}>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="d-assignee">Исполнитель</label>
            <select id="d-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Не назначен</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
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
