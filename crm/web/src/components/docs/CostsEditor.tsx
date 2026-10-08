/** Смета поручения: статьи возмещаемых платежей. Пустая сумма = «Подтверждаемый расход». */

import { COST_CATEGORIES, type CostCategory, type CostLine, CURRENCIES } from "../../../../shared/documents.ts";
import { IconArrowDown, IconArrowUp, IconX } from "../Icons.tsx";
import { parseNumber } from "./paste.ts";

export function CostsEditor({ costs, onChange }: { costs: CostLine[]; onChange: (c: CostLine[]) => void }) {
  const update = (i: number, patch: Partial<CostLine>) => onChange(costs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: number) => {
    const next = [...costs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {costs.map((c, i) => (
        <div key={i} className="grid gap-1.5 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_130px_80px_auto] dark:border-neutral-700">
          <input className="input" value={c.name} aria-label="Статья" onChange={(e) => update(i, { name: e.target.value })} />
          <input
            className="input text-right tabular-nums"
            inputMode="decimal"
            aria-label="Сумма"
            placeholder="подтверждаемый"
            key={`${i}-${c.amount}`}
            defaultValue={c.amount ?? ""}
            onBlur={(e) => update(i, { amount: e.target.value.trim() ? parseNumber(e.target.value) : null })}
          />
          <select className="input" value={c.currency} aria-label="Валюта" onChange={(e) => update(i, { currency: e.target.value })}>
            {CURRENCIES.map((x) => <option key={x}>{x}</option>)}
          </select>
          <span className="flex">
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше"><IconArrowUp size={12} /></button>
            <button type="button" className="icon-btn" disabled={i === costs.length - 1} onClick={() => move(i, 1)} aria-label="Ниже"><IconArrowDown size={12} /></button>
            <button type="button" className="icon-btn hover:text-red-600" onClick={() => onChange(costs.filter((_, j) => j !== i))} aria-label="Удалить"><IconX size={12} /></button>
          </span>
          <input className="input text-xs sm:col-span-4" value={c.term} placeholder="Срок оплаты" aria-label="Срок оплаты" onChange={(e) => update(i, { term: e.target.value })} />
        </div>
      ))}
      <select
        className="input w-auto text-sm"
        value=""
        aria-label="Добавить статью"
        onChange={(e) => {
          const category = e.target.value as CostCategory;
          if (category) onChange([...costs, { category, name: COST_CATEGORIES[category], amount: null, currency: "RUB", term: "" }]);
        }}
      >
        <option value="">+ Добавить статью…</option>
        {Object.entries(COST_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <p className="text-xs muted">Пустая сумма печатается как «Подтверждаемый расход».</p>
    </div>
  );
}
