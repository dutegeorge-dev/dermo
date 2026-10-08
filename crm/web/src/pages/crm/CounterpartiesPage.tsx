/** Клиенты / Поставщики / Подрядчики: список и карточка. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";

import { COMPANY_KINDS, MESSENGERS } from "../../../../shared/deal-fields.ts";
import { CONTRACTOR_TYPES, COUNTERPARTY_ROLES, DOC_TYPES, type DocType, docSpec, formatMoney } from "../../../../shared/documents.ts";
import { formatShortDate, StageChip, useStages } from "../../components/crm/common.tsx";
import { CounterpartyForm } from "../../components/crm/CounterpartyForm.tsx";
import { counterpartyPath, docTypeLabel, DocumentsTable, formatDay } from "../../components/docs/common.tsx";
import { IconPlus, IconSearch, IconTrash } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { plural } from "../../lib/format.ts";
import type { Contact, Counterparty, CounterpartyRole, CounterpartyRow, Deal, DocumentRow } from "../../lib/types.ts";

/** Какие документы предлагать добавить в карточке контрагента. */
const QUICK_DOCS: Record<CounterpartyRole, DocType[]> = {
  client: ["commission_contract", "supply_contract", "teu_contract", "client_invoice", "power_of_attorney"],
  supplier: ["supplier_contract", "supplier_invoice", "packing_list", "conformity"],
  contractor: ["contractor_contract", "contractor_invoice", "railway_bill", "cmr"],
};

export function CounterpartiesPage({ role }: { role: CounterpartyRole }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const type = params.get("type") ?? "";
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["counterparties", role, q.trim(), type],
    queryFn: () =>
      api<{ counterparties: CounterpartyRow[] }>(`/counterparties?role=${role}&q=${encodeURIComponent(q.trim())}${type ? `&type=${type}` : ""}`),
    placeholderData: (prev) => prev,
  });
  const meta = COUNTERPARTY_ROLES[role];
  const rows = data?.counterparties ?? [];

  const copyEmails = () => {
    const emails = [...new Set(rows.map((r) => r.contactEmail ?? r.email).filter(Boolean))];
    void navigator.clipboard?.writeText(emails.join(", "));
    alert(emails.length ? `Скопировано адресов: ${emails.length}` : "E-mail у контактов не указан");
  };

  return (
    <Content wide>
      <PageHeader
        title={meta.many}
        actions={
          <>
            {role === "client" && rows.length > 0 && (
              <button type="button" className="btn" onClick={copyEmails} title="Скопировать e-mail всех клиентов из списка — для рассылки">
                E-mail для рассылки
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <IconPlus size={14} /> {meta.one}
            </button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="relative block w-full max-w-sm">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" className="input pl-8" placeholder="Название, ИНН, контакт, телефон" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {role === "contractor" && (
          <select className="input w-auto" value={type} onChange={(e) => setParams(e.target.value ? { type: e.target.value } : {})} aria-label="Вид">
            <option value="">Все виды</option>
            {Object.entries(CONTRACTOR_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && rows.length === 0 && <EmptyState title={q ? "Ничего не найдено" : `${meta.many} пока не добавлены`} />}
      {rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <th className="px-4 py-2 font-medium">Название</th>
                {role === "contractor" && <th className="px-4 py-2 font-medium">Вид</th>}
                <th className="px-4 py-2 font-medium">{role === "supplier" ? "Страна" : "ИНН"}</th>
                <th className="px-4 py-2 font-medium">Контакт</th>
                <th className="px-4 py-2 text-right font-medium">Сделки</th>
                <th className="px-4 py-2 text-right font-medium">Документы</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/50" onClick={() => navigate(`/${meta.path}/${c.id}`)}>
                  <td className="px-4 py-2 font-medium"><Link to={`/${meta.path}/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.name}</Link></td>
                  {role === "contractor" && <td className="px-4 py-2">{CONTRACTOR_TYPES[c.contractorType as keyof typeof CONTRACTOR_TYPES] ?? "—"}</td>}
                  <td className="px-4 py-2">{role === "supplier" ? c.country : (c.inn ?? <span className="muted">—</span>)}</td>
                  <td className="px-4 py-2 text-xs">{[c.contactName, c.contactPhone].filter(Boolean).join(" · ") || <span className="muted">—</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.dealCount || <span className="muted">0</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.documentCount || <span className="muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CounterpartyForm
          role={role}
          initialName={q.trim()}
          onClose={(id) => {
            setCreating(false);
            if (id) navigate(`/${meta.path}/${id}`);
          }}
        />
      )}
    </Content>
  );
}

function ContactDialog({ counterpartyId, contact, onClose }: { counterpartyId: number; contact?: Contact; onClose: () => void }) {
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
            else await api(`/counterparties/${counterpartyId}/contacts`, { method: "POST", body: form });
            await queryClient.invalidateQueries({ queryKey: ["counterparty", counterpartyId] });
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
          <div><label className="label" htmlFor="ct-mh">Ник / номер</label><input id="ct-mh" className="input" value={form.messengerHandle} onChange={set("messengerHandle")} /></div>
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

type CardData = {
  counterparty: Counterparty;
  contacts: Contact[];
  deals: Deal[];
  documents: DocumentRow[];
  products: {
    productId: number | null;
    productName: string;
    documentId: number;
    documentType: string;
    documentNumber: string | null;
    date: string | null;
    currency: string | null;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    counterpartyName: string | null;
  }[];
  related: { id: number; name: string; role: CounterpartyRole; contractorType: string | null; deals: number }[];
};

const TABS = [
  ["documents", "Документы"],
  ["deals", "Сделки"],
  ["products", "Товары и цены"],
  ["related", "Связи"],
  ["info", "Реквизиты и контакты"],
] as const;

function Requisite({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[150px_1fr] gap-2 py-1 text-sm">
      <span className="muted">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

export function CounterpartyPage({ role }: { role: CounterpartyRole }) {
  const { id } = useParams();
  const cpId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stages = useStages().data?.stages ?? [];
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "documents") as (typeof TABS)[number][0];
  const { data, isLoading, error } = useQuery({
    queryKey: ["counterparty", cpId],
    queryFn: () => api<CardData>(`/counterparties/${cpId}`),
  });
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Contact | "new" | null>(null);
  const [removingContact, setRemovingContact] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) return <Content><Spinner /></Content>;
  if (!data) return <Content><ErrorBox error={error} /></Content>;
  const { counterparty: c } = data;
  const meta = COUNTERPARTY_ROLES[c.role];
  if (c.role !== role) return <Navigate to={`/${meta.path}/${c.id}`} replace />;
  const stageBy = new Map(stages.map((s) => [s.key, s]));
  const contracts = data.documents.filter((d) => docSpec(d.type)?.contract && d.status !== "cancelled");
  const clientParam = c.role === "client" ? `client=${c.id}` : `counterparty=${c.id}`;

  return (
    <Content wide>
      <div className="mb-1 text-xs muted"><Link to={`/${meta.path}`} className="hover:underline">{meta.many}</Link></div>
      <PageHeader
        title={c.name}
        meta={[
          c.role === "contractor" ? CONTRACTOR_TYPES[c.contractorType as keyof typeof CONTRACTOR_TYPES] : null,
          COMPANY_KINDS[c.kind],
          c.inn && `ИНН ${c.inn}`,
          c.regNumber,
          c.role === "supplier" ? c.country : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Link to={`/documents/new?${clientParam}`} className="btn btn-primary">
              <IconPlus size={14} /> Документ
            </Link>
            <button type="button" className="btn" onClick={() => setEditing(true)}>Изменить</button>
            {user?.role === "admin" && data.deals.length === 0 && data.documents.length === 0 && (
              <button type="button" className="btn" aria-label="Удалить" onClick={() => setDeleting(true)}><IconTrash size={14} /></button>
            )}
          </>
        }
      />

      {contracts.length > 0 && (
        <p className="-mt-3 mb-4 text-sm">
          {contracts.map((d, i) => (
            <span key={d.id}>
              {i > 0 && " · "}
              <Link to={`/documents/${d.id}`} className="link">{docTypeLabel(d.type)} № {d.number ?? "—"}</Link>
              {d.date && <span className="muted"> от {formatDay(d.date)}</span>}
            </span>
          ))}
        </p>
      )}

      <div className="mb-4 flex gap-4 overflow-x-auto border-b border-slate-200 text-sm dark:border-neutral-800">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setParams({ tab: key }, { replace: true })}
            className={`-mb-px shrink-0 border-b-2 pb-2 ${tab === key ? "border-accent font-medium text-accent dark:text-accent-bright" : "border-transparent muted"}`}
          >
            {label}
            {key === "documents" && data.documents.length > 0 && <span className="ml-1 muted">{data.documents.length}</span>}
            {key === "deals" && data.deals.length > 0 && <span className="ml-1 muted">{data.deals.length}</span>}
          </button>
        ))}
      </div>

      {tab === "documents" && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {QUICK_DOCS[c.role].map((t) => (
              <Link key={t} to={`/documents/new?type=${t}&${clientParam}`} className="btn btn-sm">
                + {DOC_TYPES[t].label}
              </Link>
            ))}
          </div>
          <DocumentsTable rows={data.documents} hide={c.role === "client" ? ["client"] : []} />
        </>
      )}

      {tab === "deals" &&
        (data.deals.length === 0 ? (
          <p className="text-sm muted">Сделок нет.</p>
        ) : (
          <ul className="panel divide-line">
            {data.deals.map((d) => {
              const stage = stageBy.get(d.statusKey);
              return (
                <li key={d.key} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Link to={`/deals/${d.key}`} className="font-mono text-xs link">{d.key}</Link>
                  <Link to={`/deals/${d.key}`} className="min-w-0 flex-1 truncate hover:underline">{d.title}</Link>
                  <span className="hidden text-xs muted sm:inline">
                    {c.role === "client" ? d.supplierName : d.clientName}
                  </span>
                  {d.outcome === "lost" ? <span className="text-xs text-red-600">отказ</span> : stage && <StageChip stage={stage} className="max-w-44" />}
                  <span className="w-16 text-right text-xs muted">{formatShortDate(d.createdAt.slice(0, 10))}</span>
                </li>
              );
            })}
          </ul>
        ))}

      {tab === "products" &&
        (data.products.length === 0 ? (
          <p className="text-sm muted">Товары появятся из инвойсов и поручений.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                  <th className="px-3 py-2 font-medium">Товар</th>
                  <th className="px-3 py-2 text-right font-medium">Цена</th>
                  <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                  <th className="px-3 py-2 font-medium">Документ</th>
                  {c.role === "client" && <th className="px-3 py-2 font-medium">Поставщик</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                {data.products.map((p, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      {p.productId ? <Link to={`/products/${p.productId}`} className="hover:underline">{p.productName}</Link> : p.productName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {p.price !== null ? formatMoney(p.price, p.currency) : "—"}
                      {p.unit && <span className="muted"> / {p.unit}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{p.quantity ?? ""}</td>
                    <td className="px-3 py-2 text-xs">
                      <Link to={`/documents/${p.documentId}`} className="link">{docTypeLabel(p.documentType)} № {p.documentNumber ?? "—"}</Link>
                      <span className="muted"> {formatDay(p.date)}</span>
                    </td>
                    {c.role === "client" && <td className="px-3 py-2 text-xs">{p.documentType === "supplier_invoice" ? p.counterpartyName : ""}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "related" &&
        (data.related.length === 0 ? (
          <p className="text-sm muted">Связи появятся, когда будут общие сделки.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {(["client", "supplier", "contractor"] as const).map((r) => {
              const list = data.related.filter((x) => x.role === r);
              if (list.length === 0) return null;
              return (
                <section key={r}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{COUNTERPARTY_ROLES[r].many}</h3>
                  <ul className="space-y-1 text-sm">
                    {list.map((x) => (
                      <li key={x.id} className="flex justify-between gap-2">
                        <Link to={counterpartyPath(x.role, x.id)} className="link">{x.name}</Link>
                        <span className="text-xs muted">{x.deals} {plural(x.deals, "сделка", "сделки", "сделок")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ))}

      {tab === "info" && (
        <div className="grid gap-8 md:grid-cols-[1fr_300px]">
          <section>
            <Requisite label="Полное наименование" value={c.fullName} />
            <Requisite label="ИНН / КПП" value={[c.inn, c.kpp].filter(Boolean).join(" / ")} />
            <Requisite label="ОГРН" value={c.ogrn} />
            <Requisite label="Рег. номер" value={c.regNumber} />
            <Requisite label="Страна" value={c.country} />
            <Requisite label="Юр. адрес" value={c.legalAddress} />
            <Requisite label="Почтовый адрес" value={c.postalAddress} />
            <Requisite label="Расчётный счёт" value={c.bankAccount} />
            <Requisite label="Банк" value={[c.bankName, c.bankBik && `БИК ${c.bankBik}`, c.bankSwift && `SWIFT ${c.bankSwift}`].filter(Boolean).join(", ")} />
            <Requisite label="Корр. счёт" value={c.bankCorrAccount} />
            <Requisite label="Адрес банка" value={c.bankAddress} />
            <Requisite label="Подписант" value={[c.signatoryTitle, c.signatoryName, c.signatoryBasis && `на основании ${c.signatoryBasis}`].filter(Boolean).join(", ")} />
            <Requisite label="E-mail" value={c.email} />
            <Requisite label="Телефон" value={c.phone} />
            <Requisite label="Сайт" value={c.website} />
            {c.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{c.notes}</p>}
            {!c.inn && !c.bankAccount && !c.legalAddress && (
              <p className="mt-2 text-sm muted">Реквизиты не заполнены — они нужны для поручений и договоров. <button type="button" className="link" onClick={() => setEditing(true)}>Заполнить</button></p>
            )}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide muted">Контакты</h3>
              <button type="button" className="icon-btn" title="Добавить контакт" onClick={() => setContact("new")}><IconPlus size={14} /></button>
            </div>
            {data.contacts.length === 0 && <p className="text-sm muted">Контактов нет.</p>}
            <ul className="space-y-3">
              {data.contacts.map((ct) => (
                <li key={ct.id} className="group text-sm">
                  <div className="flex items-center gap-2">
                    <button type="button" className="font-medium hover:underline" onClick={() => setContact(ct)}>{ct.name}</button>
                    {ct.position && <span className="text-xs muted">{ct.position}</span>}
                    <button type="button" className="ml-auto text-xs text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100" onClick={() => setRemovingContact(ct)}>удалить</button>
                  </div>
                  {ct.phone && <a href={`tel:${ct.phone.replace(/[^\d+]/g, "")}`} className="link block">{ct.phone}</a>}
                  {ct.messenger && <div className="text-xs muted">{MESSENGERS[ct.messenger as keyof typeof MESSENGERS]}{ct.messengerHandle ? `: ${ct.messengerHandle}` : ""}</div>}
                  {ct.email && <a href={`mailto:${ct.email}`} className="link block text-xs">{ct.email}</a>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {editing && <CounterpartyForm role={c.role} counterparty={c} onClose={() => setEditing(false)} />}
      {contact && <ContactDialog counterpartyId={cpId} contact={contact === "new" ? undefined : contact} onClose={() => setContact(null)} />}
      {removingContact && (
        <ConfirmDialog
          title="Удалить контакт?"
          message={`Контакт «${removingContact.name}» будет удалён.`}
          onConfirm={async () => {
            await api(`/contacts/${removingContact.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["counterparty", cpId] });
          }}
          onClose={() => setRemovingContact(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Удалить контрагента?"
          message={`«${c.name}» и его контакты будут удалены.`}
          onConfirm={async () => {
            await api(`/counterparties/${cpId}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["counterparties"] });
            navigate(`/${meta.path}`);
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Content>
  );
}
