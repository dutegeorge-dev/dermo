/**
 * Загрузка и правка документа: слева файл, справа форма.
 * /documents/new?type=&counterparty=&client=&deal=BARS-12 — новый,
 * /documents/:id/edit — правка.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import {
  CONTRACTOR_TYPES,
  COST_CATEGORIES,
  COUNTERPARTY_ROLES,
  type CostLine,
  CURRENCIES,
  DOC_GROUPS,
  DOC_STATUSES,
  DOC_TYPES,
  type DocGroup,
  type DocType,
  docSpec,
  formatMoney,
  PAYMENT_STATUSES,
  SCHEMES,
} from "../../../../shared/documents.ts";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "../../components/crm/CounterpartyPicker.tsx";
import { DealPicker, type PickedDeal } from "../../components/crm/DealPicker.tsx";
import { docTitle } from "../../components/docs/common.tsx";
import { CostsEditor } from "../../components/docs/CostsEditor.tsx";
import { FileDrop, FilePreview } from "../../components/docs/FilePane.tsx";
import { emptyItem, itemAmount, ItemsEditor } from "../../components/docs/ItemsEditor.tsx";
import { detectCurrency, parseNumber } from "../../components/docs/paste.ts";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { api, fileUrl } from "../../lib/api.ts";
import type { Counterparty, DealResponse, DocItem, DocumentFull, DocumentRow } from "../../lib/types.ts";

type Initial = {
  existing: DocumentFull | null;
  type: DocType;
  party: Picked | null;
  client: Picked | null;
  deal: PickedDeal | null;
};

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function DocumentEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editId = id ? Number(id) : null;

  const existing = useQuery({
    queryKey: ["document", editId],
    queryFn: () => api<DocumentFull>(`/documents/${editId}`),
    enabled: !!editId,
  });
  const cpParam = Number(params.get("counterparty")) || null;
  const clientParam = Number(params.get("client")) || null;
  const dealParam = params.get("deal");
  const cp = useQuery({ queryKey: ["counterparty", cpParam], queryFn: () => api<{ counterparty: Counterparty }>(`/counterparties/${cpParam}`), enabled: !!cpParam && !editId });
  const cl = useQuery({ queryKey: ["counterparty", clientParam], queryFn: () => api<{ counterparty: Counterparty }>(`/counterparties/${clientParam}`), enabled: !!clientParam && !editId });
  const dl = useQuery({ queryKey: ["deal", dealParam], queryFn: () => api<DealResponse>(`/deals/${dealParam}`), enabled: !!dealParam && !editId });

  const loading = existing.isLoading || cp.isLoading || cl.isLoading || dl.isLoading;
  const error = existing.error ?? cp.error ?? cl.error ?? dl.error;

  const initial = useMemo<Initial | null>(() => {
    if (loading) return null;
    if (editId && existing.data) {
      const d = existing.data.document;
      return {
        existing: existing.data,
        type: d.type as DocType,
        party: d.counterpartyId ? { id: d.counterpartyId, name: d.counterpartyName ?? "" } : null,
        client: d.clientId ? { id: d.clientId, name: d.clientName ?? "" } : null,
        deal: d.dealId && d.dealKey ? { id: d.dealId, key: d.dealKey, title: "" } : null,
      };
    }
    let type = (params.get("type") as DocType) || null;
    const party = cp.data?.counterparty;
    if (!type && party) type = party.role === "supplier" ? "supplier_invoice" : party.role === "contractor" ? "contractor_invoice" : "commission_contract";
    if (!type && cl.data) type = "commission_contract";
    type ??= "supplier_invoice";
    const deal = dl.data?.deal;
    const spec = docSpec(type)!;
    // Клиент из карточки клиента — это сторона договора, если документ «с клиентом».
    const clientCp = cl.data?.counterparty;
    return {
      existing: null,
      type,
      party: party ? { id: party.id, name: party.name } : spec.party === "client" && clientCp ? { id: clientCp.id, name: clientCp.name } : spec.party === "client" && deal?.clientId ? { id: deal.clientId, name: deal.clientName ?? "" } : spec.party === "supplier" && deal?.supplierId ? { id: deal.supplierId, name: deal.supplierName ?? "" } : null,
      client: spec.party !== "client" && clientCp ? { id: clientCp.id, name: clientCp.name } : spec.party !== "client" && deal?.clientId ? { id: deal.clientId, name: deal.clientName ?? "" } : null,
      deal: deal ? { id: deal.id, key: deal.key, title: deal.title } : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, existing.data, cp.data, cl.data, dl.data]);

  if (loading || (!initial && !error)) return <div className="px-6 py-6"><Spinner /></div>;
  if (error || !initial) return <div className="px-6 py-6"><ErrorBox error={error} /></div>;
  return <EditorForm initial={initial} />;
}

function EditorForm({ initial }: { initial: Initial }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ex = initial.existing?.document;
  const [type, setType] = useState<DocType>(initial.type);
  const spec = docSpec(type)!;
  const [party, setParty] = useState<Picked | null>(initial.party);
  const [client, setClient] = useState<Picked | null>(initial.client);
  const [deal, setDeal] = useState<PickedDeal | null>(initial.deal);
  const [newDeal, setNewDeal] = useState(!ex && !initial.deal && type === "supplier_invoice");
  const [scheme, setScheme] = useState<keyof typeof SCHEMES>("commission");
  const [parentId, setParentId] = useState<number | null>(ex?.parentId ?? null);
  const [number, setNumber] = useState(ex?.number ?? "");
  const [date, setDate] = useState(ex?.date ?? new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState(ex?.currency ?? (type === "customs_declaration" ? "RUB" : spec.party === "supplier" ? "CNY" : "RUB"));
  const [amount, setAmount] = useState(ex?.amount != null ? String(ex.amount) : "");
  const [status, setStatus] = useState(ex?.status ?? "draft");
  const [paymentStatus, setPaymentStatus] = useState(ex?.paymentStatus ?? "unpaid");
  const [paidAmount, setPaidAmount] = useState(ex?.paidAmount != null ? String(ex.paidAmount) : "");
  const [paidAt, setPaidAt] = useState(ex?.paidAt ?? "");
  const [validUntil, setValidUntil] = useState(ex?.validUntil ?? "");
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const data0 = (ex?.data ?? {}) as Record<string, unknown>;
  const [incoterms, setIncoterms] = useState(String(data0.incoterms ?? ""));
  const [paymentTerms, setPaymentTerms] = useState(String(data0.paymentTerms ?? ""));
  const [costCategory, setCostCategory] = useState(String(data0.costCategory ?? ""));
  const [issuedTo, setIssuedTo] = useState(String(data0.issuedTo ?? ""));
  const [city, setCity] = useState(String(data0.city ?? ""));
  const [deliveryPoint, setDeliveryPoint] = useState(String(data0.deliveryPoint ?? ""));
  const [costs, setCosts] = useState<CostLine[]>((data0.costs as CostLine[]) ?? []);
  const [items, setItems] = useState<DocItem[]>(initial.existing?.items.length ? initial.existing.items : [emptyItem()]);
  const [file, setFile] = useState<File | null>(null);
  const [fileLabel, setFileLabel] = useState<"original" | "signed">("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Договоры, к которым можно привязать документ.
  const parentOwner = spec.party === "client" ? party?.id : party?.id;
  const parents = useQuery({
    queryKey: ["documents", "parents", type, parentOwner],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?type=${spec.parentTypes!.join(",")}&counterparty=${parentOwner}`),
    enabled: !!spec.parentTypes && !!parentOwner,
  });
  const parentOptions = (parents.data?.documents ?? []).filter((d) => d.status !== "cancelled" || d.id === parentId);
  useEffect(() => {
    if (!ex && parentId === null && parentOptions.length >= 1 && type !== "supplementary") setParentId(parentOptions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parents.data]);
  const nextSeq = useQuery({
    queryKey: ["documents", "next-seq", parentId, type],
    queryFn: () => api<{ number: string }>(`/documents/next-seq?parent=${parentId}&type=${type}`),
    enabled: !!spec.numberedInParent && !!parentId && !ex,
  });

  const itemsTotal = items.reduce((s, i) => s + (itemAmount(i) ?? 0), 0);
  const usedItems = spec.items ? items.filter((i) => i.name.trim()) : [];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const counterpartyId = spec.party ? await ensureCounterparty(party, spec.party) : null;
      const clientId = await ensureCounterparty(client, "client");
      const data: Record<string, unknown> = { ...data0 };
      if (type === "supplier_invoice") Object.assign(data, { incoterms, paymentTerms });
      if (type === "contractor_invoice") data.costCategory = costCategory || undefined;
      if (type === "power_of_attorney") data.issuedTo = issuedTo;
      if (type === "commission_order") Object.assign(data, { city, incoterms, paymentTerms, deliveryPoint, costs });
      const body: Record<string, unknown> = {
        type,
        number: number || null,
        date: date || null,
        counterpartyId,
        clientId: spec.party === "client" ? null : clientId,
        parentId: spec.parentTypes ? parentId : null,
        currency: spec.payable || spec.items || type === "supplier_contract" ? currency : null,
        notes,
        data,
      };
      if (!spec.contract) body.dealId = newDeal ? null : (deal?.id ?? null);
      if (spec.items) body.items = usedItems;
      if (spec.payable) {
        body.amount = spec.items && usedItems.length ? null : amount.trim() ? parseNumber(amount) : null;
        body.paymentStatus = paymentStatus;
        body.paidAmount = paymentStatus === "partial" ? parseNumber(paidAmount) : null;
        body.paidAt = paymentStatus === "unpaid" ? null : paidAt || null;
        if (spec.items && usedItems.length) delete body.amount;
      }
      if (spec.validity) body.validUntil = validUntil || null;
      if (spec.signable) body.status = status;
      if (!ex && newDeal && !spec.contract) body.newDeal = { clientId, scheme };

      let docId = ex?.id;
      let dealKey: string | null = null;
      if (ex) {
        await api(`/documents/${ex.id}`, { method: "PATCH", body });
      } else {
        const res = await api<{ document: { id: number }; deal: { key: string } | null }>("/documents", { method: "POST", body });
        docId = res.document.id;
        dealKey = res.deal?.key ?? null;
      }
      if (file && docId) {
        const form = new FormData();
        form.append("file", file);
        await api(`/documents/${docId}/files?label=${fileLabel}`, { method: "POST", form });
      }
      await queryClient.invalidateQueries();
      navigate(dealKey ? `/deals/${dealKey}` : `/documents/${docId}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const existingFile = initial.existing?.files.find((f) => f.label !== "signed") ?? initial.existing?.files[0];
  const groups = Object.entries(DOC_GROUPS) as [DocGroup, string][];

  return (
    <form onSubmit={save} className="px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="page-title mr-auto">{ex ? docTitle(ex) : "Новый документ"}</h1>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Отмена</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0 lg:sticky lg:top-[60px] lg:self-start">
          {ex && !file && existingFile ? (
            <div className="space-y-2">
              <FilePreview url={fileUrl(existingFile.id)} mime={existingFile.mime} name={existingFile.filename} />
              <FileDrop file={null} onFile={setFile} />
            </div>
          ) : (
            <FileDrop file={file} onFile={setFile} />
          )}
          {file && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fileLabel === "signed"} onChange={(e) => setFileLabel(e.target.checked ? "signed" : "original")} />
              Это подписанный экземпляр (скан с подписями)
            </label>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Тип документа" wide>
              <select className="input" value={type} disabled={!!ex} onChange={(e) => setType(e.target.value as DocType)}>
                {groups.map(([g, label]) => (
                  <optgroup key={g} label={label}>
                    {Object.entries(DOC_TYPES)
                      .filter(([, s]) => s.group === g)
                      .map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </optgroup>
                ))}
              </select>
              {"hint" in spec && spec.hint && <span className="mt-1 block text-xs muted">{spec.hint}</span>}
            </Field>

            {spec.party && (
              <Field label={COUNTERPARTY_ROLES[spec.party].one} wide>
                <CounterpartyPicker role={spec.party} value={party} onChange={setParty} />
                {party && party.id === null && (
                  <span className="mt-1 block text-xs muted">
                    Будет создан новый {COUNTERPARTY_ROLES[spec.party].one.toLowerCase()} — реквизиты заполните потом в его карточке.
                    {spec.party === "contractor" && ` Вид по умолчанию: ${CONTRACTOR_TYPES.carrier_cn}.`}
                  </span>
                )}
              </Field>
            )}

            <Field label={spec.numberedInParent ? "Номер (приложения)" : "Номер"}>
              <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} placeholder={nextSeq.data ? `будет ${nextSeq.data.number}` : ""} />
            </Field>
            <Field label="Дата">
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>

            {spec.parentTypes && (
              <Field label="К договору" wide>
                <select className="input" value={parentId ?? ""} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{parentOwner ? (parentOptions.length ? "— без договора —" : "Договоров нет — загрузите его отдельно") : "Сначала выберите сторону"}</option>
                  {parentOptions.map((d) => <option key={d.id} value={d.id}>{docTitle(d)}{d.clientName ? ` (клиент ${d.clientName})` : ""}</option>)}
                </select>
              </Field>
            )}

            {spec.party !== "client" && (
              <Field label={type === "supplier_contract" ? "Клиент — если это контракт клиента (ТЭУ)" : type === "conformity" ? "Заявитель / держатель" : "Клиент"} wide>
                <CounterpartyPicker role="client" value={client} onChange={setClient} placeholder="Необязательно" />
              </Field>
            )}

            {!spec.contract && (
              <div className="sm:col-span-2">
                <span className="label">Сделка</span>
                {!ex && (spec.party === "supplier" || type === "supplier_invoice") && (
                  <div className="mb-2 flex gap-4 text-sm">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={newDeal} onChange={() => setNewDeal(true)} /> Новая сделка</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={!newDeal} onChange={() => setNewDeal(false)} /> В существующую</label>
                  </div>
                )}
                {newDeal && !ex ? (
                  <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-[1fr_140px] dark:bg-neutral-800/40">
                    <p className="sm:col-span-2">
                      Будет создана сделка: клиент — {client?.name ? <b>{client.name}</b> : <span className="muted">укажите выше</span>}, поставщик — {party?.name ? <b>{party.name}</b> : "—"}. Договор комиссии клиента и контракт поставщика подставятся сами.
                    </p>
                    <label className="sm:col-start-2">
                      <span className="label">Схема</span>
                      <select className="input" value={scheme} onChange={(e) => setScheme(e.target.value as keyof typeof SCHEMES)}>
                        {Object.entries(SCHEMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                  </div>
                ) : (
                  <DealPicker value={deal} onChange={setDeal} />
                )}
              </div>
            )}
          </div>

          {type === "supplier_invoice" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Условия поставки (Incoterms)"><input className="input" value={incoterms} onChange={(e) => setIncoterms(e.target.value)} placeholder="EXW (Shijiazhuang, Китай)" /></Field>
              <Field label="Условия оплаты"><input className="input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="30% депозит 70% до отгрузки" /></Field>
            </div>
          )}

          {spec.items && type !== "commission_order" && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Позиции</h2>
              <ItemsEditor
                items={items}
                onChange={setItems}
                currency={currency}
                onPasteInfo={(text) => {
                  const c = detectCurrency(text);
                  if (c) setCurrency(c);
                  setNotice("Позиции вставлены — проверьте, что колонки распознаны верно.");
                }}
              />
              {notice && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{notice}</p>}
            </section>
          )}

          {type === "commission_order" && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide muted">Товары</h2>
              <ItemsEditor items={items} onChange={setItems} currency={currency} showBatch />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Город"><input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
                <Field label="Условия поставки"><input className="input" value={incoterms} onChange={(e) => setIncoterms(e.target.value)} /></Field>
                <Field label="Условия оплаты"><input className="input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></Field>
                <Field label="Пункт доставки"><input className="input" value={deliveryPoint} onChange={(e) => setDeliveryPoint(e.target.value)} /></Field>
              </div>
              <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide muted">Порядок возмещаемых платежей</h2>
              <CostsEditor costs={costs} onChange={setCosts} />
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {(spec.payable || spec.items || type === "supplier_contract") && (
              <Field label="Валюта">
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            )}
            {spec.payable && (
              <Field label={type === "customs_declaration" ? "Таможенные платежи, всего" : "Сумма"}>
                {spec.items && usedItems.length ? (
                  <div className="input bg-slate-50 tabular-nums dark:bg-neutral-800">{formatMoney(itemsTotal, currency)} — по позициям</div>
                ) : (
                  <input className="input tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                )}
              </Field>
            )}
            {type === "contractor_invoice" && (
              <Field label="Статья расходов (для план/факт)">
                <select className="input" value={costCategory} onChange={(e) => setCostCategory(e.target.value)}>
                  <option value="">По виду подрядчика</option>
                  {Object.entries(COST_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            )}
            {spec.payable && (
              <>
                <Field label="Оплата">
                  <select className="input" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>
                    {Object.entries(PAYMENT_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                {paymentStatus === "partial" && (
                  <Field label="Оплачено"><input className="input tabular-nums" inputMode="decimal" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /></Field>
                )}
                {paymentStatus !== "unpaid" && (
                  <Field label="Дата оплаты"><input type="date" className="input" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
                )}
              </>
            )}
            {spec.signable && (
              <Field label="Статус">
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {Object.entries(DOC_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            )}
            {spec.validity && (
              <Field label="Действует до"><input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
            )}
            {type === "power_of_attorney" && (
              <Field label="Кому выдана" wide><input className="input" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} /></Field>
            )}
            <Field label="Заметки" wide>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => navigate(-1)}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
          </div>
        </div>
      </div>
    </form>
  );
}
