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
  pages: { id: number; title: string; spaceKey: string; spaceName: string; snippet: string; updatedAt: string }[];
  callTopics: { id: string; title: string; ask: string[]; snippet: string }[];
};
