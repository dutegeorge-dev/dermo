/** Чтение сделок (отгрузок) списком: все поля, имена сторон, ключевые даты. */

import { type SQL, sql } from "drizzle-orm";

import { FLAG_KEYS, FLAGS, MILESTONE_KEYS, type Milestones, shipmentLabel, stageSpec } from "../../shared/shipments.ts";
import type { DbOrTx } from "../db/client.ts";

type Row = Record<string, unknown> & {
  id: number;
  number: number;
  stage: number;
  flags: Record<string, string> | null;
  milestones: Record<string, { plan: string | null; fact: string | null }> | null;
};

function listSql(where: SQL) {
  return sql`
    SELECT s.id, s.number, s.title, s.status, s.stage, s.scheme,
           s.client_id, cl.name AS client_name, s.contact_id, ct.name AS contact_name, ct.phone AS contact_phone,
           ct.messenger::text AS contact_messenger, ct.messenger_handle AS contact_messenger_handle, ct.email AS contact_email,
           s.supplier_id, sp.name AS supplier_name, s.carrier_id, cr.name AS carrier_name,
           s.carrier_invoice_id, inv.number AS carrier_invoice_number, inv.date::text AS carrier_invoice_date,
           inv.amount::float8 AS carrier_invoice_amount, inv.currency AS carrier_invoice_currency,
           inv.payment_status::text AS carrier_invoice_payment,
           s.client_contract_id, s.supplier_contract_id,
           s.deal_id, d.key AS deal_key, d.title AS deal_title,
           s.assignee_id, u.name AS assignee_name,
           s.container_no, s.hs_code, s.weight_kg::float8 AS weight_kg, s.volume_m3::float8 AS volume_m3,
           s.transport, s.pickup_location, s.delivery_location, s.deposit_date::text AS deposit_date,
           s.export_license::text AS export_license, s.certificates::text AS certificates, s.certificate_holder,
           s.chestny_znak::text AS chestny_znak, s.flags, s.notes,
           s.created_at, s.updated_at, s.closed_at,
           (SELECT json_object_agg(m.key, json_build_object('plan', m.plan::text, 'fact', m.fact::text))
              FROM shipment_milestones m WHERE m.shipment_id = s.id) AS milestones,
           (SELECT count(*)::int FROM documents x WHERE x.shipment_id = s.id) AS document_count
    FROM shipments s
    LEFT JOIN counterparties cl ON cl.id = s.client_id
    LEFT JOIN contacts ct ON ct.id = s.contact_id
    LEFT JOIN counterparties sp ON sp.id = s.supplier_id
    LEFT JOIN counterparties cr ON cr.id = s.carrier_id
    LEFT JOIN documents inv ON inv.id = s.carrier_invoice_id
    LEFT JOIN deals d ON d.id = s.deal_id
    LEFT JOIN users u ON u.id = s.assignee_id
    WHERE ${where}
    ORDER BY s.number DESC`;
}

const ref = (id: unknown, name: unknown) => (id ? { id: Number(id), name: String(name ?? "") } : null);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function toShipment(r: Row) {
  const milestones: Milestones = {};
  for (const key of MILESTONE_KEYS) milestones[key] = r.milestones?.[key] ?? { plan: null, fact: null };
  const stage = stageSpec(Number(r.stage));
  const keyMilestone = stage.milestone ? milestones[stage.milestone]! : null;
  const flags = r.flags ?? {};
  return {
    id: Number(r.id),
    number: Number(r.number),
    label: shipmentLabel(Number(r.number)),
    title: String(r.title ?? ""),
    status: String(r.status) as "active" | "closed" | "cancelled",
    stage: Number(r.stage),
    scheme: String(r.scheme),
    // Значения полей (для правки) …
    clientId: r.client_id ? Number(r.client_id) : null,
    contactId: r.contact_id ? Number(r.contact_id) : null,
    supplierId: r.supplier_id ? Number(r.supplier_id) : null,
    carrierId: r.carrier_id ? Number(r.carrier_id) : null,
    carrierInvoiceId: r.carrier_invoice_id ? Number(r.carrier_invoice_id) : null,
    clientContractId: r.client_contract_id ? Number(r.client_contract_id) : null,
    supplierContractId: r.supplier_contract_id ? Number(r.supplier_contract_id) : null,
    dealId: r.deal_id ? Number(r.deal_id) : null,
    assigneeId: r.assignee_id ? Number(r.assignee_id) : null,
    containerNo: str(r.container_no),
    hsCode: str(r.hs_code),
    weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
    volumeM3: r.volume_m3 === null ? null : Number(r.volume_m3),
    transport: str(r.transport),
    pickupLocation: str(r.pickup_location),
    deliveryLocation: str(r.delivery_location),
    depositDate: str(r.deposit_date),
    exportLicense: str(r.export_license),
    certificates: str(r.certificates),
    certificateHolder: str(r.certificate_holder),
    chestnyZnak: str(r.chestny_znak),
    notes: String(r.notes ?? ""),
    // … и подписи к ним.
    client: ref(r.client_id, r.client_name),
    contact: r.contact_id
      ? {
          id: Number(r.contact_id),
          name: String(r.contact_name ?? ""),
          phone: str(r.contact_phone),
          messenger: str(r.contact_messenger),
          messengerHandle: str(r.contact_messenger_handle),
          email: str(r.contact_email),
        }
      : null,
    supplier: ref(r.supplier_id, r.supplier_name),
    carrier: ref(r.carrier_id, r.carrier_name),
    assignee: ref(r.assignee_id, r.assignee_name),
    carrierInvoice: r.carrier_invoice_id
      ? {
          id: Number(r.carrier_invoice_id),
          number: str(r.carrier_invoice_number),
          date: str(r.carrier_invoice_date),
          amount: r.carrier_invoice_amount === null ? null : Number(r.carrier_invoice_amount),
          currency: str(r.carrier_invoice_currency),
          paymentStatus: str(r.carrier_invoice_payment),
        }
      : null,
    deal: r.deal_id ? { id: Number(r.deal_id), key: String(r.deal_key), title: String(r.deal_title) } : null,
    flags,
    documentCount: Number(r.document_count ?? 0),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    closedAt: (r.closed_at as string | null) ?? null,
    milestones,
    /** Плановая дата текущего этапа — «когда следующий шаг». */
    nextDate: keyMilestone?.plan ?? null,
    /** Неотмеченные флажки текущего и пройденных этапов. */
    pendingFlags: FLAG_KEYS.filter((k) => !flags[k] && FLAGS[k].stage <= Number(r.stage)),
  };
}
export type ShipmentDto = ReturnType<typeof toShipment>;

export async function listShipments(tx: DbOrTx, where: SQL): Promise<ShipmentDto[]> {
  const result = await tx.execute<Row>(listSql(where));
  return result.rows.map(toShipment);
}

export async function getShipmentDto(tx: DbOrTx, id: number): Promise<ShipmentDto> {
  const [dto] = await listShipments(tx, sql`s.id = ${id}`);
  return dto;
}
