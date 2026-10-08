/** Карточка документа. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { COST_CATEGORIES, type CostLine, docSpec, formatMoney, PAYMENT_STATUSES } from "../../../../shared/documents.ts";
import { counterpartyPath, DocumentsTable, docTitle, docTypeLabel, formatDay, PaymentChip, StatusChip, ValidityChip } from "../../components/docs/common.tsx";
import { FilePreview } from "../../components/docs/FilePane.tsx";
import { IconFile, IconPencil, IconTrash } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, ErrorBox, Spinner } from "../../components/ui.tsx";
import { api, BASE, fileUrl } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatDateTime, formatSize } from "../../lib/format.ts";
import type { DocumentFull } from "../../lib/types.ts";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <span className="muted">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function PaymentControl({ data, onSaved }: { data: DocumentFull; onSaved: () => Promise<void> }) {
  const d = data.document;
  const [status, setStatus] = useState(d.paymentStatus ?? "unpaid");
  const [paid, setPaid] = useState(d.paidAmount != null ? String(d.paidAmount) : "");
  const [date, setDate] = useState(d.paidAt ?? new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<unknown>(null);
  const dirty = status !== (d.paymentStatus ?? "unpaid") || (status === "partial" && paid !== String(d.paidAmount ?? "")) || (status !== "unpaid" && date !== (d.paidAt ?? ""));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Статус оплаты">
          {Object.entries(PAYMENT_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {status === "partial" && (
          <input className="input w-32 tabular-nums" inputMode="decimal" placeholder="оплачено" value={paid} onChange={(e) => setPaid(e.target.value)} aria-label="Оплачено" />
        )}
        {status !== "unpaid" && <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата оплаты" />}
        {dirty && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              setError(null);
              try {
                await api(`/documents/${d.id}`, {
                  method: "PATCH",
                  body: { paymentStatus: status, paidAmount: status === "partial" ? paid.replace(",", ".") : null, paidAt: status === "unpaid" ? null : date },
                });
                await onSaved();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Сохранить
          </button>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

export function DocumentPage() {
  const { id } = useParams();
  const docId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["document", docId], queryFn: () => api<DocumentFull>(`/documents/${docId}`) });
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<"original" | "signed">("original");

  if (isLoading) return <Content><Spinner /></Content>;
  if (!data) return <Content><ErrorBox error={error} /></Content>;
  const d = data.document;
  const spec = docSpec(d.type);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["document", docId] });
    await queryClient.invalidateQueries({ queryKey: ["documents"] });
    await queryClient.invalidateQueries({ queryKey: ["deal"] });
  };
  const costs = ((d.data?.costs as CostLine[]) ?? []) as CostLine[];
  const shownFile = data.files.find((f) => f.id === preview) ?? data.files.find((f) => f.label === "signed") ?? data.files[0];

  const upload = async (file: File, label: string) => {
    setUploading(label);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/documents/${docId}/files?label=${label}`, { method: "POST", form });
      await refresh();
    } catch (e) {
      setUploadError(e);
    } finally {
      setUploading(null);
    }
  };

  return (
    <Content wide>
      <div className="mb-1 text-xs muted"><Link to="/documents" className="hover:underline">Документы</Link></div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{docTitle(d)}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusChip status={d.status} />
            <PaymentChip status={d.paymentStatus} paid={d.paidAmount} amount={d.amount} currency={d.currency} />
            <ValidityChip validUntil={d.validUntil} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.type === "commission_order" && (
            <a className="btn btn-primary" href={`${BASE}/api/documents/${docId}/docx`}>
              <IconFile size={14} /> Скачать DOCX
            </a>
          )}
          <Link to={`/documents/${docId}/edit`} className="btn"><IconPencil size={14} /> Изменить</Link>
          {(d.createdBy === user?.id || user?.role === "admin") && (
            <button type="button" className="btn" aria-label="Удалить документ" onClick={() => setDeleting(true)}><IconTrash size={14} /></button>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section>
            <Row label="Тип">{docTypeLabel(d.type)}</Row>
            {d.counterpartyId && (
              <Row label="Сторона">
                <Link to={counterpartyPath(d.counterpartyRole, d.counterpartyId)} className="link">{d.counterpartyName}</Link>
              </Row>
            )}
            {d.clientId && <Row label="Клиент"><Link to={`/clients/${d.clientId}`} className="link">{d.clientName}</Link></Row>}
            {d.dealKey && <Row label="Сделка"><Link to={`/deals/${d.dealKey}`} className="link font-mono">{d.dealKey}</Link></Row>}
            {d.parentId && <Row label="Договор"><Link to={`/documents/${d.parentId}`} className="link">{data.parentLabel}</Link></Row>}
            {d.amount !== null && <Row label="Сумма"><b className="tabular-nums">{formatMoney(d.amount, d.currency)}</b></Row>}
            {spec?.payable && <Row label="Оплата"><PaymentControl key={`${d.paymentStatus}-${d.paidAmount}`} data={data} onSaved={refresh} /></Row>}
            {d.validUntil && <Row label="Действует до">{formatDay(d.validUntil)}</Row>}
            {typeof d.data?.incoterms === "string" && d.data.incoterms && <Row label="Условия поставки">{d.data.incoterms}</Row>}
            {typeof d.data?.paymentTerms === "string" && d.data.paymentTerms && <Row label="Условия оплаты">{d.data.paymentTerms}</Row>}
            {typeof d.data?.deliveryPoint === "string" && d.data.deliveryPoint && <Row label="Пункт доставки">{d.data.deliveryPoint}</Row>}
            {typeof d.data?.issuedTo === "string" && d.data.issuedTo && <Row label="Кому выдана">{d.data.issuedTo}</Row>}
            {typeof d.data?.costCategory === "string" && d.data.costCategory && (
              <Row label="Статья расходов">{COST_CATEGORIES[d.data.costCategory as keyof typeof COST_CATEGORIES]}</Row>
            )}
            {d.notes && <Row label="Заметки"><span className="whitespace-pre-wrap">{d.notes}</span></Row>}
          </section>

          {data.items.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Позиции</h2>
              <div className="panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                      <th className="px-3 py-2 font-medium">Наименование</th>
                      <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                      <th className="px-3 py-2 text-right font-medium">Цена</th>
                      <th className="px-3 py-2 text-right font-medium">Сумма</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                    {data.items.map((it, i) => (
                      <tr key={it.id ?? i}>
                        <td className="px-3 py-2">
                          {it.productId ? <Link to={`/products/${it.productId}`} className="hover:underline">{it.name}</Link> : it.name}
                          {it.batchNo && <span className="ml-2 text-xs muted">партия {it.batchNo}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{it.quantity ?? ""} {it.unit ?? ""}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{it.price !== null ? formatMoney(it.price, d.currency) : ""}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{it.amount !== null ? formatMoney(it.amount, d.currency) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {costs.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Порядок возмещаемых платежей</h2>
              <ul className="panel divide-line text-sm">
                {costs.map((c, i) => (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">{c.name}<span className="block text-xs muted">{c.term}</span></span>
                    <span className="shrink-0 tabular-nums">{c.amount !== null ? formatMoney(c.amount, c.currency) : <span className="muted">подтверждаемый</span>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.children.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Приложения и документы по договору</h2>
              <DocumentsTable rows={data.children} hide={["party"]} />
            </section>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide muted">Файлы</h2>
            <button type="button" className="btn btn-sm" disabled={!!uploading} onClick={() => { labelRef.current = "original"; fileRef.current?.click(); }}>
              {uploading === "original" ? "Загрузка…" : "Добавить файл"}
            </button>
            {spec?.signable && (
              <button type="button" className="btn btn-sm" disabled={!!uploading} onClick={() => { labelRef.current = "signed"; fileRef.current?.click(); }}>
                {uploading === "signed" ? "Загрузка…" : "Загрузить подписанный скан"}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f, labelRef.current);
              }}
            />
          </div>
          <ErrorBox error={uploadError} />
          {data.files.length === 0 ? (
            <p className="text-sm muted">Файл не прикреплён.{d.type === "commission_order" && " Скачайте DOCX, подпишите и загрузите скан."}</p>
          ) : (
            <>
              <ul className="divide-line text-sm">
                {data.files.map((f) => (
                  <li key={f.id} className={`flex items-center gap-2 py-1.5 ${shownFile?.id === f.id ? "font-medium" : ""}`}>
                    <IconFile size={14} className="shrink-0 text-slate-400" />
                    <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => setPreview(f.id)}>{f.filename}</button>
                    {f.label === "signed" && <span className="rounded bg-green-100 px-1.5 text-[11px] text-green-800 dark:bg-green-900/40 dark:text-green-300">подписан</span>}
                    <span className="ml-auto shrink-0 text-xs font-normal muted">{formatSize(f.size)} · {formatDateTime(f.createdAt)}</span>
                    <a href={`${fileUrl(f.id)}?download`} className="text-xs font-normal link">скачать</a>
                  </li>
                ))}
              </ul>
              {shownFile && <FilePreview url={fileUrl(shownFile.id)} mime={shownFile.mime} name={shownFile.filename} />}
            </>
          )}
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Удалить документ?"
          message={`${docTitle(d)} и его файлы будут удалены. Приложения и инвойсы по этому договору останутся, но без привязки к нему.`}
          onConfirm={async () => {
            await api(`/documents/${docId}`, { method: "DELETE" });
            await queryClient.invalidateQueries();
            navigate(d.dealKey ? `/deals/${d.dealKey}` : "/documents");
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Content>
  );
}
