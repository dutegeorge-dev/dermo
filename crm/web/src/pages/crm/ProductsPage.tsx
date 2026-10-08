/** Товары: справочник и карточка с ценами поставщиков и продажами клиентам. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { formatMoney } from "../../../../shared/documents.ts";
import { docTypeLabel, formatDay } from "../../components/docs/common.tsx";
import { IconSearch } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import type { ProductLine, ProductRow } from "../../lib/types.ts";

export function ProductsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["products", "list", q.trim()],
    queryFn: () => api<{ products: ProductRow[] }>(`/products?q=${encodeURIComponent(q.trim())}`),
    placeholderData: (prev) => prev,
  });
  return (
    <Content wide>
      <PageHeader title="Товары" meta="Справочник пополняется сам из позиций инвойсов и поручений" />
      <label className="relative mb-4 block max-w-sm">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="search" className="input pl-8" placeholder="Наименование или код ТН ВЭД" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.products.length === 0 && <EmptyState title={q ? "Ничего не найдено" : "Товаров пока нет"}>Они появятся, когда вы загрузите инвойс поставщика.</EmptyState>}
      {data && data.products.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <th className="px-4 py-2 font-medium">Наименование</th>
                <th className="px-4 py-2 font-medium">ТН ВЭД</th>
                <th className="px-4 py-2 text-right font-medium">Последняя закупка</th>
                <th className="px-4 py-2 text-right font-medium">Поставщиков</th>
                <th className="px-4 py-2 text-right font-medium">Клиентов</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {data.products.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/50" onClick={() => navigate(`/products/${p.id}`)}>
                  <td className="px-4 py-2">
                    <Link to={`/products/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium">{p.name}</Link>
                    {p.nameRu && <span className="ml-2 text-xs muted">{p.nameRu}</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{p.hsCode ?? ""}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {p.lastPrice !== null ? formatMoney(p.lastPrice, p.lastCurrency) : "—"}
                    {p.unit && p.lastPrice !== null && <span className="muted"> / {p.unit}</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.supplierCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.clientCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Content>
  );
}

function LinesTable({ lines, who }: { lines: ProductLine[]; who: "supplier" | "client" }) {
  if (lines.length === 0) return <p className="text-sm muted">Пока нет.</p>;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
            <th className="px-3 py-2 font-medium">Дата</th>
            <th className="px-3 py-2 font-medium">{who === "supplier" ? "Поставщик" : "Клиент"}</th>
            <th className="px-3 py-2 text-right font-medium">Цена</th>
            <th className="px-3 py-2 text-right font-medium">Кол-во</th>
            <th className="px-3 py-2 font-medium">Документ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDay(l.date)}</td>
              <td className="px-3 py-2">
                {who === "supplier"
                  ? l.counterpartyId && <Link to={`/suppliers/${l.counterpartyId}`} className="link">{l.counterpartyName}</Link>
                  : l.clientId && <Link to={`/clients/${l.clientId}`} className="link">{l.clientName}</Link>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.price !== null ? formatMoney(l.price, l.currency) : "—"}{l.unit && <span className="muted"> / {l.unit}</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.quantity ?? ""}</td>
              <td className="px-3 py-2 text-xs">
                <Link to={`/documents/${l.documentId}`} className="link">{docTypeLabel(l.type)} № {l.number ?? "—"}</Link>
                {l.dealKey && <> · <Link to={`/deals/${l.dealKey}`} className="link font-mono">{l.dealKey}</Link></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductPage() {
  const { id } = useParams();
  const pid = Number(id);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["product", pid],
    queryFn: () => api<{ product: ProductRow & { notes: string }; purchases: ProductLine[]; sales: ProductLine[]; certificates: ProductLine[] }>(`/products/${pid}`),
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", nameRu: "", hsCode: "", unit: "", notes: "" });
  const [err, setErr] = useState<unknown>(null);
  if (isLoading) return <Content><Spinner /></Content>;
  if (!data) return <Content><ErrorBox error={error} /></Content>;
  const p = data.product;

  return (
    <Content wide>
      <div className="mb-1 text-xs muted"><Link to="/products" className="hover:underline">Товары</Link></div>
      <PageHeader
        title={p.name}
        meta={[p.nameRu, p.hsCode && `ТН ВЭД ${p.hsCode}`, p.unit].filter(Boolean).join(" · ")}
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => {
              setForm({ name: p.name, nameRu: p.nameRu ?? "", hsCode: p.hsCode ?? "", unit: p.unit ?? "", notes: p.notes ?? "" });
              setEditing(true);
            }}
          >
            Изменить
          </button>
        }
      />
      {p.notes && <p className="mb-5 whitespace-pre-wrap text-sm">{p.notes}</p>}
      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Закупки у поставщиков</h2>
        <LinesTable lines={data.purchases} who="supplier" />
      </section>
      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Клиентам (поручения, спецификации)</h2>
        <LinesTable lines={data.sales} who="client" />
      </section>
      {editing && (
        <Modal
          title="Товар"
          onClose={() => setEditing(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Отмена</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await api(`/products/${pid}`, { method: "PATCH", body: form });
                    await queryClient.invalidateQueries({ queryKey: ["product", pid] });
                    await queryClient.invalidateQueries({ queryKey: ["products"] });
                    setEditing(false);
                  } catch (e) {
                    setErr(e);
                  }
                }}
              >
                Сохранить
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {(
              [
                ["name", "Наименование (как в инвойсе)"],
                ["nameRu", "Наименование по-русски"],
                ["hsCode", "Код ТН ВЭД"],
                ["unit", "Единица"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="block">
                <span className="label">{l}</span>
                <input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
            <label className="block">
              <span className="label">Заметки</span>
              <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <ErrorBox error={err} />
          </div>
        </Modal>
      )}
    </Content>
  );
}
