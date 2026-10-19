/** ИИ-разбор документа: черновик формы (сервер: server/lib/ai-parse.ts, интерфейс: DocumentEditor). */

import type { DocType } from "./documents.ts";

/** Черновик для формы документа (web: DocumentEditor). */
export type DocumentDraft = {
  type: DocType;
  number: string | null;
  date: string | null;
  currency: string | null;
  amount: number | null;
  /** id: null — новый контрагент; newCounterparty — его реквизиты из документа. */
  counterparty: { id: number | null; name: string } | null;
  newCounterparty: Record<string, string> | null;
  client: { id: number; name: string } | null;
  parentId: number | null;
  contractNumber: string | null;
  shipment: { id: number; number: number; title: string; containerNo: string | null; weightKg: number | null } | null;
  shipmentReason: string | null;
  cargoTitle: string | null;
  containerNo: string | null;
  weightKg: number | null;
  incoterms: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  costCategory: string | null;
  /** productId — товар нашёлся в справочнике; hsAuto — код ТН ВЭД подобран ИИ (проверить); tariff — ставка пошлины. */
  items: {
    productId: number | null;
    name: string;
    batchNo: null;
    hsCode: string | null;
    hsAuto: boolean;
    tariff?: string | null;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    amount: number | null;
  }[];
  summary: string;
  warnings: string[];
};
