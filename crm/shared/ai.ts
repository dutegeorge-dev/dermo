/** ИИ-разбор документа: черновик формы (сервер: server/lib/ai-parse.ts, интерфейс: DocumentEditor). */

import type { PackingData } from "./cargo.ts";
import type { CostLine, DocType } from "./documents.ts";

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
  /** Найденному контрагенту — реквизиты из документа, которых у него ещё нет (дописать при сохранении). */
  counterpartyFill: Record<string, string> | null;
  client: { id: number; name: string } | null;
  parentId: number | null;
  contractNumber: string | null;
  shipment: { id: number; number: number; title: string; containerNo: string | null; weightKg: number | null } | null;
  shipmentReason: string | null;
  cargoTitle: string | null;
  containerNo: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  /** Упаковочный лист: строки и итоги. */
  packing: PackingData | null;
  /** Поручение: смета («Порядок возмещаемых платежей») из файла. */
  costs: CostLine[] | null;
  /** Документ об оплате: к какому инвойсу / счёту прикрепить. */
  payFor: { id: number; label: string; amount: number | null; currency: string | null; paymentStatus: string | null } | null;
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
    /** Товар подобран среди товаров поставщика по артикулу — проверить. */
    productGuess?: boolean;
    tariff?: string | null;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    amount: number | null;
  }[];
  summary: string;
  warnings: string[];
};
