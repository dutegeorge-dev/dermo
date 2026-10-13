/** Форма новой сделки: название груза, стороны, схема, контейнер, маршрут. Остальное — в карточке. */

import { useQuery } from "@tanstack/react-query";

import { formatMoney } from "../../../../shared/documents.ts";
import { SCHEME_LABELS, TRANSPORTS } from "../../../../shared/shipments.ts";
import { api } from "../../lib/api.ts";
import type { DocumentRow } from "../../lib/types.ts";
import { CounterpartyPicker, ensureCounterparty, type Picked } from "../crm/CounterpartyPicker.tsx";
import { DealPicker, type PickedDeal } from "../crm/DealPicker.tsx";
import { formatDay } from "../docs/common.tsx";

export type ShipmentFormState = {
  title: string;
  scheme: keyof typeof SCHEME_LABELS;
  client: Picked | null;
  supplier: Picked | null;
  carrier: Picked | null;
  deal: PickedDeal | null;
  containerNo: string;
  transport: string;
  pickupLocation: string;
  deliveryLocation: string;
  depositDate: string;
};

export function emptyForm(): ShipmentFormState {
  return {
    title: "",
    scheme: "commission",
    client: null,
    supplier: null,
    carrier: null,
    deal: null,
    containerNo: "",
    transport: "rail",
    pickupLocation: "",
    deliveryLocation: "",
    depositDate: "",
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
    title: f.title,
    scheme: f.scheme,
    clientId,
    supplierId,
    carrierId,
    dealId: f.deal?.id ?? null,
    containerNo: f.containerNo,
    transport: f.transport || null,
    pickupLocation: f.pickupLocation,
    deliveryLocation: f.deliveryLocation,
    depositDate: f.depositDate || null,
  };
}

/** Инвойсы выбранного перевозчика — для поля «Инвойс перевозчика». */
export function CarrierInvoiceSelect({ carrierId, value, onChange }: { carrierId: number | null; value: number | null; onChange: (id: number | null) => void }) {
  const { data } = useQuery({
    queryKey: ["documents", "carrier-invoices", carrierId],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?type=contractor_invoice&counterparty=${carrierId}&limit=100`),
    enabled: Boolean(carrierId),
  });
  if (!carrierId) return <p className="py-1.5 text-xs muted">Сначала выберите перевозчика</p>;
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{data?.documents.length === 0 ? "нет счетов — загрузите" : "— не выбран —"}</option>
      {data?.documents.map((d) => (
        <option key={d.id} value={d.id}>
          № {d.number ?? "б/н"}
          {d.date ? ` от ${formatDay(d.date)}` : ""}
          {d.amount !== null ? ` · ${formatMoney(d.amount, d.currency)}` : ""}
          {d.shipmentTitle ? ` · ${d.shipmentTitle}` : d.clientName ? ` · ${d.clientName}` : ""}
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
        <span className="label">Название груза — как вы его называете</span>
        <input className="input text-base font-medium" autoFocus value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="Линолеум коричневый" />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Клиент</span>
        <CounterpartyPicker role="client" value={value.client} onChange={(v) => set("client", v)} />
      </label>
      <label className="block">
        <span className="label">Поставщик</span>
        <CounterpartyPicker role="supplier" value={value.supplier} onChange={(v) => set("supplier", v)} />
      </label>
      <label className="block">
        <span className="label">Схема</span>
        <select className="input" value={value.scheme} onChange={(e) => set("scheme", e.target.value as ShipmentFormState["scheme"])}>
          {Object.entries(SCHEME_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Депозит оплачен</span>
        <input type="date" className="input" value={value.depositDate} onChange={(e) => set("depositDate", e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Номер контейнера</span>
        <input className="input font-mono uppercase" value={value.containerNo} onChange={(e) => set("containerNo", e.target.value)} placeholder="TGHU1234567" maxLength={20} />
        <span className="mt-0.5 block text-[11px] muted">Обязателен к моменту погрузки</span>
      </label>
      <label className="block">
        <span className="label">Перевозчик</span>
        <CounterpartyPicker role="contractor" value={value.carrier} onChange={(v) => set("carrier", v)} />
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
        <span className="label">Откуда (Китай)</span>
        <input className="input" value={value.pickupLocation} onChange={(e) => set("pickupLocation", e.target.value)} placeholder="Shijiazhuang" />
      </label>
      <label className="block">
        <span className="label">Куда доставить</span>
        <input className="input" value={value.deliveryLocation} onChange={(e) => set("deliveryLocation", e.target.value)} placeholder="Москва (Селятино)" />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Лид из воронки продаж (необязательно)</span>
        <DealPicker outcome="all" value={value.deal} onChange={(d) => set("deal", d)} />
      </label>
    </div>
  );
}
