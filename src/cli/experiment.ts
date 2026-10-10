import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  addExperimentLog,
  EXPERIMENT_LOG_KINDS,
  getExperimentBySlug,
  getExperimentLog,
  listExperimentCampaigns,
  listExperimentLog,
  listExperiments,
  requireProduct,
  resolveExperimentLog,
  upsertExperiment,
  type ExperimentLogKind,
  type Json,
} from "../db/index.ts";
import { docName } from "../lib/product-docs.ts";

const HELP = `Usage: pnpm experiment <command> [options]

Experiments are channel-agnostic records: numbers, campaign links and the dated log live in the database;
the slow-changing reasoning (why, design, success criteria, verdict) in write-up documents in product_docs.

Commands:
  upsert  --product <id|slug> --file <definition.json>          Create or update an experiment and its campaign links
  list    --product <id|slug>                                  Experiments of a product with their campaigns
  log     --product <id|slug> --experiment <slug> --kind <k> [--actor <who>] [--at <ISO>] [--plan <name>] [--url <u>] [--due <YYYY-MM-DD>] "<text>"
                                                               Append a dated entry to the experiment's log.
                                                               --due makes it a follow-up: a promise to come back, listed in \`pnpm brief\` once due
  resolve --product <id|slug> --id <log entry id> [--actor <who>] "<what was done>"
                                                               Mark a follow-up done and log a decision on its experiment
  history --product <id|slug> --experiment <slug>              Print the experiment's log, oldest first

Log kinds: ${EXPERIMENT_LOG_KINDS.join(" | ")}. --actor defaults to $USER; --at to now.

Definition file (the slug defaults to the file name without .json):
  { "channel": "apple_ads", "name": "...", "hypothesis": "...", "status": "planned|running|ended|abandoned",
    "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "daily_budget": 0, "total_budget": 0, "currency": "USD",
    "success_criteria": "...", "rules": { }, "verdict": null, "writeup_path": "<write-up-name>",
    "campaigns": [ { "id": "<channel campaign id>", "role": "generic", "geo": "US" } ] }
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    file: { type: "string" },
    experiment: { type: "string" },
    kind: { type: "string" },
    actor: { type: "string" },
    at: { type: "string" },
    plan: { type: "string" },
    url: { type: "string" },
    due: { type: "string" },
    id: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});
const [cmd, ...rest] = positionals;
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}
if (!values.product) throw new Error("--product is required");
const product = await requireProduct(values.product);

const STATUSES = ["planned", "running", "ended", "abandoned"];

async function requireExperiment() {
  if (!values.experiment) throw new Error("--experiment <slug> is required");
  const e = await getExperimentBySlug(product.id, values.experiment);
  if (!e) throw new Error(`No experiment "${values.experiment}" for product ${product.slug}`);
  return e;
}
const isKind = (k: string): k is ExperimentLogKind => (EXPERIMENT_LOG_KINDS as readonly string[]).includes(k);

switch (cmd) {
  case "upsert": {
    if (!values.file) throw new Error("--file is required");
    const def = JSON.parse(readFileSync(values.file, "utf8")) as Record<string, unknown>;
    const str = (k: string) => (def[k] == null ? null : String(def[k]));
    const num = (k: string) => (def[k] == null ? null : Number(def[k]));
    const channel = str("channel");
    const name = str("name");
    if (!channel || !name) throw new Error("The definition needs at least channel and name");
    const status = str("status") ?? "planned";
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
    const campaigns = ((def.campaigns as { id: unknown; role?: string; geo?: string }[] | undefined) ?? []).map((c) => ({
      channel,
      external_campaign_id: String(c.id),
      role: c.role ?? null,
      geo: c.geo ?? null,
    }));
    const row = await upsertExperiment(
      {
        product_id: product.id,
        channel,
        slug: str("slug") ?? basename(values.file, ".json"),
        name,
        hypothesis: str("hypothesis"),
        status,
        start_date: str("start_date"),
        end_date: str("end_date"),
        daily_budget: num("daily_budget"),
        total_budget: num("total_budget"),
        currency: str("currency"),
        success_criteria: str("success_criteria"),
        rules: (def.rules ?? {}) as Json,
        verdict: str("verdict"),
        writeup_path: str("writeup_path") ? docName(str("writeup_path")!) : null,
      },
      campaigns,
    );
    console.log(`Experiment ${row.slug} [${row.status}] ${row.id}: ${campaigns.length} campaign(s)`);
    break;
  }
  case "list": {
    for (const e of await listExperiments(product.id)) {
      console.log(`${e.slug}  [${e.channel} · ${e.status}]  ${e.start_date ?? "?"} → ${e.end_date ?? "?"}  ${e.name}`);
      for (const c of await listExperimentCampaigns(e.id)) console.log(`   ${c.external_campaign_id}  ${c.role ?? "-"}  ${c.geo ?? "-"}`);
    }
    break;
  }
  case "log": {
    const e = await requireExperiment();
    const body = rest.join(" ").trim();
    if (!body) throw new Error("The log text is required");
    if (!values.kind || !isKind(values.kind)) throw new Error(`--kind must be one of ${EXPERIMENT_LOG_KINDS.join(", ")}`);
    const at = values.at ? new Date(values.at) : new Date();
    if (Number.isNaN(at.getTime())) throw new Error(`--at is not a date: ${values.at}`);
    if (values.due != null && (!/^\d{4}-\d{2}-\d{2}$/.test(values.due) || new Date(`${values.due}T00:00:00Z`).toISOString().slice(0, 10) !== values.due))
      throw new Error(`--due must be a real date as YYYY-MM-DD: ${values.due}`);
    const row = await addExperimentLog({
      experiment_id: e.id,
      at: at.toISOString(),
      actor: values.actor ?? process.env.USER ?? "unknown",
      kind: values.kind,
      body,
      plan_path: values.plan ? docName(values.plan) : null,
      source_url: values.url ?? null,
      due_on: values.due ?? null,
    });
    console.log(`${row.at}  ${row.kind}  ${row.actor}  ${row.id}${row.due_on ? `  due ${row.due_on}` : ""}`);
    break;
  }
  case "resolve": {
    const body = rest.join(" ").trim();
    if (!body) throw new Error("The resolution text is required");
    if (!values.id) throw new Error("--id <log entry id> is required");
    const entry = await getExperimentLog(values.id);
    if (!entry) throw new Error(`No log entry ${values.id}`);
    const e = (await listExperiments(product.id)).find((x) => x.id === entry.experiment_id);
    if (!e) throw new Error(`Log entry ${values.id} does not belong to an experiment of product ${product.slug}`);
    const now = new Date();
    const row = await resolveExperimentLog(entry.id, now.toISOString());
    const logged = await addExperimentLog({
      experiment_id: e.id,
      at: now.toISOString(),
      actor: values.actor ?? process.env.USER ?? "unknown",
      kind: "decision",
      body: `Follow-up ${row.id.slice(0, 8)} (due ${row.due_on}): ${body}`,
      plan_path: null,
      source_url: null,
    });
    console.log(`Follow-up ${row.id} (due ${row.due_on}) resolved; decision ${logged.id} logged on ${e.slug}`);
    break;
  }
  case "history": {
    const e = await requireExperiment();
    const rows = await listExperimentLog(e.id);
    if (!rows.length) console.log(`No log entries for ${e.slug}`);
    for (const r of rows) {
      const refs = [r.plan_path, r.source_url].filter(Boolean).join("  ");
      const due = r.due_on ? `[due ${r.due_on}${r.resolved_at ? `, resolved ${r.resolved_at.slice(0, 10)}` : ""}]  ` : "";
      console.log(`${r.at.slice(0, 16).replace("T", " ")}  [${r.kind} · ${r.actor}]  ${due}${r.due_on ? `${r.id}  ` : ""}${r.body}${refs ? `\n    ${refs}` : ""}`);
    }
    break;
  }
  default:
    console.error(`Unknown command "${cmd}"\n\n${HELP}`);
    process.exit(1);
}
