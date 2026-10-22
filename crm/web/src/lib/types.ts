export type Role = "admin" | "manager";

export type User = { id: number; login: string; name: string; email: string | null; role: Role };

export type UserRow = User & { isActive: boolean; createdAt: string; lastLoginAt: string | null };

export type Space = {
  id: number;
  key: string;
  name: string;
  description: string;
  updatedAt: string;
  pageCount?: number;
  lastPageUpdatedAt?: string | null;
};

export type TreePage = { id: number; parentId: number | null; title: string; position: number; updatedAt: string };

export type Doc = { type: "doc"; content?: unknown[] };

export type Attachment = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  createdByName: string | null;
};

export type Page = {
  id: number;
  spaceId: number;
  parentId: number | null;
  title: string;
  content: Doc;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
};

export type PageResponse = {
  page: Page;
  space: { id: number; key: string; name: string };
  breadcrumbs: { id: number; title: string }[];
  attachments: Attachment[];
};

export type VersionRow = { version: number; note: string | null; createdAt: string; createdByName: string | null };

export type CallQa = { q: string; a: string };
export type CallTopic = { id: string; title: string; ask: string[]; qa: CallQa[]; updatedAt?: string };

export type SearchResult = {
  shipments: { number: number; containerNo: string | null; title: string; client: string | null; status: string; stage: number }[];
  deals: { key: string; title: string; client: string | null; status: string; outcome: string | null }[];
  clients: { id: number; name: string; inn: string | null; role: CounterpartyRole }[];
  documents: { id: number; type: string; number: string | null; date: string | null; party: string | null }[];
  products: { id: number; name: string; hsCode: string | null }[];
  pages: { id: number; title: string; spaceKey: string; spaceName: string; snippet: string; updatedAt: string }[];
  callTopics: { id: string; title: string; ask: string[]; snippet: string }[];
};

// ── CRM ────────────────────────────────────────────────────────────────────

export type Stage = { key: string; name: string; color: string; position: number; isFinal: boolean; dealCount: number };

export type Deal = {
  id: number;
  number: number;
  key: string;
  title: string;
  statusKey: string;
  outcome: "won" | "lost" | null;
  lostReason: string | null;
  product: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  labels: string[];
  description: string;
  boardPosition: number;
  source: string;
  clientId: number | null;
  clientName: string | null;
  clientKind: string | null;
  clientInn: string | null;
  contactId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactMessenger: string | null;
  contactMessengerHandle: string | null;
  contactEmail: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdByName: string | null;
  shipmentCount: number;
};

export type DealComment = { id: number; body: string; authorId: number | null; authorName: string | null; createdAt: string };

export type DealEvent = {
  id: number;
  kind: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  userName: string | null;
  createdAt: string;
};

export type DealParty = { id: number; name: string; role: CounterpartyRole; contractorType: string | null };

export type Money = { currency: string; amount: number; paid: number };
export type FinanceRow = {
  category: string;
  label: string;
  plan: { amount: number | null; currency: string } | null;
  fact: Money[];
};

export type DealDocument = {
  id: number;
  type: string;
  number: string | null;
  date: string | null;
  seqNo: number | null;
  parentId: number | null;
  shipmentId: number | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  contractorType: string | null;
  currency: string | null;
  amount: number | null;
  status: string | null;
  paymentStatus: "unpaid" | "partial" | "paid" | null;
  paidAmount: number | null;
  paidAt: string | null;
  validUntil: string | null;
  /** Файлов документа (без документов об оплате). */
  fileCount: number;
  /** Документов об оплате (платёжки, SWIFT), прикреплённых к документу. */
  paymentFileCount: number;
  files: { id: string; filename: string; label: string | null; createdAt: string }[];
  /** Оплаты на несколько счетов, которыми оплачен документ; shared — платёжка и за другие счета / из другой сделки. */
  allocations: { paymentId: number; number: string | null; date: string; amount: number; total: number; currency: string; shipmentId: number | null; shipmentNumber: number | null; shared: boolean }[];
};

/** Оплата на несколько счетов (одна платёжка → разнесение по инвойсам). */
export type ShipmentPayment = {
  id: number;
  number: string | null;
  date: string;
  amount: number;
  currency: string;
  note: string;
  shipmentId: number | null;
  shipmentNumber: number | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  files: { id: string; filename: string }[];
  allocations: { documentId: number; amount: number; type: string; number: string | null; date: string | null; docAmount: number | null; shipmentId: number | null; shipmentNumber: number | null }[];
  unallocated: number;
};

export type DealResponse = {
  deal: Deal;
  comments: DealComment[];
  events: DealEvent[];
  attachments: Attachment[];
  /** Сделки (отгрузки), выросшие из лида. */
  shipments: { number: number; title: string; status: string; stage: number; containerNo: string | null }[];
};

export type CounterpartyRole = "client" | "supplier" | "contractor";

export type Counterparty = {
  id: number;
  role: CounterpartyRole;
  contractorType: string | null;
  kind: "ooo" | "ip" | "other" | "foreign";
  name: string;
  fullName: string | null;
  country: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  regNumber: string | null;
  legalAddress: string | null;
  postalAddress: string | null;
  bankAccount: string | null;
  bankName: string | null;
  bankBik: string | null;
  bankCorrAccount: string | null;
  bankInn: string | null;
  bankAddress: string | null;
  bankSwift: string | null;
  signatoryTitle: string | null;
  signatoryName: string | null;
  signatoryBasis: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type CounterpartyRow = Pick<Counterparty, "id" | "role" | "contractorType" | "kind" | "name" | "inn" | "country" | "email" | "updatedAt"> & {
  dealCount: number;
  documentCount: number;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

export type DocumentRow = {
  id: number;
  type: string;
  number: string | null;
  date: string | null;
  seqNo: number | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  counterpartyRole: CounterpartyRole | null;
  clientId: number | null;
  clientName: string | null;
  shipmentId: number | null;
  shipmentNumber: number | null;
  shipmentTitle: string | null;
  parentId: number | null;
  parentNumber: string | null;
  parentType: string | null;
  currency: string | null;
  amount: number | null;
  status: string | null;
  paymentStatus: "unpaid" | "partial" | "paid" | null;
  paidAmount: number | null;
  paidAt: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
};

export type DocItem = {
  id?: number;
  productId: number | null;
  productName?: string | null;
  name: string;
  batchNo: string | null;
  hsCode: string | null;
  /** Код ТН ВЭД подобран ИИ — проверить. */
  hsAuto?: boolean;
  /** Товар подобран среди товаров поставщика по артикулу — проверить. */
  productGuess?: boolean;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  amount: number | null;
};

export type DocFile = Attachment & { label: string | null };

export type DocumentFull = {
  document: DocumentRow & { data: Record<string, unknown>; notes: string; createdBy: number | null };
  items: DocItem[];
  files: DocFile[];
  children: DocumentRow[];
  parentLabel: string | null;
};

export type ProductRow = {
  id: number;
  name: string;
  nameRu: string | null;
  hsCode: string | null;
  unit: string | null;
  vat10: boolean;
  /** Ставка пошлины по коду (из справочника ТН ВЭД). */
  tariff: string | null;
  updatedAt: string;
  lastPrice: number | null;
  lastCurrency: string | null;
  supplierCount: number;
  clientCount: number;
  variantCount: number;
  factoryCount: number;
  bestOffer: { price: number; currency: string; unit: string | null } | null;
};

export type ProductLine = {
  documentId: number;
  type: string;
  number: string | null;
  date: string | null;
  currency: string | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  clientId: number | null;
  clientName: string | null;
  shipmentNumber: number | null;
  shipmentTitle: string | null;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  amount: number | null;
};

export type Contact = {
  id: number;
  counterpartyId: number | null;
  name: string;
  phone: string | null;
  messenger: string | null;
  messengerHandle: string | null;
  email: string | null;
  position: string | null;
  isPrimary: boolean;
};

export type DirectoryUser = { id: number; name: string; isActive: boolean };

// ── Сделки (отгрузки) и календарь ─────────────────────────────────────────

export type Ref = { id: number; name: string };

export type Shipment = {
  id: number;
  number: number;
  label: string;
  title: string;
  status: "active" | "closed" | "cancelled";
  stage: number;
  scheme: "commission" | "supply" | "teu";
  clientId: number | null;
  contactId: number | null;
  supplierId: number | null;
  carrierId: number | null;
  carrierInvoiceId: number | null;
  clientContractId: number | null;
  supplierContractId: number | null;
  dealId: number | null;
  assigneeId: number | null;
  containerNo: string | null;
  hsCode: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  transport: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  depositDate: string | null;
  exportLicense: string | null;
  certificates: string | null;
  certificateHolder: string | null;
  chestnyZnak: string | null;
  notes: string;
  client: Ref | null;
  contact: { id: number; name: string; phone: string | null; messenger: string | null; messengerHandle: string | null; email: string | null } | null;
  supplier: Ref | null;
  carrier: Ref | null;
  assignee: Ref | null;
  carrierInvoice: {
    id: number;
    number: string | null;
    date: string | null;
    amount: number | null;
    currency: string | null;
    paymentStatus: "unpaid" | "partial" | "paid" | null;
  } | null;
  deal: { id: number; key: string; title: string } | null;
  flags: Record<string, string>;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  milestones: Record<string, { plan: string | null; fact: string | null }>;
  nextDate: string | null;
  pendingFlags: string[];
};

export type ShipmentItem = {
  documentId: number;
  type: string;
  currency: string | null;
  productId: number | null;
  productName: string | null;
  name: string;
  hsCode: string | null;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  amount: number | null;
};

export type ShipmentCertificate = {
  id: number;
  number: string | null;
  date: string | null;
  validUntil: string | null;
  status: string | null;
  holder: string | null;
  products: string[];
  fileCount: number;
};

export type ShipmentResponse = {
  shipment: Shipment;
  events: ShipmentEvent[];
  parties: DealParty[];
  documents: DealDocument[];
  finance: { orderId: number | null; planSource: "calc" | "order" | null; lastMile: number | null; rows: FinanceRow[]; clientInvoices: Money[] };
  items: ShipmentItem[];
  certificates: ShipmentCertificate[];
  payments: ShipmentPayment[];
  /** Пояснение по оплатам для таможни — если оплата не «счёт — платёжка» в этой же сделке. */
  paymentNotes: string[];
  /** Наличные сверху — только администраторам (остальным null). */
  cash: import("../../../shared/shipments.ts").ShipmentCash | null;
  /** Расчёт, из которого создана сделка. */
  estimate: { id: number; title: string } | null;
};

export type ShipmentEvent = {
  id: number;
  kind: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  userName: string | null;
};

export type CalendarEvent = {
  id: string;
  kind: "milestone" | "flag";
  key: string;
  title: string;
  date: string | null;
  done: boolean;
  payment: boolean;
  milestone: string | null;
  shipment: { number: number; label: string; title: string; stage: number; containerNo: string | null; client: string | null; carrier: string | null };
};

// ── База фабрик ────────────────────────────────────────────────────────────

export type FactoryRow = {
  id: number;
  name: string;
  nameRu: string | null;
  wechatId: string | null;
  contactName: string | null;
  location: string | null;
  categories: string[];
  status: string;
  counterpartyId: number | null;
  foundByName: string | null;
  updatedAt: string;
  exportLicense: string;
  photoId: string | null;
  offers: { name: string; price: number | null; currency: string; unit: string | null }[];
};

export type Factory = {
  id: number;
  name: string;
  nameRu: string | null;
  wechatId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  location: string | null;
  categories: string[];
  status: string;
  profile: import("../../../shared/factories.ts").FactoryProfile;
  notes: string;
  foundBy: number | null;
  counterpartyId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type FactoryFile = { id: string; filename: string; mime: string; size: number; label: string | null; createdAt: string };

export type FactoryResponse = {
  factory: Factory;
  offers: import("../../../shared/factories.ts").Offer[];
  files: FactoryFile[];
  foundBy: { id: number; name: string } | null;
  supplier: { id: number; name: string } | null;
};
