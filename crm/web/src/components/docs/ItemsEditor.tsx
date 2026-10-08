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

export function ItemsEditor({
  items,
  onChange,
  currency,
  showBatch = false,
  onPasteInfo,
}: {
  items: DocItem[];
  onChange: (items: DocItem[]) => void;
  currency: string | null;
  showBatch?: boolean;
  onPasteInfo?: (text: string) => void;
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
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs muted">
              <th className="w-6 pb-1 font-medium">№</th>
              <th className="pb-1 font-medium">Наименование</th>
              {showBatch && <th className="w-16 pb-1 font-medium">Партия</th>}
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
                    onChange={(e) => update(i, { name: e.target.value, productId: null })}
                    onPaste={onPaste(i)}
                  />
                </td>
                {showBatch && (
                  <td className="py-0.5 pr-1">
                    <input className="input px-1.5" value={it.batchNo ?? ""} aria-label="Партийный номер" onChange={(e) => update(i, { batchNo: e.target.value || null })} />
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
