/** Поля сделки: стороны, контейнер, перевозчик и его инвойс, маршрут. */

import { useQuery } from "@tanstack/react-query";

import { formatMoney } from "../../../../shared/documents.ts";
import { TRANSPORTS } from "../../../../shared/shipments.ts";
import { api } from "../../lib/api.ts";
import type { DocumentRow, Shipment } from "../../lib/types.ts";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "../crm/CounterpartyPicker.tsx";
import { DealPicker, type PickedDeal } from "../crm/DealPicker.tsx";
import { formatDay } from "../docs/common.tsx";

export type ShipmentFormState = {
  client: Picked | null;
  supplier: Picked | null;
  carrier: Picked | null;
  carrierInvoiceId: number | null;
  deal: PickedDeal | null;
  containerNo: string;
  cargo: string;
  transport: string;
  route: string;
  depositDate: string;
  notes: string;
};

export function emptyForm(): ShipmentFormState {
  return {
    client: null,
    supplier: null,
    carrier: null,
    carrierInvoiceId: null,
    deal: null,
    containerNo: "",
    cargo: "",
    transport: "rail",
    route: "",
    depositDate: "",
    notes: "",
  };
}

export function formFromShipment(s: Shipment): ShipmentFormState {
  return {
    client: s.client,
    supplier: s.supplier,
    carrier: s.carrier,
    carrierInvoiceId: s.carrierInvoice?.id ?? null,
    deal: s.deal,
    containerNo: s.containerNo ?? "",
    cargo: s.cargo,
    transport: s.transport ?? "",
    route: s.route ?? "",
    depositDate: s.depositDate ?? "",
    notes: s.notes,
  };
}

/** Тело запроса; новые контрагенты создаются по пути. */
export async function formPayload(f: ShipmentFormState): Promise<Record<string, unknown>> {
  const [clientId, supplierId, carrierId] = await Promise.all([
    ensureCounterparty(f.client, "client"),
    ensureCounterparty(f.supplier, "supplier", { kind: "foreign" }),
    ensureCounterparty(f.carrier, "contractor", { contractorType: "carrier_cn" }),
  ]);
  return {
    clientId,
    supplierId,
    carrierId,
    carrierInvoiceId: carrierId && f.carrierInvoiceId ? f.carrierInvoiceId : null,
    dealId: f.deal?.id ?? null,
    containerNo: f.containerNo,
    cargo: f.cargo,
    transport: f.transport || null,
    route: f.route,
    depositDate: f.depositDate || null,
    notes: f.notes,
  };
}

function CarrierInvoiceSelect({ carrierId, value, onChange }: { carrierId: number | null; value: number | null; onChange: (id: number | null) => void }) {
  const { data } = useQuery({
    queryKey: ["documents", "carrier-invoices", carrierId],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?type=contractor_invoice&counterparty=${carrierId}&limit=100`),
    enabled: Boolean(carrierId),
  });
  if (!carrierId) return <p className="py-1.5 text-xs muted">Сначала выберите перевозчика</p>;
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">— не выбран —</option>
      {data?.documents.map((d) => (
        <option key={d.id} value={d.id}>
          № {d.number ?? "б/н"}
          {d.date ? ` от ${formatDay(d.date)}` : ""}
          {d.amount !== null ? ` · ${formatMoney(d.amount, d.currency)}` : ""}
          {d.clientName ? ` · ${d.clientName}` : ""}
        </option>
      ))}
    </select>
  );
}

export function ShipmentForm({ value, onChange }: { value: ShipmentFormState; onChange: (v: ShipmentFormState) => void }) {
  const set = <K extends keyof ShipmentFormState>(k: K, v: ShipmentFormState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="label">Клиент</span>
        <CounterpartyPicker role="client" value={value.client} onChange={(v) => set("client", v)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Груз</span>
        <input className="input" value={value.cargo} onChange={(e) => set("cargo", e.target.value)} placeholder="Что везём: искусственная трава, 2 400 м²" />
      </label>
      <label className="block">
        <span className="label">Поставщик</span>
        <CounterpartyPicker role="supplier" value={value.supplier} onChange={(v) => set("supplier", v)} />
      </label>
      <label className="block">
        <span className="label">Депозит оплачен</span>
        <input type="date" className="input" value={value.depositDate} onChange={(e) => set("depositDate", e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Номер контейнера</span>
        <input
          className="input font-mono uppercase"
          value={value.containerNo}
          onChange={(e) => set("containerNo", e.target.value)}
          placeholder="TGHU1234567"
          maxLength={20}
        />
        <span className="mt-0.5 block text-[11px] muted">Обязателен к моменту погрузки</span>
      </label>
      <label className="block">
        <span className="label">Транспорт</span>
        <select className="input" value={value.transport} onChange={(e) => set("transport", e.target.value)}>
          <option value="">—</option>
          {Object.entries(TRANSPORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Перевозчик</span>
        <CounterpartyPicker
          role="contractor"
          value={value.carrier}
          onChange={(v) => onChange({ ...value, carrier: v, carrierInvoiceId: v?.id === value.carrier?.id ? value.carrierInvoiceId : null })}
        />
      </label>
      <label className="block">
        <span className="label">Инвойс перевозчика</span>
        <CarrierInvoiceSelect carrierId={value.carrier?.id ?? null} value={value.carrierInvoiceId} onChange={(id) => set("carrierInvoiceId", id)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Маршрут</span>
        <input className="input" value={value.route} onChange={(e) => set("route", e.target.value)} placeholder="Гуанчжоу → Забайкальск → Москва" />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Лид из воронки продаж (необязательно)</span>
        <DealPicker outcome="all" value={value.deal} onChange={(d) => set("deal", d)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Заметки</span>
        <textarea className="input min-h-[60px]" value={value.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
    </div>
  );
}
