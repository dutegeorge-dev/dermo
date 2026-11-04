/** Типы ответов API раздела «Лидогенерация». */

import type { ContactSource, JobError, JobProgress, LeadgenSettings, ProductSample, SellerStatus } from "../../../../shared/leadgen.ts";

export type LeadCategory = {
  id: number;
  name: string;
  queries: string[];
  stopWords: string[];
  marking: boolean;
  markingNote: string;
  quota: number;
  template: string;
  active: boolean;
  sort: number;
  sellers: number;
};

export type LeadJob = {
  id: number;
  month: string;
  status: "queued" | "running" | "stopping" | "paused" | "failed" | "done";
  stage: "collect" | "filter" | "schedule" | "done";
  progress: JobProgress;
  quotas: Record<string, number>;
  categoryIds: number[];
  errors: JobError[];
  retryAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  createdAt: string;
};

export type LeadContact = { id: number; type: "phone" | "email" | "site"; value: string; source: ContactSource; valid: boolean; note: string | null; receivedAt: string };

export type LeadSeller = {
  inn: string;
  legalName: string;
  kind: string;
  ogrn: string | null;
  brands: string[];
  wbSupplierIds: number[];
  managerName: string | null;
  managerPost: string | null;
  regDate: string | null;
  okved: string | null;
  region: string | null;
  address: string | null;
  egrStatus: string | null;
  skuCount: number | null;
  feedbacksTotal: number | null;
  chinaShare: number | null;
  products: ProductSample[];
  categoryId: number | null;
  categoryName: string | null;
  batchMonth: string;
  status: SellerStatus;
  firstLine: string;
  firstSentAt: string | null;
  createdAt: string;
  contacts: LeadContact[];
};

export type TodayItem = LeadSeller & { queueId: number; touch: "first" | "followup"; plannedDate: string };

export type LeadStatus = {
  dadata: boolean;
  checko: boolean;
  proxy: boolean;
  worker: { at: string | null; alive: boolean; state: string | null };
  settings: LeadgenSettings;
  months: string[];
  today: string;
};

export type StatsRow = {
  categoryId: number | null;
  name: string;
  sellers: number;
  sent: number;
  bounced: number;
  replies: number;
  positive: number;
  negative: number;
  doNotContact: number;
  bouncedPct: number;
  repliesPct: number;
  positivePct: number;
};

export type SellerDetails = {
  seller: LeadSeller;
  events: { id: number; type: string; comment: string | null; createdAt: string; userId: number | null }[];
  queue: { id: number; plannedDate: string; touch: string; status: string; sentAt: string | null }[];
};
