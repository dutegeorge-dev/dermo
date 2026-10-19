/**
 * «Ход сделки» — те же 7 этапов, что в ленте сверху, простыми словами:
 * пройденные — одной строкой (что случилось и когда), текущий — раскрыт
 * (что происходит, что сделать, чего ждём и к какой дате, кнопка «случилось»,
 * что будет дальше), будущие — с плановой датой.
 */

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { daysBetween, FLAGS, type FlagKey, MILESTONES, type MilestoneSpec, SHIPMENT_STAGES, type StageSpec } from "../../../../shared/shipments.ts";
import { api, apiDownload, BASE, errorMessage } from "../../lib/api.ts";
import type { ShipmentResponse } from "../../lib/types.ts";
import { formatDay, StatusChip } from "../docs/common.tsx";
import { IconCheck } from "../Icons.tsx";
import { OPEN_CALC_EVENT } from "./CalcBlock.tsx";
import { OPEN_SPEC_EVENT } from "./SpecBlock.tsx";
import { DueLabel, today, useShipmentActions } from "./common.tsx";

type SaveField = (patch: Record<string, unknown>) => Promise<void>;

const milestoneOf = (stage: StageSpec): MilestoneSpec | undefined => MILESTONES.find((m) => m.key === stage.milestone);

export function StageTimeline({ data, saveField }: { data: ShipmentResponse; saveField: SaveField }) {
  const shipment = data.shipment;
  const { milestone, flag, refresh } = useShipmentActions();
  const [shift, setShift] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const active = shipment.status === "active";
  const busy = milestone.isPending || flag.isPending;

  const setDate = async (key: string, body: { plan?: string | null; fact?: string | null }) => {
    setError(null);
    setNote(null);
    try {
      const r = await milestone.mutateAsync({ number: shipment.number, key, ...body, ...("plan" in body ? { shift } : {}) });
      if (r.shifted) setNote(`Следующие плановые даты сдвинуты (${r.shifted}).`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setFlag = async (key: string, done: boolean, date?: string, proof?: File | null) => {
    setError(null);
    try {
      await flag.mutateAsync({ number: shipment.number, key, done, date });
      if (proof) await uploadProof(key, proof);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const uploadProof = async (key: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    await api(`/shipments/${shipment.number}/flags/${key}/proof`, { method: "POST", form });
    refresh(shipment.number);
  };
  const ms = (key: string) => shipment.milestones[key] ?? { plan: null, fact: null };

  const planInput = (m: MilestoneSpec) => (
    <PlanInput value={ms(m.key).plan} disabled={!active || busy} onSave={(v) => void setDate(m.key, { plan: v })} />
  );
  const factNote = (m: MilestoneSpec) => <FactNote m={m} d={ms(m.key)} />;
  const flagItem = (k: FlagKey) => (
    <FlagItem
      key={k}
      k={k}
      doneDate={shipment.flags[k] ?? null}
      disabled={!active || busy}
      proofs={FLAGS[k].payment ? flagDocs(data, k).reduce((s, d) => s + (d.paymentFileCount ?? 0), 0) : null}
      canProof={flagDocs(data, k).length > 0}
      onToggle={(v, date, proof) => void setFlag(k, v, date, proof)}
      onProof={(file) => uploadProof(k, file).catch((e) => setError(errorMessage(e)))}
    />
  );

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Ход сделки</h2>
        {active && (
          <label className="flex items-center gap-2 text-xs muted" title="Например, задержали поезд на 5 дней — прибытие, выпуск и доставка сдвинутся сами">
            <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
            Перенос плановой даты сдвигает и следующие
          </label>
        )}
      </div>
      <ol>
        {SHIPMENT_STAGES.map((st) => {
          const m = milestoneOf(st);
          const isLast = st.no === SHIPMENT_STAGES.length;
          const done = st.no < shipment.stage || (isLast && shipment.stage === st.no && shipment.status === "closed");
          const current = st.no === shipment.stage && !done;
          const next = SHIPMENT_STAGES[st.no];
          const marks = MILESTONES.filter((x) => x.optional && x.stage === st.no);
          const openFlags = st.flags.filter((k) => !shipment.flags[k]);
          const dot = (
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                done ? "text-white" : current ? "text-white" : "border border-slate-300 text-slate-400 dark:border-neutral-600"
              }`}
              style={done || current ? { background: st.color } : undefined}
            >
              {done ? <IconCheck size={13} /> : st.no}
            </span>
          );

          if (current) {
            return (
              <li key={st.no} className="border-y border-slate-200 bg-slate-50/80 px-4 py-4 dark:border-neutral-800 dark:bg-neutral-800/40" style={{ boxShadow: `inset 3px 0 0 ${st.color}` }}>
                <div className="flex gap-3">
                  {dot}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide muted">Сейчас</div>
                      <div className="text-base font-semibold">
                        {st.no}. {st.name}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-700 dark:text-neutral-300">{st.doing}</p>
                    </div>

                    {st.no === 1 && (
                      <OrderChecklist data={data} />
                    )}
                    {(st.no === 4 || st.no === 5) && <AfterLoading data={data} />}
                    {st.no === 6 && <CustomsPack number={shipment.number} />}

                    {(st.flags.length > 0 || st.no === 3) && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold muted">Что нужно сделать</div>
                        {st.flags.map((k) => flagItem(k))}
                        {st.no === 3 && <ContainerItem containerNo={shipment.containerNo} disabled={!active} onSave={(v) => void saveField({ containerNo: v })} />}
                      </div>
                    )}

                    {marks.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold muted">Отметки в пути (необязательно)</div>
                        {marks.map((x) => (
                          <div key={x.key} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="w-28">{x.label}</span>
                            {ms(x.key).fact ? (
                              <>
                                {factNote(x)}
                                {active && (
                                  <button type="button" className="text-xs link" onClick={() => void setDate(x.key, { fact: null })}>
                                    снять
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-xs muted">план</span>
                                {planInput(x)}
                                <button type="button" className="btn btn-sm" disabled={!active || busy} onClick={() => void setDate(x.key, { fact: today() })}>
                                  {x.done} сегодня
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {m && (
                      <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold">Ждём: {m.event.toLowerCase()}</span>
                          <span className="text-xs muted">план</span>
                          {planInput(m)}
                          <DueLabel date={ms(m.key).plan} />
                        </div>
                        <DoneControl m={m} disabled={!active || busy} onDone={(date) => void setDate(m.key, { fact: date })} />
                        {openFlags.length > 0 && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Не отмечено: {openFlags.map((k) => FLAGS[k].label.toLowerCase()).join(", ")} — проверьте перед тем, как двигаться дальше.
                          </p>
                        )}
                      </div>
                    )}

                    {next && (
                      <p className="text-sm muted">
                        Дальше → <span className="font-medium text-slate-700 dark:text-neutral-200">{next.no}. {next.name}</span>: {next.doing.charAt(0).toLowerCase() + next.doing.slice(1)}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          }

          if (done) {
            const missed = st.flags.filter((k) => !shipment.flags[k]);
            const expanded = open === st.no;
            return (
              <li key={st.no} className="px-4 py-2.5">
                <div className="flex gap-3">
                  {dot}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-sm muted">
                        {st.no}. {st.name}
                      </span>
                      {m ? factNote(m) : <span className="text-sm font-medium">Сделка закрыта</span>}
                      {st.flags
                        .filter((k) => shipment.flags[k])
                        .map((k) => (
                          <span key={k} className="text-xs text-green-700 dark:text-green-400">
                            ✓ {FLAGS[k].done.toLowerCase()}
                          </span>
                        ))}
                      {m && active && (
                        <button type="button" className="ml-auto text-xs link" onClick={() => setOpen(expanded ? null : st.no)}>
                          {expanded ? "скрыть" : "изменить"}
                        </button>
                      )}
                    </div>
                    {missed.length > 0 && (
                      <div className="mt-1 space-y-1 rounded-md bg-red-50 px-2 py-1.5 dark:bg-red-950/30">
                        <div className="text-xs font-medium text-red-700 dark:text-red-300">Этап пройден, но не отмечено:</div>
                        {missed.map((k) => flagItem(k))}
                      </div>
                    )}
                    {expanded && m && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-xs muted">план</span>
                        {planInput(m)}
                        <span className="text-xs muted">факт</span>
                        <input
                          type="date"
                          className="input w-36 py-1"
                          defaultValue={ms(m.key).fact ?? ""}
                          key={`f-${m.key}-${ms(m.key).fact}`}
                          onBlur={(e) => e.target.value && e.target.value !== ms(m.key).fact && void setDate(m.key, { fact: e.target.value })}
                        />
                        <button type="button" className="btn btn-sm" onClick={() => void setDate(m.key, { fact: null })} title="Вернёт сделку на этот этап">
                          Снять отметку
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          }

          // Будущий этап: что будет и плановая дата.
          return (
            <li key={st.no} className="px-4 py-2.5">
              <div className="flex gap-3">
                {dot}
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm text-slate-500 dark:text-neutral-400">
                    {st.no}. {st.name}
                  </span>
                  {m && (
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-xs muted">{m.event.toLowerCase()} — план</span>
                      {planInput(m)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {(error || note) && <p className={`px-4 pb-3 text-sm ${error ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{error ?? note}</p>}
    </section>
  );
}

function PlanInput({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string | null) => void }) {
  return (
    <input
      type="date"
      className="input w-36 py-1"
      disabled={disabled}
      defaultValue={value ?? ""}
      key={value ?? ""}
      onBlur={(e) => {
        const v = e.target.value || null;
        if (v !== value) onSave(v);
      }}
    />
  );
}

/** «Случилось»: сегодня одной кнопкой или другой датой. */
function DoneControl({ m, disabled, onDone }: { m: MilestoneSpec; disabled: boolean; onDone: (date: string) => void }) {
  const [date, setDate] = useState(today());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onDone(today())}>
        <IconCheck size={14} /> {m.done} — сегодня
      </button>
      <span className="text-xs muted">или</span>
      <input type="date" className="input w-36 py-1" value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="button" className="btn btn-sm" disabled={disabled || !date} onClick={() => onDone(date)}>
        Отметить этой датой
      </button>
    </div>
  );
}

/** Когда случилось — и насколько против плана. */
function FactNote({ m, d }: { m: MilestoneSpec; d: { plan: string | null; fact: string | null } }) {
  if (!d.fact) return null;
  const late = d.plan ? daysBetween(d.plan, d.fact) : 0;
  return (
    <span className="text-sm">
      <span className="font-medium">{m.done}</span> {formatDay(d.fact)}
      {late > 0 && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">на {late} дн. позже плана</span>}
      {late < 0 && <span className="ml-1 text-xs text-green-700 dark:text-green-400">на {-late} дн. раньше плана</span>}
    </span>
  );
}

/** Документы сделки, оплату которых означает галочка (как на сервере — lib/payments.ts). */
function flagDocs(data: ShipmentResponse, k: FlagKey) {
  const sh = data.shipment;
  if (k === "balance") return data.documents.filter((d) => d.type === "supplier_invoice" && d.shipmentId === sh.id);
  if (k === "customs_payment") return data.documents.filter((d) => d.type === "customs_declaration");
  if (k === "freight") return data.documents.filter((d) => d.type === "contractor_invoice" && (d.id === sh.carrierInvoiceId || d.counterpartyId === sh.carrierId || (d.contractorType ?? "").startsWith("carrier")));
  return [];
}

/**
 * Флажок ожидания. Оплаты: отметка — с датой и, по желанию, платёжкой (прикрепится к инвойсу / счёту / ДТ,
 * который при этом станет «Оплачен»); после отметки — «+ платёжка», если её ещё нет.
 */
function FlagItem({
  k,
  doneDate,
  disabled,
  proofs,
  canProof,
  onToggle,
  onProof,
}: {
  k: FlagKey;
  doneDate: string | null;
  disabled: boolean;
  /** null — не оплата; число — сколько платёжек приложено. */
  proofs: number | null;
  /** Есть документ (инвойс / счёт / ДТ), к которому прикрепить платёжку. */
  canProof: boolean;
  onToggle: (done: boolean, date?: string, proof?: File | null) => void;
  onProof: (file: File) => void;
}) {
  const done = Boolean(doneDate);
  const [asking, setAsking] = useState(false);
  const [date, setDate] = useState(today());
  const [proof, setProof] = useState<File | null>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const isPayment = proofs !== null;
  return (
    <div className="text-sm">
      <div className={`flex flex-wrap items-center gap-x-2 ${done ? "" : "font-medium"}`}>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={done || asking}
          disabled={disabled}
          aria-label={FLAGS[k].todo}
          onChange={(e) => {
            if (!e.target.checked) {
              setAsking(false);
              if (done) onToggle(false);
            } else if (isPayment) setAsking(true);
            else onToggle(true);
          }}
        />
        <span className={done ? "muted line-through" : ""}>{FLAGS[k].todo}</span>
        {done && (
          <span className="text-xs text-green-700 dark:text-green-400">
            {FLAGS[k].done.toLowerCase()} {formatDay(doneDate)}
          </span>
        )}
        {done && isPayment && canProof && (
          proofs ? (
            <span className="text-xs text-sky-700 dark:text-sky-400">платёжка ✓</span>
          ) : (
            <>
              <button type="button" className="text-xs link" disabled={disabled} onClick={() => proofRef.current?.click()}>
                + платёжка
              </button>
              <input
                ref={proofRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onProof(f);
                }}
              />
            </>
          )
        )}
      </div>
      {asking && !done && (
        <div className="ml-6 mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2 dark:bg-neutral-800/40">
          <span className="text-xs muted">Дата оплаты</span>
          <input type="date" className="input w-auto py-1" value={date} onChange={(e) => setDate(e.target.value)} />
          {canProof && (
            <label className="btn btn-sm cursor-pointer">
              {proof ? `платёжка: ${proof.name.slice(0, 24)}` : "Платёжка (необязательно)"}
              <input type="file" className="hidden" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={disabled}
            onClick={() => {
              onToggle(true, date, proof);
              setAsking(false);
              setProof(null);
            }}
          >
            Отметить оплату
          </button>
          <button type="button" className="text-xs link" onClick={() => setAsking(false)}>
            отмена
          </button>
          <span className="basis-full text-[11px] muted">
            {canProof ? "Инвойс / счёт этой оплаты станет «Оплачен», платёжка прикрепится к нему." : "Инвойс / счёт загрузите позже — он сразу будет «Оплачен» этой датой."}
          </span>
        </div>
      )}
    </div>
  );
}

function ContainerItem({ containerNo, disabled, onSave }: { containerNo: string | null; disabled: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = useState("");
  if (containerNo) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked readOnly />
        <span className="muted line-through">Указать номер контейнера</span>
        <span className="font-mono text-xs">{containerNo}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4" checked={false} readOnly />
      <span className="font-medium">Указать номер контейнера</span>
      <span className="text-xs muted">— без него погрузку не отметить</span>
      <input className="input w-40 py-1 font-mono uppercase" placeholder="TGHU1234567" value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} />
      <button type="button" className="btn btn-sm" disabled={!value.trim() || disabled} onClick={() => onSave(value)}>
        Сохранить
      </button>
    </div>
  );
}

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${done ? "" : "font-medium"}`}>
      <input type="checkbox" className="h-4 w-4" checked={done} readOnly />
      {children}
    </div>
  );
}

/** Этап 1: инвойс поставщика → поручение клиенту → подписанное поручение (до оплаты депозита). */
function OrderChecklist({ data }: { data: ShipmentResponse }) {
  const sh = data.shipment;
  const invoices = data.documents.filter((d) => d.type === "supplier_invoice");
  const order = data.documents.find((d) => d.id === data.finance.orderId);
  const commission = sh.scheme === "commission";
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold muted">Что нужно сделать</div>
      <Check done={invoices.length > 0}>
        <span className={invoices.length ? "muted line-through" : ""}>Загрузить инвойс поставщика</span>
        {invoices.map((d) => (
          <Link key={d.id} to={`/documents/${d.id}`} className="text-xs link">
            № {d.number ?? "б/н"}
          </Link>
        ))}
        {invoices.length === 0 && (
          <Link to={`/documents/new?type=supplier_invoice&shipment=${sh.number}`} className="btn btn-sm">
            + Инвойс поставщика
          </Link>
        )}
      </Check>
      {commission ? (
        <>
          <Check done={Boolean(order)}>
            <span className={order ? "muted line-through" : ""}>Сформировать поручение и отправить клиенту</span>
            {order ? (
              <>
                <Link to={`/documents/${order.id}`} className="text-xs link">
                  Поручение № {order.number}
                </Link>
                <a className="btn btn-sm" href={`${BASE}/api/documents/${order.id}/docx`}>
                  DOCX
                </a>
              </>
            ) : (
              <a
                href="#calc"
                className={`btn btn-primary btn-sm ${invoices.length === 0 ? "pointer-events-none opacity-50" : ""}`}
                title={invoices.length === 0 ? "Сначала загрузите инвойс поставщика — товары и суммы берутся из него" : "Перевозка, пошлина, КП и поручение — в блоке «Расчёт для клиента»"}
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new Event(OPEN_CALC_EVENT));
                  setTimeout(() => document.getElementById("calc")?.scrollIntoView({ behavior: "smooth" }), 50);
                }}
              >
                Рассчитать и сформировать ↓
              </a>
            )}
          </Check>
          <Check done={order?.status === "signed"}>
            <span className={order?.status === "signed" ? "muted line-through" : ""}>Получить подписанное поручение</span>
            {order && <StatusChip status={order.status} />}
            {order && order.status !== "signed" && (
              <Link to={`/documents/${order.id}`} className="text-xs link">
                загрузить скан
              </Link>
            )}
          </Check>
        </>
      ) : (
        <p className="text-xs muted">Схема «{sh.scheme === "teu" ? "ТЭУ" : "Поставка"}» — поручение не нужно; документы для клиента — в блоке «Документы».</p>
      )}
    </div>
  );
}

function openBlock(event: string, id: string) {
  window.dispatchEvent(new Event(event));
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 50);
}

/** После погрузки: упаковочный лист → спецификация для перевозчика. */
function AfterLoading({ data }: { data: ShipmentResponse }) {
  const sh = data.shipment;
  const packing = data.documents.filter((d) => d.type === "packing_list");
  const spec = data.documents.find((d) => d.type === "carrier_spec");
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold muted">Документы после погрузки</div>
      <Check done={packing.length > 0}>
        <span className={packing.length ? "muted line-through" : ""}>Загрузить упаковочный лист</span>
        {packing.map((d) => (
          <Link key={d.id} to={`/documents/${d.id}`} className="text-xs link">
            № {d.number ?? "б/н"}
          </Link>
        ))}
        {!packing.length && (
          <Link to={`/documents/new?type=packing_list&shipment=${sh.number}`} className="btn btn-sm">
            + Упаковочный лист
          </Link>
        )}
      </Check>
      <Check done={Boolean(spec)}>
        <span className={spec ? "muted line-through" : ""}>Заполнить спецификацию для перевозчика</span>
        <a href="#spec" className="btn btn-sm" onClick={(e) => { e.preventDefault(); openBlock(OPEN_SPEC_EVENT, "spec"); }}>
          {spec ? "Открыть" : "Заполнить ↓"}
        </a>
      </Check>
    </div>
  );
}

/** На таможне: пакет документов (ZIP) и чего в нём не хватает. */
function CustomsPack({ number }: { number: number }) {
  const q = useQuery({ queryKey: ["customs-pack", number], queryFn: () => api<{ files: number; missing: string[] }>(`/shipments/${number}/customs-pack`) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold muted">Документы для таможни</div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !q.data?.files}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await apiDownload(`/shipments/${number}/customs-pack.zip`);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Собираем…" : "Сформировать документы для таможни (ZIP)"}
        </button>
        {q.data && <span className="text-xs muted">файлов: {q.data.files}</span>}
      </div>
      <p className="text-xs muted">Контракт, инвойсы поставщика и перевозчика с документами об оплате, упаковочные листы, спецификация, накладные, сертификаты на товары — по папкам, с описью.</p>
      {q.data && q.data.missing.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-400">
          {q.data.missing.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
