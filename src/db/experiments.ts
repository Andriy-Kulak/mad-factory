import { getDb, unwrap } from "./client.ts";
import type { ExperimentCampaignInsert, ExperimentCampaignRow, ExperimentInsert, ExperimentLogInsert, ExperimentLogRow, ExperimentRow } from "./types.ts";

export const EXPERIMENT_LOG_KINDS = ["observation", "change", "decision", "review", "note"] as const;
export type ExperimentLogKind = (typeof EXPERIMENT_LOG_KINDS)[number];

export async function listExperiments(productId: string): Promise<ExperimentRow[]> {
  return unwrap(await getDb().from("experiments").select("*").eq("product_id", productId).order("start_date", { ascending: false }), "listExperiments");
}

export async function listExperimentCampaigns(experimentId: string): Promise<ExperimentCampaignRow[]> {
  return unwrap(await getDb().from("experiment_campaigns").select("*").eq("experiment_id", experimentId).order("external_campaign_id"), "listExperimentCampaigns");
}

export async function getExperimentBySlug(productId: string, slug: string): Promise<ExperimentRow | null> {
  const res = await getDb().from("experiments").select("*").eq("product_id", productId).eq("slug", slug).maybeSingle();
  if (res.error) throw new Error(`getExperimentBySlug: ${res.error.message}`);
  return res.data;
}

export async function listExperimentLog(experimentId: string): Promise<ExperimentLogRow[]> {
  return unwrap(await getDb().from("experiment_log").select("*").eq("experiment_id", experimentId).order("at"), "listExperimentLog");
}

export async function getExperimentLog(id: string): Promise<ExperimentLogRow | null> {
  const res = await getDb().from("experiment_log").select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(`getExperimentLog: ${res.error.message}`);
  return res.data;
}

export async function addExperimentLog(input: ExperimentLogInsert): Promise<ExperimentLogRow> {
  return unwrap(await getDb().from("experiment_log").insert(input).select("*").single(), "addExperimentLog");
}

/** Marks a follow-up (a log entry with due_on) done. Fails when the row is not an open follow-up. */
export async function resolveExperimentLog(id: string, resolvedAt: string): Promise<ExperimentLogRow> {
  const res = await getDb().from("experiment_log").update({ resolved_at: resolvedAt }).eq("id", id).is("resolved_at", null).not("due_on", "is", null).select("*").single();
  if (res.error) throw new Error(`resolveExperimentLog: ${id} is not an open follow-up (missing, has no due_on, or already resolved)`);
  return res.data;
}

/** Upserts on (product_id, slug) and replaces the experiment's campaign links with the given set. */
export async function upsertExperiment(input: ExperimentInsert, campaigns: Omit<ExperimentCampaignInsert, "experiment_id">[]): Promise<ExperimentRow> {
  const db = getDb();
  const row = unwrap(await db.from("experiments").upsert(input, { onConflict: "product_id,slug" }).select("*").single(), "upsertExperiment");
  const del = await db.from("experiment_campaigns").delete().eq("experiment_id", row.id);
  if (del.error) throw new Error(`upsertExperiment: ${del.error.message}`);
  if (campaigns.length) {
    const ins = await db.from("experiment_campaigns").insert(campaigns.map((c) => ({ ...c, experiment_id: row.id })));
    if (ins.error) throw new Error(`upsertExperiment: ${ins.error.message}`);
  }
  return row;
}
