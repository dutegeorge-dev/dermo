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
  deals: { key: string; title: string; client: string | null; status: string; outcome: string | null }[];
  clients: { id: number; name: string; inn: string | null }[];
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
  hsCode: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  goodsReadyDate: string | null;
  route: string | null;
  contractParty: string | null;
  exportLicense: string | null;
  certificates: string | null;
  certificateHolder: string | null;
  chestnyZnak: string | null;
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

export type DealResponse = { deal: Deal; comments: DealComment[]; events: DealEvent[]; attachments: Attachment[] };

export type Client = {
  id: number;
  kind: "ooo" | "ip" | "other";
  name: string;
  inn: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientRow = Pick<Client, "id" | "kind" | "name" | "inn" | "updatedAt"> & {
  dealCount: number;
  contactName: string | null;
  contactPhone: string | null;
};

export type Contact = {
  id: number;
  clientId: number | null;
  name: string;
  phone: string | null;
  messenger: string | null;
  messengerHandle: string | null;
  email: string | null;
  position: string | null;
  isPrimary: boolean;
};

export type DirectoryUser = { id: number; name: string; isActive: boolean };
