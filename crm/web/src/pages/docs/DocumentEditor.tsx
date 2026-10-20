/**
 * Загрузка и правка документа: слева файл, справа форма.
 * /documents/new?type=&counterparty=&client=&shipment=12 — новый,
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
import type { DocumentDraft } from "../../../../shared/ai.ts";
import { emptyPackingLine, type PackingData, type PackingLine, packingTotals } from "../../../../shared/cargo.ts";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "../../components/crm/CounterpartyPicker.tsx";
import { type PickedShipment, ShipmentPicker } from "../../components/shipments/ShipmentPicker.tsx";
import { docTitle } from "../../components/docs/common.tsx";
import { CostsEditor } from "../../components/docs/CostsEditor.tsx";
import { FileDrop, FilePreview } from "../../components/docs/FilePane.tsx";
import { PackingEditor } from "../../components/docs/PackingEditor.tsx";
import { emptyItem, itemAmount, ItemsEditor } from "../../components/docs/ItemsEditor.tsx";
import { detectCurrency, parseNumber } from "../../components/docs/paste.ts";
import { IconSparkles } from "../../components/Icons.tsx";
import { autoAllocate, type Allocation, PaymentAllocator, savePayment, unpaidOf } from "../../components/payments/PaymentSplit.tsx";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { useAiEnabled } from "../../lib/ai.ts";
import { api, errorMessage, fileUrl } from "../../lib/api.ts";
import type { Counterparty, DocItem, DocumentFull, DocumentRow, ShipmentResponse } from "../../lib/types.ts";

type Initial = {
  existing: DocumentFull | null;
  type: DocType;
  party: Picked | null;
  client: Picked | null;
  deal: PickedShipment | null;
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
  const dealParam = params.get("shipment");
  const cp = useQuery({ queryKey: ["counterparty", cpParam], queryFn: () => api<{ counterparty: Counterparty }>(`/counterparties/${cpParam}`), enabled: !!cpParam && !editId });
  const cl = useQuery({ queryKey: ["counterparty", clientParam], queryFn: () => api<{ counterparty: Counterparty }>(`/counterparties/${clientParam}`), enabled: !!clientParam && !editId });
  const dl = useQuery({ queryKey: ["shipment", Number(dealParam)], queryFn: () => api<ShipmentResponse>(`/shipments/${dealParam}`), enabled: !!dealParam && !editId });

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
        deal: d.shipmentId && d.shipmentNumber ? { id: d.shipmentId, number: d.shipmentNumber, title: d.shipmentTitle ?? "" } : null,
      };
    }
    let type = (params.get("type") as DocType) || null;
    const party = cp.data?.counterparty;
    if (!type && party) type = party.role === "supplier" ? "supplier_invoice" : party.role === "contractor" ? "contractor_invoice" : "commission_contract";
    if (!type && cl.data) type = "commission_contract";
    type ??= "supplier_invoice";
    const sh = dl.data?.shipment;
    const deal = sh ? { ...sh, clientName: sh.client?.name ?? null, supplierName: sh.supplier?.name ?? null } : null;
    const spec = docSpec(type)!;
    // Клиент из карточки клиента — это сторона договора, если документ «с клиентом».
    const clientCp = cl.data?.counterparty;
    return {
      existing: null,
      type,
      party: party ? { id: party.id, name: party.name } : spec.party === "client" && clientCp ? { id: clientCp.id, name: clientCp.name } : spec.party === "client" && deal?.clientId ? { id: deal.clientId, name: deal.clientName ?? "" } : spec.party === "supplier" && deal?.supplierId ? { id: deal.supplierId, name: deal.supplierName ?? "" } : null,
      client: spec.party !== "client" && clientCp ? { id: clientCp.id, name: clientCp.name } : spec.party !== "client" && deal?.clientId ? { id: deal.clientId, name: deal.clientName ?? "" } : null,
      deal: deal ? { id: deal.id, number: deal.number, title: deal.title } : null,
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
  const [deal, setDeal] = useState<PickedShipment | null>(initial.deal);
  const [newDeal, setNewDeal] = useState(!ex && !initial.deal && type === "supplier_invoice");
  const [scheme, setScheme] = useState<keyof typeof SCHEMES>("commission");
  const [newTitle, setNewTitle] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [newVolume, setNewVolume] = useState("");
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
  const aiEnabled = useAiEnabled();
  const [ai, setAi] = useState<{ status: "idle" | "busy" | "done" | "error"; draft?: DocumentDraft; error?: string }>({ status: "idle" });
  // Реквизиты нового контрагента, которые ИИ прочитал из документа (имя → поля).
  const [aiCounterparty, setAiCounterparty] = useState<{ name: string; extra: Record<string, string> } | null>(null);
  // Товары известного поставщика — для выбора вместо «новый товар».
  const partyCard = useQuery({
    queryKey: ["counterparty", party?.id],
    queryFn: () => api<{ products: { productId: number | null; productName: string }[] }>(`/counterparties/${party!.id}`),
    enabled: !!party?.id && spec.party === "supplier",
  });
  const supplierProducts = [...new Map((partyCard.data?.products ?? []).filter((p) => p.productId).map((p) => [p.productId!, { id: p.productId!, name: p.productName }])).values()];
  const [aiFill, setAiFill] = useState<{ id: number; values: Record<string, string> } | null>(null);
  const [applyToDeal, setApplyToDeal] = useState(true);
  const [packingLines, setPackingLines] = useState<PackingLine[]>(((data0.packing as PackingData | undefined)?.lines ?? []).length ? (data0.packing as PackingData).lines : [emptyPackingLine()]);
  // Документ об оплате: к какому счёту прикрепить и отметить ли оплату.
  const [payTarget, setPayTarget] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMark, setPayMark] = useState(true);
  // Одна платёжка на несколько счетов (обычно не нужно — тогда как раньше, один счёт).
  const [paySplit, setPaySplit] = useState(false);
  const [payAllocs, setPayAllocs] = useState<Allocation[]>([]);
  const [payNote, setPayNote] = useState("");
  const payables = useQuery({
    queryKey: ["documents", "payables"],
    queryFn: () => api<{ documents: DocumentRow[] }>("/documents?type=supplier_invoice,contractor_invoice,client_invoice,customs_declaration&limit=300"),
    enabled: type === "payment_order",
  });

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

  /** Черновик ИИ → поля формы. Человек проверяет и сохраняет. */
  const applyDraft = (d: DocumentDraft) => {
    const dSpec = docSpec(d.type)!;
    setType(d.type);
    setParty(d.counterparty);
    setAiCounterparty(d.counterparty && d.counterparty.id === null && d.newCounterparty ? { name: d.counterparty.name, extra: d.newCounterparty } : null);
    setAiFill(d.counterparty?.id && d.counterpartyFill ? { id: d.counterparty.id, values: d.counterpartyFill } : null);
    if (d.client && dSpec.party !== "client") setClient(d.client);
    if (d.number) setNumber(d.number);
    if (d.date) setDate(d.date);
    if (d.currency) setCurrency(d.currency);
    if (d.amount != null) setAmount(String(d.amount));
    // Договор: найденный ИИ; сменилась сторона — прежний не подходит (подберётся первый договор новой стороны).
    if (d.parentId) setParentId(d.parentId);
    else if ((d.counterparty?.id ?? null) !== (party?.id ?? null)) setParentId(null);
    if (d.incoterms) setIncoterms(d.incoterms);
    if (d.paymentTerms) setPaymentTerms(d.paymentTerms);
    if (d.validUntil) setValidUntil(d.validUntil);
    if (d.costCategory) setCostCategory(d.costCategory);
    if (d.costs) setCosts(d.costs);
    if (dSpec.items) setItems(d.items.length ? d.items : [emptyItem()]);
    // Сделка: пришли из карточки сделки — остаёмся в ней; иначе — что нашёл ИИ, или новая (для инвойса поставщика).
    if (!initial.deal) {
      if (d.shipment) {
        setDeal({ id: d.shipment.id, number: d.shipment.number, title: d.shipment.title });
        setNewDeal(false);
      } else {
        setDeal(null);
        // Подходят несколько сделок поставщика — скорее ещё один инвойс в одну из них, а не новая сделка.
        setNewDeal(d.type === "supplier_invoice" && !d.shipmentOptions?.length);
      }
    }
    if (d.cargoTitle) setNewTitle(d.cargoTitle);
    if (d.packing?.lines.length) setPackingLines(d.packing.lines);
    if (d.type === "payment_order") {
      setPayTarget(d.payFor?.id ?? null);
      setPayAmount(d.amount != null ? String(d.amount) : "");
    }
    if (d.weightKg) setNewWeight(String(d.weightKg));
  };

  const recognize = async (f: File) => {
    setAi({ status: "busy" });
    try {
      const form = new FormData();
      form.append("file", f);
      const { draft } = await api<{ draft: DocumentDraft }>("/ai/parse-document", { method: "POST", form });
      applyDraft(draft);
      setAi({ status: "done", draft });
    } catch (err) {
      setAi({ status: "error", error: errorMessage(err) });
    }
  };

  const onFile = (f: File | null) => {
    setFile(f);
    if (f && aiEnabled && !ex) void recognize(f);
    if (!f) setAi({ status: "idle" });
  };

  // ИИ нашёл в документе номер контейнера / вес — предложим записать их в сделку.
  const draft = ai.draft;
  const dealInfo = useQuery({
    queryKey: ["shipment", deal?.number],
    queryFn: () => api<ShipmentResponse>(`/shipments/${deal!.number}`),
    enabled: !!deal && !newDeal && !!(draft?.containerNo || draft?.weightKg || draft?.volumeM3),
  });
  const dealNow = dealInfo.data?.shipment;
  const dealPatch: Record<string, unknown> = {};
  if (dealNow && draft && !newDeal) {
    if (draft.containerNo && draft.containerNo !== dealNow.containerNo) dealPatch.containerNo = draft.containerNo;
    // Упаковочный лист — фактические вес и объём после погрузки: предлагаем заменить; из других документов — только если пусто.
    const fromPacking = draft.type === "packing_list";
    if (draft.weightKg && (fromPacking ? Math.round(draft.weightKg) !== Math.round(dealNow.weightKg ?? 0) : !dealNow.weightKg)) dealPatch.weightKg = draft.weightKg;
    if (draft.volumeM3 && fromPacking && Math.round(draft.volumeM3 * 100) !== Math.round((dealNow.volumeM3 ?? 0) * 100)) dealPatch.volumeM3 = draft.volumeM3;
  }
  const hasDealPatch = Object.keys(dealPatch).length > 0;

  /** Документ об оплате — прикрепить к оплаченному счёту и отметить оплату. */
  const attachPayment = async () => {
    if (paySplit) {
      const total = parseNumber(payAmount);
      if (!total) throw new Error("Укажите сумму платежа");
      await savePayment({ shipment: deal?.number ?? null, number, date, amount: total, currency, note: payNote, allocations: payAllocs }, file);
      await queryClient.invalidateQueries();
      const first = payables.data?.documents.find((d) => d.id === payAllocs.find((a) => a.documentId)?.documentId);
      const sn = deal?.number ?? first?.shipmentNumber;
      navigate(sn ? `/shipments/${sn}` : first ? `/documents/${first.id}` : "/documents");
      return;
    }
    const target = payables.data?.documents.find((d) => d.id === payTarget);
    if (!file) throw new Error("Загрузите файл документа об оплате");
    if (!target) throw new Error("Выберите, какой инвойс / счёт оплачен");
    const form = new FormData();
    form.append("file", file);
    await api(`/documents/${target.id}/files?label=payment`, { method: "POST", form });
    if (payMark) {
      const paid = (target.paymentStatus === "partial" ? (target.paidAmount ?? 0) : 0) + (parseNumber(payAmount) ?? target.amount ?? 0);
      const full = target.amount === null || paid >= target.amount * 0.995;
      await api(`/documents/${target.id}`, { method: "PATCH", body: { paymentStatus: full ? "paid" : "partial", paidAmount: full ? null : paid, paidAt: date || null } });
    }
    await queryClient.invalidateQueries();
    navigate(`/documents/${target.id}`);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (type === "payment_order") {
        await attachPayment();
        return;
      }
      const cpExtra = party && party.id === null && aiCounterparty?.name === party.name ? aiCounterparty.extra : {};
      const counterpartyId = spec.party ? await ensureCounterparty(party, spec.party, cpExtra) : null;
      // Найденному контрагенту — реквизиты из документа, которых у него не было (банк, ОГРН, подписант).
      if (counterpartyId && aiFill?.id === counterpartyId) {
        await api(`/counterparties/${counterpartyId}`, { method: "PATCH", body: aiFill.values }).catch(() => undefined);
      }
      const clientId = await ensureCounterparty(client, "client");
      const data: Record<string, unknown> = { ...data0 };
      if (type === "supplier_invoice") Object.assign(data, { incoterms, paymentTerms });
      if (type === "contractor_invoice") data.costCategory = costCategory || undefined;
      if (type === "power_of_attorney") data.issuedTo = issuedTo;
      if (type === "commission_order") Object.assign(data, { city, incoterms, paymentTerms, deliveryPoint, costs });
      if (type === "packing_list") {
        const lines = packingLines.filter((l) => l.name.trim());
        data.packing = { lines, totals: packingTotals(lines) };
      }
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
      if (!spec.contract) body.shipmentId = newDeal ? null : (deal?.id ?? null);
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
      if (!ex && newDeal && !spec.contract) {
        body.newShipment = { clientId, scheme, title: newTitle.trim() || null, weightKg: parseNumber(newWeight), volumeM3: parseNumber(newVolume) };
      }

      let docId = ex?.id;
      let created: number | null = null;
      if (ex) {
        await api(`/documents/${ex.id}`, { method: "PATCH", body });
      } else {
        const res = await api<{ document: { id: number }; shipment: { number: number } | null }>("/documents", { method: "POST", body });
        docId = res.document.id;
        created = res.shipment?.number ?? null;
      }
      if (file && docId) {
        const form = new FormData();
        form.append("file", file);
        await api(`/documents/${docId}/files?label=${fileLabel}`, { method: "POST", form });
      }
      if (applyToDeal && hasDealPatch && deal && !newDeal) {
        await api(`/shipments/${deal.number}`, { method: "PATCH", body: dealPatch });
      }
      await queryClient.invalidateQueries();
      navigate(created ? `/shipments/${created}` : deal && !ex ? `/shipments/${deal.number}` : `/documents/${docId}`);
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
              <FileDrop file={null} onFile={onFile} />
            </div>
          ) : (
            <FileDrop file={file} onFile={onFile} />
          )}
          {file && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fileLabel === "signed"} onChange={(e) => setFileLabel(e.target.checked ? "signed" : "original")} />
              Это подписанный экземпляр (скан с подписями)
            </label>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {aiEnabled && !file && ai.status === "idle" && !ex && (
            <p className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent dark:bg-accent/10 dark:text-accent-bright">
              <IconSparkles className="shrink-0" />
              Загрузите файл — ИИ сам определит тип, стороны, суммы, позиции и сделку. Вам останется проверить и сохранить.
            </p>
          )}
          {aiEnabled && file && ai.status === "idle" && (
            <button type="button" className="btn" onClick={() => void recognize(file)}>
              <IconSparkles /> Распознать ИИ
            </button>
          )}
          {ai.status === "busy" && (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm dark:bg-accent/10">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span>ИИ читает документ… обычно 10–30 секунд. Поля заполнятся сами.</span>
            </div>
          )}
          {ai.status === "error" && file && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
              <span className="mr-auto">Не удалось распознать: {ai.error}</span>
              <button type="button" className="btn btn-sm" onClick={() => void recognize(file)}>Повторить</button>
            </div>
          )}
          {ai.status === "done" && draft && (
            <div className="space-y-1.5 rounded-md border border-green-300 bg-green-50 px-3 py-2.5 text-sm dark:border-green-900 dark:bg-green-950/30">
              <p className="flex items-start gap-2 font-medium text-green-900 dark:text-green-300">
                <IconSparkles className="mt-0.5 shrink-0" />
                Заполнено ИИ — проверьте поля и сохраните.
                {file && <button type="button" className="ml-auto shrink-0 text-xs font-normal underline" onClick={() => void recognize(file)}>Распознать заново</button>}
              </p>
              {draft.summary && <p>{draft.summary}</p>}
              {draft.shipment && !initial.deal && <p>Сделка: <b>№ {draft.shipment.number} «{draft.shipment.title}»</b>{draft.shipmentReason ? ` — ${draft.shipmentReason}` : ""}</p>}
              {!draft.shipment && !spec.contract && draft.shipmentReason && !initial.deal && (
                <p className="muted">
                  Сделка: {draft.shipmentReason}
                  {draft.shipmentOptions?.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`ml-2 rounded border px-1.5 text-xs ${deal?.id === o.id ? "border-blue-500 text-blue-700 dark:text-blue-300" : "border-slate-300 dark:border-neutral-700"}`}
                      onClick={() => {
                        setDeal({ id: o.id, number: o.number, title: o.title });
                        setNewDeal(false);
                      }}
                    >
                      № {o.number} «{o.title}»
                    </button>
                  ))}
                </p>
              )}
              {initial.deal && draft.shipment && draft.shipment.id !== initial.deal.id && (
                <p className="text-amber-800 dark:text-amber-400">ИИ считает, что документ относится к сделке № {draft.shipment.number} «{draft.shipment.title}», а не к № {initial.deal.number}.</p>
              )}
              {draft.contractNumber && !draft.parentId && spec.parentTypes && <p className="muted">Договор № {draft.contractNumber} в CRM не найден.</p>}
              {draft.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-amber-800 dark:text-amber-400">
                  {draft.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
          {hasDealPatch && deal && (
            <label className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-neutral-800/40">
              <input type="checkbox" className="mt-0.5" checked={applyToDeal} onChange={(e) => setApplyToDeal(e.target.checked)} />
              <span>
                Записать в сделку № {deal.number}:{" "}
                {"containerNo" in dealPatch && <>контейнер <b>{String(dealPatch.containerNo)}</b>{dealNow?.containerNo ? ` (сейчас ${dealNow.containerNo})` : ""}</>}
                {"containerNo" in dealPatch && "weightKg" in dealPatch && ", "}
                {"weightKg" in dealPatch && <>вес <b>{Number(dealPatch.weightKg).toLocaleString("ru-RU")} кг</b>{dealNow?.weightKg ? ` (сейчас ${dealNow.weightKg.toLocaleString("ru-RU")})` : ""}</>}
                {"volumeM3" in dealPatch && <>, объём <b>{Number(dealPatch.volumeM3).toLocaleString("ru-RU")} м³</b>{dealNow?.volumeM3 ? ` (сейчас ${dealNow.volumeM3.toLocaleString("ru-RU")})` : ""}</>}
              </span>
            </label>
          )}
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
                {party && party.id !== null && aiFill?.id === party.id && (
                  <span className="mt-1 block text-xs muted">В карточку допишутся реквизиты из документа: {requisitesList(aiFill.values)}.</span>
                )}
                {party && party.id === null && (
                  <span className="mt-1 block text-xs muted">
                    Будет создан новый {COUNTERPARTY_ROLES[spec.party].one.toLowerCase()} —{" "}
                    {aiCounterparty?.name === party.name
                      ? `реквизиты из документа запишутся сами: ${requisitesList(aiCounterparty.extra)}.`
                      : "реквизиты заполните потом в его карточке."}
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

            {spec.party !== "client" && type !== "payment_order" && (
              <Field label={type === "supplier_contract" ? "Клиент — если это контракт клиента (ТЭУ)" : type === "conformity" ? "Заявитель / держатель" : "Клиент"} wide>
                <CounterpartyPicker role="client" value={client} onChange={setClient} placeholder="Необязательно" />
              </Field>
            )}

            {!spec.contract && type !== "payment_order" && (
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
                    <label>
                      <span className="label">Название груза — как вы его называете</span>
                      <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={items.find((i) => i.name.trim())?.name || "Линолеум коричневый"} />
                    </label>
                    <label>
                      <span className="label">Схема</span>
                      <select className="input" value={scheme} onChange={(e) => setScheme(e.target.value as keyof typeof SCHEMES)}>
                        {Object.entries(SCHEMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:w-1/2">
                      <label>
                        <span className="label">Вес, кг *</span>
                        <input className="input tabular-nums" inputMode="decimal" required value={newWeight} onChange={(e) => setNewWeight(e.target.value)} />
                      </label>
                      <label>
                        <span className="label">Объём, м³ *</span>
                        <input className="input tabular-nums" inputMode="decimal" required value={newVolume} onChange={(e) => setNewVolume(e.target.value)} />
                      </label>
                    </div>
                    <p className="text-xs muted sm:col-span-2">Вес и объём нужны для расчёта пошлины и КП.</p>
                  </div>
                ) : (
                  <ShipmentPicker value={deal} onChange={setDeal} />
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

          {type === "packing_list" && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Места и веса</h2>
              <PackingEditor lines={packingLines} onChange={setPackingLines} />
              <p className="mt-1 text-xs muted">По упаковочному листу заполняется спецификация для перевозчика (в карточке сделки).</p>
            </section>
          )}

          {type === "payment_order" && (
            <section className="space-y-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-neutral-800/40">
              <p>Файл прикрепится к оплаченному инвойсу / счёту (в пакет для таможни попадёт вместе с ним). Отдельным документом не сохраняется.</p>
              {paySplit ? (
                <PaymentAllocator
                  amount={parseNumber(payAmount)}
                  currency={currency}
                  payables={payables.data?.documents ?? []}
                  value={payAllocs}
                  onChange={setPayAllocs}
                  payeeId={payables.data?.documents.find((d) => d.id === payTarget)?.counterpartyId ?? null}
                  shipmentNumber={deal?.number ?? null}
                  note={payNote}
                  onNote={setPayNote}
                />
              ) : (
              <Field label="Что оплачено" wide>
                <select className="input" value={payTarget ?? ""} onChange={(e) => setPayTarget(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— выберите инвойс / счёт —</option>
                  {payables.data?.documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {docTitle(d)}
                      {d.counterpartyName ? ` · ${d.counterpartyName}` : ""}
                      {d.amount !== null ? ` · ${formatMoney(d.amount, d.currency)}` : ""}
                      {d.paymentStatus ? ` · ${PAYMENT_STATUSES[d.paymentStatus as keyof typeof PAYMENT_STATUSES] ?? d.paymentStatus}` : ""}
                      {d.shipmentTitle ? ` · ${d.shipmentTitle}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              )}
              {!paySplit && payTarget !== null && (() => {
                const target = payables.data?.documents.find((d) => d.id === payTarget);
                const total = parseNumber(payAmount);
                const over = target && total !== null && target.amount !== null && total > unpaidOf(target) + 0.5;
                return over ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Платёж больше, чем осталось оплатить по счёту ({formatMoney(unpaidOf(target), target.currency)}).{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setPaySplit(true);
                        setPayAllocs(autoAllocate(total, currency, payables.data?.documents ?? [], { payeeId: target.counterpartyId, shipmentNumber: target.shipmentNumber }));
                      }}
                    >
                      Разнести на несколько счетов
                    </button>
                  </p>
                ) : null;
              })()}
              <button type="button" className="link text-xs" onClick={() => setPaySplit(!paySplit)}>
                {paySplit ? "← одна платёжка — один счёт" : "Одна платёжка на несколько счетов…"}
              </button>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Сумма платежа"><input className="input tabular-nums" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></Field>
                <Field label="Дата платежа"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              </div>
              {paySplit && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Валюта платежа">
                    <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
              )}
              {!paySplit && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={payMark} onChange={(e) => setPayMark(e.target.checked)} />
                Отметить счёт оплаченным (если сумма меньше счёта — «частично»)
              </label>
              )}
            </section>
          )}

          {spec.items && type !== "commission_order" && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Позиции</h2>
              <ItemsEditor
                items={items}
                onChange={setItems}
                currency={currency}
                showHs={type === "supplier_invoice" || type === "specification" || type === "conformity"}
                supplierProducts={supplierProducts}
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
              <ItemsEditor items={items} onChange={setItems} currency={currency} showBatch showHs />
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

const REQUISITE_LABELS: Record<string, string> = {
  inn: "ИНН", kpp: "КПП", ogrn: "ОГРН", legalAddress: "адрес", bankAccount: "р/с", bankBik: "БИК", bankName: "банк",
  signatoryName: "подписант", email: "e-mail", phone: "телефон", country: "страна", regNumber: "рег. номер",
};
/** «ИНН, ОГРН, р/с, БИК, подписант» — что из реквизитов запишется. */
const requisitesList = (v: Record<string, string>) =>
  Object.keys(v).map((k) => REQUISITE_LABELS[k]).filter(Boolean).join(", ") || "страна, адрес";
