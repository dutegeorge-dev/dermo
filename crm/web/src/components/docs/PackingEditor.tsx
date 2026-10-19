/** Упаковочный лист: строки (кол-во, места, нетто, брутто, объём) и итоги. */

import { emptyPackingLine, type PackingLine, packingTotals } from "../../../../shared/cargo.ts";
import { IconPlus, IconX } from "../Icons.tsx";
import { parseNumber } from "./paste.ts";

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: 3 }));

function Num({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
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

export function PackingEditor({ lines, onChange }: { lines: PackingLine[]; onChange: (lines: PackingLine[]) => void }) {
  const update = (i: number, patch: Partial<PackingLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const t = packingTotals(lines);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs muted">
              <th className="pb-1 font-medium">Товар</th>
              <th className="w-24 pb-1 text-right font-medium">Кол-во</th>
              <th className="w-16 pb-1 font-medium">Ед.</th>
              <th className="w-20 pb-1 text-right font-medium">Мест</th>
              <th className="w-20 pb-1 font-medium">Вид мест</th>
              <th className="w-24 pb-1 text-right font-medium">Нетто, кг</th>
              <th className="w-24 pb-1 text-right font-medium">Брутто, кг</th>
              <th className="w-20 pb-1 text-right font-medium">Объём, м³</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-1"><input className="input px-1.5" aria-label="Товар" value={l.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                <td className="py-0.5 pr-1"><Num label="Количество" value={l.quantity} onChange={(v) => update(i, { quantity: v })} /></td>
                <td className="py-0.5 pr-1"><input className="input px-1.5" aria-label="Единица" value={l.unit ?? ""} onChange={(e) => update(i, { unit: e.target.value || null })} /></td>
                <td className="py-0.5 pr-1"><Num label="Мест" value={l.packages} onChange={(v) => update(i, { packages: v })} /></td>
                <td className="py-0.5 pr-1"><input className="input px-1.5" aria-label="Вид мест" placeholder="рул." value={l.packageType ?? ""} onChange={(e) => update(i, { packageType: e.target.value || null })} /></td>
                <td className="py-0.5 pr-1"><Num label="Нетто" value={l.netKg} onChange={(v) => update(i, { netKg: v })} /></td>
                <td className="py-0.5 pr-1"><Num label="Брутто" value={l.grossKg} onChange={(v) => update(i, { grossKg: v })} /></td>
                <td className="py-0.5 pr-1"><Num label="Объём" value={l.volumeM3} onChange={(v) => update(i, { volumeM3: v })} /></td>
                <td className="py-0.5">
                  <button type="button" className="icon-btn mt-1" aria-label="Удалить строку" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                    <IconX size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="pt-1.5" colSpan={3}>Итого</td>
              <td className="pt-1.5 text-right tabular-nums">{fmt(t.packages)}</td>
              <td />
              <td className="pt-1.5 text-right tabular-nums">{fmt(t.netKg)}</td>
              <td className="pt-1.5 text-right tabular-nums">{fmt(t.grossKg)}</td>
              <td className="pt-1.5 text-right tabular-nums">{fmt(t.volumeM3)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => onChange([...lines, emptyPackingLine()])}>
        <IconPlus size={12} /> Строка
      </button>
    </div>
  );
}
