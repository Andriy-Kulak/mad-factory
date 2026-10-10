import type { Json } from "../db/types.ts";

export type ApiObject = Record<string, unknown>;

export interface ApiPage<T> {
  data?: T[];
  paging?: {
    next?: string;
    cursors?: { after?: string };
  };
}

export interface ActionTypeConfig {
  installs?: string[];
  trials?: string[];
  purchases?: string[];
}

export interface MetaAdsCallJournalEntry {
  method: "GET" | "POST";
  path: string;
  params: Record<string, string | number | boolean>;
  status: number | null;
  usage: Json | null;
  error?: string;
}
