/** База фабрик: статус и редактор цен фабрики. */

import { useQuery } from "@tanstack/react-query";

import { CURRENCIES } from "../../../../shared/documents.ts";
import { emptyOffer, FACTORY_STATUSES, type Offer } from "../../../../shared/factories.ts";
import { api } from "../../lib/api.ts";
import type { ProductRow } from "../../lib/types.ts";
import { IconPlus, IconX } from "../Icons.tsx";

const COLORS: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-neutral-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function FactoryStatusChip({ status }: { status: string }) {
  const s = FACTORY_STATUSES[status as keyof typeof FACTORY_STATUSES] ?? FACTORY_STATUSES.new;
  return <span className={`rounded px-1.5 text-[11px] ${COLORS[s.color]}`}>{s.label}</span>;
}

/** Названия товаров справочника — подсказки в поле «Товар». */
function useProductNames() {
  return useQuery({ queryKey: ["products", "names"], queryFn: () => api<{ products: ProductRow[] }>("/products"), staleTime: 60_000 });
}

const numValue = (v: number | null) => (v === null ? "" : String(v));
const parseNum = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

/**
 * Цены фабрики. «Товар» — из справочника (без размера рулона и цвета); «Позиция» — как у фабрики, с
 * характеристиками. Карточками, чтобы удобно было и с телефона.
 */
export function OffersEditor({ offers, onChange }: { offers: Offer[]; onChange: (offers: Offer[]) => void }) {
  const names = useProductNames();
  const set = (i: number, patch: Partial<Offer>) => onChange(offers.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const field = (i: number, key: "moq" | "perContainer" | "kgPerUnit" | "m3PerUnit" | "price", label: string, hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" inputMode="decimal" value={numValue(offers[i][key])} placeholder={hint} onChange={(e) => set(i, { [key]: parseNum(e.target.value) })} />
    </label>
  );
  return (
    <div className="space-y-2">
      <datalist id="product-names">
        {names.data?.products.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      {offers.map((o, i) => (
        <div key={i} className="relative rounded-md border border-slate-200 p-3 dark:border-neutral-800">
          <button type="button" className="icon-btn absolute right-1.5 top-1.5" aria-label="Удалить цену" onClick={() => onChange(offers.filter((_, j) => j !== i))}>
            <IconX size={14} />
          </button>
          <div className="grid gap-2 pr-6 sm:grid-cols-2">
            <label className="block">
              <span className="label">Товар (без размера и цвета)</span>
              <input
                className="input"
                list="product-names"
                value={o.productName ?? ""}
                placeholder="Искусственная трава 20 мм"
                onChange={(e) => set(i, { productName: e.target.value, productId: null })}
              />
            </label>
            <label className="block">
              <span className="label">Позиция у фабрики, характеристики</span>
              <input className="input" value={o.name} placeholder="400 г/м², ширина 2 и 4 м" onChange={(e) => set(i, { name: e.target.value })} />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {field(i, "price", "Цена")}
            <label className="block">
              <span className="label">Валюта</span>
              <select className="input" value={o.currency} onChange={(e) => set(i, { currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">За</span>
              <input className="input" value={o.unit ?? ""} placeholder="м²" onChange={(e) => set(i, { unit: e.target.value || null })} />
            </label>
            {field(i, "moq", "Мин. заказ")}
            {field(i, "perContainer", "В 40HQ", "15000")}
            {field(i, "kgPerUnit", "Вес ед., кг", "0.4")}
            <label className="block">
              <span className="label">Дата цены</span>
              <input type="date" className="input" value={o.quotedAt ?? ""} onChange={(e) => set(i, { quotedAt: e.target.value || null })} />
            </label>
          </div>
          <label className="mt-2 block">
            <span className="label">Условия</span>
            <input className="input" value={o.conditions} placeholder="EXW Линьи, от 5000 м² одного цвета" onChange={(e) => set(i, { conditions: e.target.value })} />
          </label>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...offers, { ...emptyOffer(), quotedAt: new Date().toISOString().slice(0, 10) }])}>
        <IconPlus size={12} /> Цена
      </button>
    </div>
  );
}
