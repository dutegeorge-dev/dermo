/** Позиции документа: таблица с подсказками товаров и вставкой из Excel. */

import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { formatMoney } from "../../../../shared/documents.ts";
import { api } from "../../lib/api.ts";
import type { DocItem, ProductRow } from "../../lib/types.ts";
import { IconPlus, IconX } from "../Icons.tsx";
import { isTabular, parseNumber, parsePastedItems } from "./paste.ts";

export const emptyItem = (): DocItem => ({ productId: null, name: "", batchNo: null, hsCode: null, quantity: null, unit: null, price: null, amount: null });

export function itemAmount(i: DocItem): number | null {
  if (i.amount !== null) return i.amount;
  if (i.quantity !== null && i.price !== null) return Math.round(i.quantity * i.price * 100) / 100;
  return null;
}

function NumCell({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <input
      className="input px-1.5 text-right tabular-nums"
      inputMode="decimal"
      aria-label={label}
      defaultValue={value ?? ""}
      key={value ?? "empty"}
      onBlur={(e) => onChange(e.target.value.trim() ? parseNumber(e.target.value) : null)}
    />
  );
}

/** Ставка пошлины по коду ТН ВЭД (из справочника). */
export function useTariff(code: string | null | undefined) {
  const valid = !!code && /^\d{10}$/.test(code);
  const { data } = useQuery({
    queryKey: ["tnved", code],
    queryFn: () => api<{ codes: { code: string; name: string; tariff: string }[] }>(`/tnved?q=${code}`),
    enabled: valid,
    staleTime: 60 * 60_000,
  });
  if (!valid) return null;
  const row = data?.codes.find((c) => c.code === code);
  return data ? (row ?? { code: code!, name: "", tariff: "" }) : undefined;
}

/** Код ТН ВЭД позиции: поле + ставка под ним; «ИИ» — код подобран автоматически, проверьте. */
function HsCell({ item, onChange }: { item: DocItem; onChange: (hsCode: string | null) => void }) {
  const tariff = useTariff(item.hsCode);
  return (
    <div>
      <input
        className={`input px-1.5 font-mono text-xs ${item.hsAuto ? "border-amber-400 dark:border-amber-600" : ""}`}
        aria-label="Код ТН ВЭД"
        value={item.hsCode ?? ""}
        placeholder="10 цифр"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10) || null)}
      />
      <div className="mt-0.5 text-[10px] leading-tight muted" title={tariff?.name}>
        {item.hsAuto && <span className="mr-1 text-amber-700 dark:text-amber-400">ИИ, проверьте ·</span>}
        {tariff === null ? (item.hsCode ? "нужно 10 цифр" : "") : tariff === undefined ? "…" : tariff.tariff || <span className="text-amber-700 dark:text-amber-400">нет в справочнике</span>}
      </div>
    </div>
  );
}

export function ItemsEditor({
  items,
  onChange,
  currency,
  showBatch = false,
  showHs = false,
  onPasteInfo,
  supplierProducts = [],
}: {
  items: DocItem[];
  onChange: (items: DocItem[]) => void;
  currency: string | null;
  showBatch?: boolean;
  /** Колонка «ТН ВЭД» со ставкой пошлины (инвойс поставщика, поручение). */
  showHs?: boolean;
  onPasteInfo?: (text: string) => void;
  /** Товары, которые уже брали у этого поставщика — предлагаем вместо «новый товар». */
  supplierProducts?: { id: number; name: string }[];
}) {
  const listId = useId();
  const { data } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => api<{ products: ProductRow[] }>("/products"),
    staleTime: 60_000,
  });
  const update = (i: number, patch: Partial<DocItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const onPaste = (i: number) => (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!isTabular(text)) return;
    const parsed = parsePastedItems(text);
    if (parsed.length === 0) return;
    e.preventDefault();
    const before = items.slice(0, i).filter((it) => it.name.trim());
    const after = items.slice(i + 1).filter((it) => it.name.trim());
    onChange([...before, ...parsed, ...after]);
    onPasteInfo?.(text);
  };

  const total = items.reduce((s, i) => s + (itemAmount(i) ?? 0), 0);

  return (
    <div>
      <datalist id={listId}>
        {data?.products.map((p) => <option key={p.id} value={p.name}>{p.hsCode ?? ""}</option>)}
      </datalist>
      <div className="overflow-x-auto">
        <table className={`w-full ${showHs ? "min-w-[780px]" : "min-w-[640px]"} text-sm`}>
          <thead>
            <tr className="text-left text-xs muted">
              <th className="w-6 pb-1 font-medium">№</th>
              <th className="pb-1 font-medium">Наименование</th>
              {showBatch && <th className="w-16 pb-1 font-medium">Партия</th>}
              {showHs && <th className="w-32 pb-1 font-medium">ТН ВЭД</th>}
              <th className="w-24 pb-1 text-right font-medium">Кол-во</th>
              <th className="w-20 pb-1 font-medium">Ед.</th>
              <th className="w-24 pb-1 text-right font-medium">Цена</th>
              <th className="w-28 pb-1 text-right font-medium">Сумма</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="align-top">
                <td className="py-0.5 pr-1 pt-2 text-xs muted">{i + 1}</td>
                <td className="py-0.5 pr-1">
                  <input
                    className="input px-1.5"
                    list={listId}
                    value={it.name}
                    placeholder={i === 0 ? "Наименование — или вставьте таблицу из Excel (Ctrl+V)" : ""}
                    aria-label="Наименование"
                    onChange={(e) => {
                      // Выбрали товар из справочника — берём его код ТН ВЭД.
                      const p = data?.products.find((x) => x.name === e.target.value);
                      update(i, p ? { name: p.name, productId: p.id, hsCode: p.hsCode ?? it.hsCode, hsAuto: false } : { name: e.target.value, productId: null });
                    }}
                    onPaste={onPaste(i)}
                  />
                  {it.name.trim() && showHs && (
                    <ProductLink
                      item={it}
                      productName={it.productId ? (data?.products.find((p) => p.id === it.productId)?.name ?? it.productName ?? null) : null}
                      supplierProducts={supplierProducts}
                      onPick={(p) => update(i, p ? { productId: p.id, productGuess: false } : { productId: null, productGuess: false })}
                    />
                  )}
                </td>
                {showBatch && (
                  <td className="py-0.5 pr-1">
                    <input className="input px-1.5" value={it.batchNo ?? ""} aria-label="Партийный номер" onChange={(e) => update(i, { batchNo: e.target.value || null })} />
                  </td>
                )}
                {showHs && (
                  <td className="py-0.5 pr-1">
                    <HsCell item={it} onChange={(hsCode) => update(i, { hsCode, hsAuto: false })} />
                  </td>
                )}
                <td className="py-0.5 pr-1"><NumCell label="Количество" value={it.quantity} onChange={(v) => update(i, { quantity: v })} /></td>
                <td className="py-0.5 pr-1">
                  <input className="input px-1.5" value={it.unit ?? ""} aria-label="Единица" placeholder="шт." onChange={(e) => update(i, { unit: e.target.value || null })} />
                </td>
                <td className="py-0.5 pr-1"><NumCell label="Цена" value={it.price} onChange={(v) => update(i, { price: v })} /></td>
                <td className="py-0.5 pr-1">
                  <input
                    className="input px-1.5 text-right tabular-nums"
                    inputMode="decimal"
                    aria-label="Сумма"
                    key={`${it.amount}-${it.quantity}-${it.price}`}
                    defaultValue={it.amount ?? ""}
                    placeholder={itemAmount(it)?.toLocaleString("ru-RU") ?? ""}
                    onBlur={(e) => update(i, { amount: e.target.value.trim() ? parseNumber(e.target.value) : null })}
                  />
                </td>
                <td className="py-0.5">
                  <button type="button" className="icon-btn mt-1" aria-label="Удалить позицию" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    <IconX size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...items, emptyItem()])}>
          <IconPlus size={12} /> Позиция
        </button>
        <span className="text-sm">
          Итого: <b className="tabular-nums">{formatMoney(total, currency)}</b>
        </span>
      </div>
    </div>
  );
}

/**
 * Чей это товар: позиция (с размером, цветом) остаётся как в документе, а товар справочника выбирается отдельно —
 * у известного поставщика из его товаров, иначе — новый товар.
 */
function ProductLink({
  item,
  productName,
  supplierProducts,
  onPick,
}: {
  item: DocItem;
  productName: string | null;
  supplierProducts: { id: number; name: string }[];
  onPick: (p: { id: number } | null) => void;
}) {
  const options = productName && item.productId && !supplierProducts.some((p) => p.id === item.productId) ? [{ id: item.productId, name: productName }, ...supplierProducts] : supplierProducts;
  const tone = item.productGuess ? "text-amber-700 dark:text-amber-400" : item.productId ? "text-green-700 dark:text-green-400" : "muted";
  if (!options.length) {
    return <div className={`mt-0.5 text-[10px] ${tone}`}>{item.productId ? `товар: ${productName ?? "в справочнике"}` : "новый товар"}</div>;
  }
  return (
    <div className={`mt-0.5 flex items-center gap-1 text-[10px] ${tone}`}>
      <span className="shrink-0">{item.productGuess ? "товар поставщика по артикулу, проверьте:" : "товар:"}</span>
      <select
        className="min-w-0 max-w-full truncate rounded border border-transparent bg-transparent py-0 text-[10px] hover:border-slate-300 dark:hover:border-neutral-700"
        value={item.productId ?? ""}
        aria-label="Товар справочника"
        onChange={(e) => onPick(e.target.value ? { id: Number(e.target.value) } : null)}
      >
        <option value="">новый товар</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
