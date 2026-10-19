/** Ставки доставки: справочник для расчёта цены товара. Добавить — вручную или вставить переписку (ИИ разберёт). */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CURRENCIES, formatMoney } from "../../../../shared/documents.ts";
import { CONTAINERS, FREIGHT_MODES, FREIGHT_TRANSPORTS, type FreightRate } from "../../../../shared/quote.ts";
import { formatDay } from "../../components/docs/common.tsx";
import { IconPencil, IconPlus, IconSparkles, IconTrash } from "../../components/Icons.tsx";
import { Content } from "../../components/Layout.tsx";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from "../../components/ui.tsx";
import { useAiEnabled } from "../../lib/ai.ts";
import { api } from "../../lib/api.ts";

type Draft = Partial<Omit<FreightRate, "id">> & { id?: number };

export function useFreightRates() {
  return useQuery({ queryKey: ["freight-rates"], queryFn: () => api<{ rates: FreightRate[] }>("/freight-rates"), staleTime: 60_000 });
}

export const freightTitle = (r: FreightRate) =>
  `${FREIGHT_TRANSPORTS[r.transport as keyof typeof FREIGHT_TRANSPORTS] ?? r.transport}${r.mode === "cbm" ? " сборный" : ` ${r.container ?? ""}`} · ${r.origin || "?"} — ${r.destination || "?"} · ${formatMoney(r.rate, r.currency)}${r.mode === "cbm" ? "/м³" : "/конт."}`;

export function FreightRatesPage() {
  const ai = useAiEnabled();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useFreightRates();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [pasting, setPasting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["freight-rates"] });

  return (
    <Content wide>
      <PageHeader
        title="Ставки доставки"
        meta="Для расчёта цены товара для клиента. Можно вставить переписку с перевозчиком — ИИ разберёт ставки."
        actions={
          <>
            {ai && (
              <button type="button" className="btn" onClick={() => setPasting(true)}>
                <IconSparkles /> Вставить из переписки
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ transport: "rail", mode: "container", container: "40HQ", currency: "USD", feeCurrency: "USD" })}>
              <IconPlus /> Ставка
            </button>
          </>
        }
      />
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.rates.length === 0 && <EmptyState title="Ставок пока нет">Добавьте ставку вручную или вставьте сообщение перевозчика.</EmptyState>}
      {data && data.rates.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <th className="px-3 py-2 font-medium">Маршрут</th>
                <th className="px-3 py-2 font-medium">Вид</th>
                <th className="px-3 py-2 text-right font-medium">Ставка</th>
                <th className="px-3 py-2 text-right font-medium">Сбор за отправку</th>
                <th className="px-3 py-2 font-medium">Срок / отправка</th>
                <th className="px-3 py-2 font-medium">Дата</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {data.rates.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.origin} — {r.destination}</div>
                    <div className="text-xs muted">{[r.carrierName, r.notes].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {FREIGHT_TRANSPORTS[r.transport as keyof typeof FREIGHT_TRANSPORTS] ?? r.transport}, {r.mode === "cbm" ? `сборный${r.kgPerCbm ? `, 1 м³ = ${r.kgPerCbm} кг` : ""}` : r.container}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatMoney(r.rate, r.currency)}
                    <span className="muted"> {FREIGHT_MODES[r.mode]}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.fee ? formatMoney(r.fee, r.feeCurrency) : "—"}</td>
                  <td className="px-3 py-2 text-xs">{[r.transitDays && `≈ ${r.transitDays} дн.`, r.etd].filter(Boolean).join(" · ")}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {formatDay(r.quotedAt)}
                    {r.validUntil && <span className="block muted">до {formatDay(r.validUntil)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button type="button" className="icon-btn" aria-label="Изменить" onClick={() => setEditing(r)}>
                      <IconPencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Удалить"
                      onClick={async () => {
                        if (!confirm("Удалить ставку?")) return;
                        await api(`/freight-rates/${r.id}`, { method: "DELETE" });
                        void refresh();
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RateDialog
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
      {pasting && (
        <PasteDialog
          onClose={() => setPasting(false)}
          onSaved={() => {
            setPasting(false);
            void refresh();
          }}
        />
      )}
    </Content>
  );
}

function RateFields({ draft, set }: { draft: Draft; set: (patch: Draft) => void }) {
  const num = (k: "rate" | "kgPerCbm" | "minCbm" | "fee" | "transitDays", label: string, hint = "") => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" inputMode="decimal" placeholder={hint} value={draft[k] ?? ""} onChange={(e) => set({ [k]: e.target.value === "" ? null : (e.target.value as unknown as number) })} />
    </label>
  );
  const text = (k: "origin" | "destination" | "carrierName" | "etd" | "notes", label: string, hint = "") => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" placeholder={hint} value={draft[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} />
    </label>
  );
  const currency = (k: "currency" | "feeCurrency", label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" value={draft[k] ?? "USD"} onChange={(e) => set({ [k]: e.target.value })}>
        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
      </select>
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {text("origin", "Откуда", "Сиань")}
      {text("destination", "Куда", "Москва")}
      <label className="block">
        <span className="label">Транспорт</span>
        <select className="input" value={draft.transport ?? "rail"} onChange={(e) => set({ transport: e.target.value })}>
          {Object.entries(FREIGHT_TRANSPORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Ставка</span>
        <select className="input" value={draft.mode === "cbm" ? "cbm" : (draft.container ?? "40HQ")} onChange={(e) => set(e.target.value === "cbm" ? { mode: "cbm", container: null } : { mode: "container", container: e.target.value })}>
          {Object.keys(CONTAINERS).map((c) => <option key={c} value={c}>за контейнер {c}</option>)}
          <option value="cbm">сборный груз, за м³</option>
        </select>
      </label>
      {num("rate", "Ставка", "250")}
      {currency("currency", "Валюта ставки")}
      {draft.mode === "cbm" && num("kgPerCbm", "1 м³ = сколько кг (вес/объём)", "500")}
      {draft.mode === "cbm" && num("minCbm", "Минимум, м³", "1")}
      {num("fee", "Сбор за отправку (H/F, CUS за BL)", "120")}
      {currency("feeCurrency", "Валюта сбора")}
      {num("transitDays", "Срок в пути, дней", "20")}
      {text("etd", "Отправка", "каждую пятницу")}
      {text("carrierName", "Перевозчик")}
      <label className="block">
        <span className="label">Дата ставки</span>
        <input type="date" className="input" value={draft.quotedAt ?? ""} onChange={(e) => set({ quotedAt: e.target.value || null })} />
      </label>
      <div className="sm:col-span-2">{text("notes", "Условия", "FOB станция, через Маньчжурию")}</div>
    </div>
  );
}

function RateDialog({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Draft>(draft);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal
      title={draft.id ? "Ставка доставки" : "Новая ставка"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              try {
                await api(draft.id ? `/freight-rates/${draft.id}` : "/freight-rates", { method: draft.id ? "PATCH" : "POST", body: form });
                onSaved();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <RateFields draft={form} set={(p) => setForm({ ...form, ...p })} />
      <ErrorBox error={error} />
    </Modal>
  );
}

function PasteDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const recognize = async () => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("text", text);
      for (const f of files) fd.append("file", f);
      const res = await api<{ rates: Draft[] }>("/ai/recognize-rates", { method: "POST", form: fd });
      setDrafts(res.rates);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const saveAll = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const d of drafts ?? []) await api("/freight-rates", { method: "POST", body: d });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Ставки из переписки"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          {drafts ? (
            <button type="button" className="btn btn-primary" disabled={busy || !drafts.length} onClick={() => void saveAll()}>
              {busy ? "Сохраняем…" : `Сохранить ставки (${drafts.length})`}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy || (!text.trim() && !files.length)} onClick={() => void recognize()}>
              <IconSparkles /> {busy ? "Разбираем…" : "Разобрать"}
            </button>
          )}
        </>
      }
    >
      {!drafts ? (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Текст сообщения перевозчика</span>
            <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="R/F: 250 USD/CBM (1CBM:500KG), H/F&CUS: 120 USD/BL, T/T about 25 days…" />
          </label>
          <label className="block">
            <span className="label">или скриншоты</span>
            <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.length === 0 && <p className="text-sm muted">Ставок не нашлось.</p>}
          {drafts.map((d, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-3 dark:border-neutral-800">
              <div className="mb-2 flex items-center">
                <span className="mr-auto text-sm font-medium">Ставка {i + 1}</span>
                <button type="button" className="icon-btn" aria-label="Убрать" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
                  <IconTrash size={14} />
                </button>
              </div>
              <RateFields draft={d} set={(p) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, ...p } : x)))} />
            </div>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
