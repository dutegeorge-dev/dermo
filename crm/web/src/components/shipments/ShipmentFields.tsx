/** Поля сделки в карточке: правятся на месте и сохраняются сами (списки и даты — сразу, текст — по уходу с поля). */

import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";

import { MESSENGERS } from "../../../../shared/deal-fields.ts";
import { formatMoney } from "../../../../shared/documents.ts";
import { SHIPMENT_FIELD_GROUPS, SHIPMENT_FIELDS, type ShipmentField, type ShipmentFieldSpec } from "../../../../shared/shipments.ts";
import { api } from "../../lib/api.ts";
import type { Contact, CounterpartyRole, ShipmentResponse } from "../../lib/types.ts";
import { useDirectory } from "../crm/common.tsx";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "../crm/CounterpartyPicker.tsx";
import { DealPicker } from "../crm/DealPicker.tsx";
import { counterpartyPath, formatDay, PaymentChip } from "../docs/common.tsx";
import { ContractsBlock, PartiesBlock } from "./ShipmentDocs.tsx";
import { CarrierInvoiceSelect } from "./ShipmentForm.tsx";

export type Save = (patch: Record<string, unknown>) => Promise<void>;
type Run = (fn: () => Promise<unknown>) => Promise<void>;

export function FieldInput({ field, value, save, disabled }: { field: ShipmentField; value: unknown; save: Save; disabled?: boolean }) {
  const spec: ShipmentFieldSpec = SHIPMENT_FIELDS[field];
  const users = useDirectory().data?.users ?? [];
  const initial = value === null || value === undefined ? "" : spec.kind === "number" ? String(value).replace(".", ",") : String(value);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);

  if (spec.kind === "enum") {
    return (
      <select className="input" disabled={disabled} value={initial} onChange={(e) => void save({ [field]: e.target.value || null })}>
        {field !== "scheme" && <option value="">—</option>}
        {Object.entries(spec.values ?? {}).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  }
  if (spec.kind === "user") {
    return (
      <select className="input" disabled={disabled} value={initial} onChange={(e) => void save({ [field]: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Не назначен</option>
        {users
          .filter((u) => u.isActive || String(u.id) === initial)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
      </select>
    );
  }
  if (spec.kind === "date") {
    return <input type="date" className="input" disabled={disabled} value={initial} onChange={(e) => void save({ [field]: e.target.value || null })} />;
  }
  if (spec.kind === "longtext") {
    return (
      <textarea
        className="input min-h-[60px]"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== initial && void save({ [field]: draft })}
      />
    );
  }
  return (
    <input
      className={`input ${field === "containerNo" || field === "hsCode" ? "font-mono" : ""} ${field === "containerNo" ? "uppercase" : ""}`}
      disabled={disabled}
      inputMode={spec.kind === "number" ? "decimal" : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== initial && void save({ [field]: draft.trim() || null })}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(initial);
      }}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

/** Контрагент: ссылка + «изменить» (поиск, можно завести нового). */
function PartyField({
  label,
  role,
  value,
  onSave,
  extra,
}: {
  label: string;
  role: CounterpartyRole;
  value: { id: number; name: string } | null;
  onSave: (id: number | null) => Promise<void>;
  extra?: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(value);
  return (
    <Row label={label}>
      {editing ? (
        <div className="space-y-1.5">
          <CounterpartyPicker role={role} value={picked} onChange={setPicked} autoFocus />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                const id = await ensureCounterparty(picked, role, extra);
                if (id !== (value?.id ?? null)) await onSave(id);
                setEditing(false);
              }}
            >
              OK
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Отмена
            </button>
            {value && (
              <button
                type="button"
                className="btn btn-ghost btn-sm ml-auto"
                onClick={async () => {
                  await onSave(null);
                  setEditing(false);
                }}
              >
                Убрать
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          {value ? (
            <Link to={counterpartyPath(role, value.id)} className="link min-w-0 truncate">
              {value.name}
            </Link>
          ) : (
            <span className="muted">не указан</span>
          )}
          <button
            type="button"
            className="ml-auto shrink-0 text-xs link"
            onClick={() => {
              setPicked(value);
              setEditing(true);
            }}
          >
            {value ? "изменить" : "указать"}
          </button>
        </div>
      )}
    </Row>
  );
}

function ContactLine({ data, save }: { data: ShipmentResponse; save: Save }) {
  const sh = data.shipment;
  const contacts = useQuery({
    queryKey: ["counterparty", sh.clientId],
    queryFn: () => api<{ contacts: Contact[] }>(`/counterparties/${sh.clientId}`),
    enabled: !!sh.clientId,
  });
  if (!sh.clientId) return null;
  const c = sh.contact;
  return (
    <div className="space-y-1 text-sm">
      {c && (
        <div>
          <div>{c.name}</div>
          {c.phone && (
            <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="link block">
              {c.phone}
            </a>
          )}
          {c.messenger && (
            <div className="text-xs muted">
              {MESSENGERS[c.messenger as keyof typeof MESSENGERS]}
              {c.messengerHandle ? `: ${c.messengerHandle}` : ""}
            </div>
          )}
        </div>
      )}
      {contacts.data && contacts.data.contacts.length > 0 && (
        <select className="input py-1 text-xs" value={sh.contactId ?? ""} onChange={(e) => void save({ contactId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{c ? "— убрать контакт —" : "Выбрать контакт клиента"}</option>
          {contacts.data.contacts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.phone ? ` · ${x.phone}` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ShipmentFields({ data, save, run }: { data: ShipmentResponse; save: Save; run: Run }) {
  const sh = data.shipment;
  const [dealEdit, setDealEdit] = useState(false);
  return (
    <div className="space-y-5">
      <section className="panel space-y-3 p-4">
        <PartyField label="Клиент" role="client" value={sh.client} onSave={(id) => save({ clientId: id })} />
        <ContactLine data={data} save={save} />
        <Row label="Менеджер">
          <FieldInput field="assigneeId" value={sh.assigneeId} save={save} />
        </Row>
        <Row label="Схема">
          <FieldInput field="scheme" value={sh.scheme} save={save} />
        </Row>
      </section>

      <section className="panel space-y-3 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide muted">Поставщик и перевозка</h3>
        <PartyField label="Поставщик" role="supplier" value={sh.supplier} onSave={(id) => save({ supplierId: id })} extra={{ kind: "foreign" }} />
        <PartyField label="Перевозчик" role="contractor" value={sh.carrier} onSave={(id) => save({ carrierId: id })} extra={{ contractorType: "carrier_cn" }} />
        <Row label="Инвойс перевозчика">
          <CarrierInvoiceSelect carrierId={sh.carrierId} value={sh.carrierInvoiceId} onChange={(id) => void save({ carrierInvoiceId: id })} />
          {sh.carrierInvoice && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Link to={`/documents/${sh.carrierInvoice.id}`} className="link">
                открыть{sh.carrierInvoice.date ? ` · от ${formatDay(sh.carrierInvoice.date)}` : ""}
              </Link>
              {sh.carrierInvoice.amount !== null && <span>{formatMoney(sh.carrierInvoice.amount, sh.carrierInvoice.currency)}</span>}
              <PaymentChip status={sh.carrierInvoice.paymentStatus} />
            </div>
          )}
        </Row>
        <Row label="Подрядчики">
          <PartiesBlock data={data} run={run} />
        </Row>
        <ContractsBlock data={data} save={save} />
      </section>

      {SHIPMENT_FIELD_GROUPS.map((g) => (
        <section key={g.title} className="panel space-y-3 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide muted">{g.title}</h3>
          {g.fields.map((f) => (
            <Row key={f} label={SHIPMENT_FIELDS[f].label}>
              <FieldInput field={f} value={(sh as Record<string, unknown>)[f]} save={save} />
            </Row>
          ))}
        </section>
      ))}

      <section className="panel space-y-3 p-4">
        <Row label="Лид из воронки продаж">
          {dealEdit ? (
            <DealPicker
              outcome="all"
              value={sh.deal ? { id: sh.deal.id, key: sh.deal.key, title: sh.deal.title } : null}
              onChange={(d) => {
                void save({ dealId: d?.id ?? null });
                if (d) setDealEdit(false);
              }}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm">
              {sh.deal ? (
                <Link to={`/deals/${sh.deal.key}`} className="link min-w-0 truncate">
                  <span className="font-mono text-xs">{sh.deal.key}</span> {sh.deal.title}
                </Link>
              ) : (
                <span className="muted">повторный заказ / без воронки</span>
              )}
              <button type="button" className="ml-auto shrink-0 text-xs link" onClick={() => setDealEdit(true)}>
                {sh.deal ? "изменить" : "связать"}
              </button>
            </div>
          )}
        </Row>
        <Row label="Заметки">
          <FieldInput field="notes" value={sh.notes} save={save} />
        </Row>
      </section>
    </div>
  );
}
