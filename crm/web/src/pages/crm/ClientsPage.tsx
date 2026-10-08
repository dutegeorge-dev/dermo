/** Клиенты: список с поиском и карточка компании с контактами и историей сделок. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { COMPANY_KINDS, MESSENGERS } from "../../../../shared/deal-fields.ts";
import { formatShortDate, StageChip, useStages } from "../../components/crm/common.tsx";
import { IconPlus, IconSearch, IconTrash } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { plural } from "../../lib/format.ts";
import type { Client, ClientRow, Contact, Deal } from "../../lib/types.ts";

function ClientDialog({ client, onClose }: { client?: Client; onClose: (id?: number) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(client?.name ?? "");
  const [kind, setKind] = useState<Client["kind"]>(client?.kind ?? "ooo");
  const [inn, setInn] = useState(client?.inn ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<unknown>(null);

  return (
    <Modal title={client ? "Клиент" : "Новый клиент"} onClose={() => onClose()}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            if (client) {
              await api(`/clients/${client.id}`, { method: "PATCH", body: { name, kind, inn, notes } });
              await queryClient.invalidateQueries({ queryKey: ["client", client.id] });
              onClose(client.id);
            } else {
              const res = await api<{ client: Client }>("/clients", {
                method: "POST",
                body: { name, kind, inn, notes, contact: contactName ? { name: contactName, phone } : undefined },
              });
              onClose(res.client.id);
            }
            await queryClient.invalidateQueries({ queryKey: ["clients"] });
          } catch (err) {
            setError(err);
          }
        }}
      >
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <div>
            <label className="label" htmlFor="c-kind">Форма</label>
            <select id="c-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Client["kind"])}>
              {Object.entries(COMPANY_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="c-name">Название</label>
            <input id="c-name" className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="c-inn">ИНН</label>
          <input id="c-inn" className="input" inputMode="numeric" value={inn} onChange={(e) => setInn(e.target.value)} />
        </div>
        {!client && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-cn">Контакт — имя</label>
              <input id="c-cn" className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="c-ph">Телефон</label>
              <input id="c-ph" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        )}
        <div>
          <label className="label" htmlFor="c-notes">Заметки</label>
          <textarea id="c-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => onClose()}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

export function ClientsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["clients", q.trim()],
    queryFn: () => api<{ clients: ClientRow[] }>(`/clients?q=${encodeURIComponent(q.trim())}`),
    placeholderData: (prev) => prev,
  });

  return (
    <Content>
      <PageHeader
        title="Клиенты"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> Клиент
          </button>
        }
      />
      <label className="relative mb-4 block max-w-sm">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="search" className="input pl-8" placeholder="Название, ИНН, контакт, телефон" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.clients.length === 0 && <EmptyState title={q ? "Ничего не найдено" : "Клиентов пока нет"} />}
      {data && data.clients.length > 0 && (
        <ul className="panel divide-line">
          {data.clients.map((c) => (
            <li key={c.id}>
              <Link to={`/clients/${c.id}`} className="flex items-baseline gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-neutral-800/50">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs muted">{[c.inn && `ИНН ${c.inn}`, c.contactName, c.contactPhone].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-xs muted">
                  {c.dealCount} {plural(c.dealCount, "сделка", "сделки", "сделок")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <ClientDialog
          onClose={(id) => {
            setCreating(false);
            if (id) navigate(`/clients/${id}`);
          }}
        />
      )}
    </Content>
  );
}

function ContactDialog({ clientId, contact, onClose }: { clientId: number; contact?: Contact; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    phone: contact?.phone ?? "",
    messenger: contact?.messenger ?? "",
    messengerHandle: contact?.messengerHandle ?? "",
    email: contact?.email ?? "",
    position: contact?.position ?? "",
  });
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title={contact ? "Контакт" : "Новый контакт"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (contact) await api(`/contacts/${contact.id}`, { method: "PATCH", body: form });
            else await api(`/clients/${clientId}/contacts`, { method: "POST", body: form });
            await queryClient.invalidateQueries({ queryKey: ["client", clientId] });
            onClose();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="ct-name">Имя</label><input id="ct-name" className="input" required autoFocus value={form.name} onChange={set("name")} /></div>
          <div><label className="label" htmlFor="ct-pos">Должность</label><input id="ct-pos" className="input" value={form.position} onChange={set("position")} /></div>
          <div><label className="label" htmlFor="ct-phone">Телефон</label><input id="ct-phone" className="input" type="tel" value={form.phone} onChange={set("phone")} /></div>
          <div><label className="label" htmlFor="ct-email">E-mail</label><input id="ct-email" className="input" type="email" value={form.email} onChange={set("email")} /></div>
          <div>
            <label className="label" htmlFor="ct-m">Мессенджер</label>
            <select id="ct-m" className="input" value={form.messenger} onChange={set("messenger")}>
              <option value="">—</option>
              {Object.entries(MESSENGERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="ct-mh">Ник / номер в мессенджере</label><input id="ct-mh" className="input" value={form.messengerHandle} onChange={set("messengerHandle")} /></div>
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

export function ClientPage() {
  const { id } = useParams();
  const clientId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stages = useStages().data?.stages ?? [];
  const { data, isLoading, error } = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api<{ client: Client; contacts: Contact[]; deals: Deal[] }>(`/clients/${clientId}`),
  });
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Contact | "new" | null>(null);
  const [removingContact, setRemovingContact] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) return <Content><Spinner /></Content>;
  if (!data) return <Content><ErrorBox error={error} /></Content>;
  const { client } = data;
  const stageBy = new Map(stages.map((s) => [s.key, s]));

  return (
    <Content>
      <div className="mb-1 text-xs muted"><Link to="/clients" className="hover:underline">Клиенты</Link></div>
      <PageHeader
        title={client.name}
        meta={[COMPANY_KINDS[client.kind], client.inn && `ИНН ${client.inn}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setEditing(true)}>Изменить</button>
            {user?.role === "admin" && data.deals.length === 0 && (
              <button type="button" className="btn" aria-label="Удалить клиента" onClick={() => setDeleting(true)}><IconTrash size={14} /></button>
            )}
          </>
        }
      />
      {client.notes && <p className="mb-6 whitespace-pre-wrap text-sm">{client.notes}</p>}

      <div className="grid gap-8 md:grid-cols-[1fr_280px]">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Сделки</h2>
          {data.deals.length === 0 ? (
            <p className="text-sm muted">Сделок нет.</p>
          ) : (
            <ul className="divide-line border-y border-slate-200 dark:border-neutral-800">
              {data.deals.map((d) => {
                const stage = stageBy.get(d.statusKey);
                return (
                  <li key={d.key} className="flex items-center gap-3 py-2 text-sm">
                    <Link to={`/deals/${d.key}`} className="font-mono text-xs link">{d.key}</Link>
                    <Link to={`/deals/${d.key}`} className="min-w-0 flex-1 truncate hover:underline">{d.title}</Link>
                    {d.outcome === "lost" ? (
                      <span className="text-xs text-red-600">отказ</span>
                    ) : (
                      stage && <StageChip stage={stage} className="max-w-44" />
                    )}
                    <span className="w-16 text-right text-xs muted">{formatShortDate(d.createdAt.slice(0, 10))}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide muted">Контакты</h2>
            <button type="button" className="icon-btn" title="Добавить контакт" onClick={() => setContact("new")}><IconPlus size={14} /></button>
          </div>
          {data.contacts.length === 0 && <p className="text-sm muted">Контактов нет.</p>}
          <ul className="space-y-3">
            {data.contacts.map((c) => (
              <li key={c.id} className="group text-sm">
                <div className="flex items-center gap-2">
                  <button type="button" className="font-medium hover:underline" onClick={() => setContact(c)}>{c.name}</button>
                  {c.position && <span className="text-xs muted">{c.position}</span>}
                  <button type="button" className="ml-auto text-xs text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onClick={() => setRemovingContact(c)}>удалить</button>
                </div>
                {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="link block">{c.phone}</a>}
                {c.messenger && <div className="text-xs muted">{MESSENGERS[c.messenger as keyof typeof MESSENGERS]}{c.messengerHandle ? `: ${c.messengerHandle}` : ""}</div>}
                {c.email && <a href={`mailto:${c.email}`} className="link block text-xs">{c.email}</a>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} />}
      {contact && <ContactDialog clientId={clientId} contact={contact === "new" ? undefined : contact} onClose={() => setContact(null)} />}
      {removingContact && (
        <ConfirmDialog
          title="Удалить контакт?"
          message={`Контакт «${removingContact.name}» будет удалён. В сделках, где он указан, поле «Контакт» станет пустым.`}
          onConfirm={async () => {
            await api(`/contacts/${removingContact.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["client", clientId] });
          }}
          onClose={() => setRemovingContact(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Удалить клиента?"
          message={`Клиент «${client.name}» и его контакты будут удалены.`}
          onConfirm={async () => {
            await api(`/clients/${clientId}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["clients"] });
            navigate("/clients");
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Content>
  );
}
