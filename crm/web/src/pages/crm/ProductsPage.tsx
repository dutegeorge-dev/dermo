/** Товары: справочник и карточка с ценами поставщиков и продажами клиентам. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { formatMoney } from "../../../../shared/documents.ts";
import { docTypeLabel, formatDay, ValidityChip } from "../../components/docs/common.tsx";
import { useTariff } from "../../components/docs/ItemsEditor.tsx";
import { IconChevronDown, IconChevronRight, IconSearch } from "../../components/Icons.tsx";
import { type ProductOffer, QuoteCalculator } from "../../components/products/QuoteCalculator.tsx";
import { Content } from "../../components/Layout.tsx";
import { ConfirmDialog, EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { useAuth } from "../../lib/auth.tsx";
import { api, fileUrl } from "../../lib/api.ts";
import type { ProductLine, ProductRow } from "../../lib/types.ts";

export function ProductsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["products", "list", q.trim()],
    queryFn: () => api<{ products: ProductRow[] }>(`/products?q=${encodeURIComponent(q.trim())}`),
    placeholderData: (prev) => prev,
  });
  return (
    <Content wide>
      <PageHeader
        title="Товары"
        meta="Пополняется сам из инвойсов и цен фабрик. Размер рулона и цвет — варианты товара, а не новые товары."
        actions={
          <>
            {user?.role === "admin" && <UnusedProductsButton />}
            <Link to="/freight-rates" className="btn">
              Ставки доставки
            </Link>
          </>
        }
      />
      <DuplicatesBanner />
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
                <th className="px-4 py-2 text-right font-medium">Цены фабрик</th>
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
                    {p.variantCount > 1 && <span className="block text-[11px] muted">{p.variantCount} вариантов</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{p.hsCode ?? ""}</span>
                    {p.tariff && <span className="block text-[11px] muted">пошлина {p.tariff}{p.vat10 ? " · НДС 10 %" : ""}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {p.lastPrice !== null ? formatMoney(p.lastPrice, p.lastCurrency) : "—"}
                    {p.unit && p.lastPrice !== null && <span className="muted"> / {p.unit}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {p.bestOffer ? (
                      <>
                        от {formatMoney(p.bestOffer.price, p.bestOffer.currency)}
                        {p.bestOffer.unit && <span className="muted"> / {p.bestOffer.unit}</span>}
                        <span className="block text-[11px] muted">{p.factoryCount} фабр.</span>
                      </>
                    ) : p.factoryCount ? (
                      `${p.factoryCount} фабр.`
                    ) : (
                      "—"
                    )}
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
                {l.shipmentNumber && <> · <Link to={`/shipments/${l.shipmentNumber}`} className="link">{l.shipmentTitle || `№ ${l.shipmentNumber}`}</Link></>}
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
    queryFn: () =>
      api<{
        product: ProductRow & { notes: string };
        variants: { name: string; documents: number; offers: number }[];
        tnved: { name: string; tariff: string } | null;
        purchases: ProductLine[];
        sales: ProductLine[];
        certificates: { id: number; number: string | null; date: string | null; validUntil: string | null; status: string | null; counterpartyId: number | null; counterpartyName: string | null; fileId: string | null }[];
      }>(`/products/${pid}`),
  });
  const offers = useQuery({
    queryKey: ["product-offers", pid],
    queryFn: () => api<{ offers: ProductOffer[]; photos: { id: string; factoryId: number; filename: string }[] }>(`/products/${pid}/offers`),
  });
  const [calcOpen, setCalcOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", nameRu: "", hsCode: "", unit: "", notes: "", vat10: false });
  const tariff = useTariff(editing ? form.hsCode.replace(/\D/g, "") : null);
  const [err, setErr] = useState<unknown>(null);
  if (isLoading) return <Content><Spinner /></Content>;
  if (!data) return <Content><ErrorBox error={error} /></Content>;
  const p = data.product;

  return (
    <Content wide>
      <div className="mb-1 text-xs muted"><Link to="/products" className="hover:underline">Товары</Link></div>
      <PageHeader
        title={p.name}
        meta={[p.nameRu, p.hsCode && `ТН ВЭД ${p.hsCode}`, data.tnved?.tariff && `пошлина ${data.tnved.tariff}`, p.vat10 ? "НДС 10 %" : p.hsCode ? "НДС 22 %" : null, p.unit].filter(Boolean).join(" · ")}
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => {
              setForm({ name: p.name, nameRu: p.nameRu ?? "", hsCode: p.hsCode ?? "", unit: p.unit ?? "", notes: p.notes ?? "", vat10: p.vat10 });
              setEditing(true);
            }}
          >
            Изменить
          </button>
        }
      />
      {data.tnved && <p className="mb-3 text-xs muted">ТН ВЭД {p.hsCode}: {data.tnved.name}</p>}
      {p.notes && <p className="mb-5 whitespace-pre-wrap text-sm">{p.notes}</p>}
      {!p.hsCode && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">Нет кода ТН ВЭД — пошлина в расчёте будет 0. Нажмите «Изменить» и впишите код.</p>}

      <section className="panel mb-6 p-4">
        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setCalcOpen(!calcOpen)} aria-expanded={calcOpen}>
          {calcOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span className="text-sm font-semibold">Рассчитать для клиента</span>
          <span className="text-xs muted">цена за {p.unit ?? "ед."} с доставкой, таможней и маржой · КП</span>
        </button>
        {calcOpen && offers.data && (
          <div className="mt-4">
            <QuoteCalculator product={p} offers={offers.data.offers} />
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Цены фабрик</h2>
        {offers.data && offers.data.photos.length > 0 && (
          <ul className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {offers.data.photos.map((ph) => (
              <li key={ph.id} className="shrink-0">
                <a href={fileUrl(ph.id)} target="_blank" rel="noreferrer">
                  <img src={fileUrl(ph.id)} alt={ph.filename} loading="lazy" className="h-24 w-24 rounded object-cover" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {offers.data && offers.data.offers.length === 0 && (
          <p className="text-sm muted">
            Пока нет. Цены появятся из <Link to="/factories" className="link">базы фабрик</Link>.
          </p>
        )}
        {offers.data && offers.data.offers.length > 0 && (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                  <th className="px-3 py-2 font-medium">Фабрика</th>
                  <th className="px-3 py-2 font-medium">Позиция</th>
                  <th className="px-3 py-2 text-right font-medium">Цена</th>
                  <th className="px-3 py-2 text-right font-medium">Мин. заказ</th>
                  <th className="px-3 py-2 text-right font-medium">В 40HQ</th>
                  <th className="px-3 py-2 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
                {offers.data.offers.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2">
                      <Link to={`/factories/${o.factoryId}`} className="link">{o.factoryNameRu || o.factoryName}</Link>
                      <span className="block text-[11px] muted">{[o.factoryLocation, o.supplierId ? "поставщик" : "кандидат"].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-3 py-2">
                      {o.name}
                      {o.conditions && <span className="block text-[11px] muted">{o.conditions}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {o.price !== null ? formatMoney(o.price, o.currency) : "—"}
                      {o.unit && <span className="muted"> / {o.unit}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{o.moq ? `${o.moq.toLocaleString("ru-RU")} ${o.unit ?? ""}` : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{o.perContainer ? o.perContainer.toLocaleString("ru-RU") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDay(o.quotedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide muted">Декларации и сертификаты</h2>
          <Link to="/documents/new?type=conformity" className="ml-auto text-xs link">+ загрузить</Link>
        </div>
        {data.certificates.length === 0 ? (
          <p className="text-sm muted">Нет. Загрузите декларацию — она сама привяжется ко всем товарам с артикулами из неё и к поставщику-изготовителю.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-200 px-3 py-2 dark:border-neutral-800">
                <Link to={`/documents/${c.id}`} className="font-medium hover:underline">№ {c.number ?? "б/н"}</Link>
                {c.date && <span className="text-xs muted">от {formatDay(c.date)}</span>}
                {c.counterpartyId && <Link to={`/suppliers/${c.counterpartyId}`} className="text-xs link">{c.counterpartyName}</Link>}
                <span className="flex-1" />
                <ValidityChip validUntil={c.validUntil} />
                {c.validUntil && <span className="text-xs muted">до {formatDay(c.validUntil)}</span>}
                {c.fileId ? (
                  <a href={fileUrl(c.fileId)} target="_blank" rel="noreferrer" className="text-xs link">файл</a>
                ) : (
                  <span className="text-xs text-amber-700 dark:text-amber-400">без файла</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.variants.length > 1 && (
        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Варианты (размер, цвет, характеристики)</h2>
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {data.variants.map((v) => (
              <li key={v.name} className="rounded border border-slate-200 px-2 py-0.5 dark:border-neutral-800" title={`в документах: ${v.documents}, у фабрик: ${v.offers}`}>
                {v.name}
              </li>
            ))}
          </ul>
        </section>
      )}
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
            <p className="-mt-2 text-xs muted">
              {tariff === undefined ? "…" : tariff ? (tariff.tariff ? `Пошлина: ${tariff.tariff}. ${tariff.name.slice(-120)}` : "Такого кода нет в справочнике ТН ВЭД") : "Код ТН ВЭД — 10 цифр; по нему считается пошлина."}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.vat10} onChange={(e) => setForm({ ...form, vat10: e.target.checked })} />
              НДС при ввозе 10 % (льготный перечень) — иначе 22 %
            </label>
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

type DuplicateGroup = { baseName: string; products: { id: number; name: string; hsCode: string | null; uses: number }[] };

/** Дубли: одно название без размера рулона и цвета — предложение объединить в один товар. */
function DuplicatesBanner() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["products", "duplicates"], queryFn: () => api<{ groups: DuplicateGroup[] }>("/products/duplicates") });
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!data?.groups.length) return null;
  const groups = data.groups;
  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const g of groups) {
        if (skip.has(g.baseName)) continue;
        // Главный — самый используемый (его история цен больше).
        const ordered = [...g.products].sort((a, b) => b.uses - a.uses);
        await api("/products/merge", { method: "POST", body: { ids: ordered.map((p) => p.id), name: names[g.baseName] ?? g.baseName } });
      }
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <span>
          Похожих товаров: {groups.length} {groups.length === 1 ? "группа" : "групп"} — отличаются только размером рулона или цветом.
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Посмотреть и объединить
        </button>
      </div>
      {open && (
        <Modal
          title="Объединить варианты в товары"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" disabled={busy || skip.size === groups.length} onClick={() => void merge()}>
                {busy ? "Объединяем…" : `Объединить (${groups.length - skip.size})`}
              </button>
            </>
          }
        >
          <p className="mb-3 text-sm muted">Позиции инвойсов и цены фабрик перейдут к одному товару; названия позиций (размер, цвет) сохранятся.</p>
          <ul className="space-y-3">
            {groups.map((g) => (
              <li key={g.baseName} className="rounded-md border border-slate-200 p-2 dark:border-neutral-800">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!skip.has(g.baseName)}
                    onChange={(e) => {
                      const next = new Set(skip);
                      if (e.target.checked) next.delete(g.baseName);
                      else next.add(g.baseName);
                      setSkip(next);
                    }}
                  />
                  <input className="input py-1" value={names[g.baseName] ?? g.baseName} onChange={(e) => setNames({ ...names, [g.baseName]: e.target.value })} aria-label="Название товара" />
                </label>
                <ul className="ml-6 mt-1 text-xs muted">
                  {g.products.map((p) => (
                    <li key={p.id}>
                      {p.name}
                      {p.hsCode ? ` · ${p.hsCode}` : ""}
                    </li>
                  ))}
                </ul>
                {new Set(g.products.map((p) => p.hsCode).filter(Boolean)).size > 1 && <p className="ml-6 text-[11px] text-amber-700 dark:text-amber-400">Разные коды ТН ВЭД — останется код главного товара, проверьте.</p>}
              </li>
            ))}
          </ul>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}

/** «Удалить пустые товары» (админ): без закупок, продаж, цен фабрик и расчётов — например, лишние из декларации. */
function UnusedProductsButton() {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ count: number; names: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          setError(null);
          try {
            setPreview(await api<{ count: number; names: string[] }>("/products/unused"));
          } catch (e) {
            setError(e);
          }
        }}
      >
        Удалить пустые товары
      </button>
      {error != null && <ErrorBox error={error} />}
      {preview && (
        <ConfirmDialog
          title={preview.count ? `Удалить пустые товары (${preview.count})?` : "Пустых товаров нет"}
          confirmLabel={preview.count ? "Удалить" : "Закрыть"}
          danger={preview.count > 0}
          message={
            preview.count ? (
              <>
                <p className="mb-2">Без закупок, продаж, цен фабрик и расчётов. Декларации останутся — товары подхватятся по артикулу, когда появятся в инвойсах.</p>
                <ul className="max-h-60 list-disc overflow-y-auto pl-5 text-xs">
                  {preview.names.map((n) => <li key={n}>{n}</li>)}
                  {preview.count > preview.names.length && <li>… и ещё {preview.count - preview.names.length}</li>}
                </ul>
              </>
            ) : (
              "Все товары где-то используются."
            )
          }
          onClose={() => setPreview(null)}
          onConfirm={async () => {
            if (!preview.count) return;
            await api("/products/unused/delete", { method: "POST" });
            await queryClient.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      )}
    </>
  );
}
