import { parseArgs } from "node:util";
import { listProductGoals, requireProduct, upsertProductGoal } from "../db/index.ts";
import { scorecardFor } from "../scorecard/load.ts";
import { formatScorecard } from "../scorecard/scorecard.ts";

const HELP = `Usage: pnpm scorecard [goal] --product <id|slug> [options]

Monthly profit versus the product's goal, from the synced daily tables (read-only):
profit = RevenueCat proceeds − ad spend (every synced channel) − monthly fixed costs (prorated).
Run the channel syncs first; the scorecard warns when a source is behind.

  pnpm scorecard --product <slug> [--month YYYY-MM] [--through YYYY-MM-DD] [--json]
      --through defaults to yesterday (UTC), the last complete day; --month to the month of --through.
  pnpm scorecard goal --product <slug> [--target <amount>] [--fixed-costs <amount>] [--currency USD] [--notes "..."]
      Create or update the product's monthly profit goal.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    month: { type: "string" },
    through: { type: "string" },
    json: { type: "boolean", default: false },
    target: { type: "string" },
    "fixed-costs": { type: "string" },
    currency: { type: "string" },
    notes: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help || !values.product) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}
const product = await requireProduct(values.product);
const [existing] = await listProductGoals(product.id);
const amount = (flag: string, v: string | undefined) => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number`);
  return n;
};

if (positionals[0] === "goal") {
  const target = amount("--target", values.target) ?? existing?.target;
  if (target == null) throw new Error("--target is required for a new goal");
  const row = await upsertProductGoal({
    product_id: product.id,
    metric: "monthly_profit",
    target,
    currency: values.currency ?? existing?.currency ?? "USD",
    monthly_fixed_costs: amount("--fixed-costs", values["fixed-costs"]) ?? existing?.monthly_fixed_costs ?? null,
    notes: values.notes ?? existing?.notes ?? null,
  });
  console.log(`${product.slug}: monthly profit goal ${row.target} ${row.currency}, fixed costs ${row.monthly_fixed_costs ?? "not set"}`);
  process.exit(0);
} else if (positionals.length) {
  throw new Error(`Unknown command: ${positionals[0]}\n\n${HELP}`);
}

const card = await scorecardFor(product, { month: values.month, through: values.through });
console.log(values.json ? JSON.stringify(card, null, 2) : formatScorecard(card));
