import { parseArgs } from "node:util";
import { requireProduct } from "../db/index.ts";
import { overviewFor } from "../scorecard/load.ts";
import { DEFAULT_WINDOW_DAYS, formatBrief } from "../scorecard/overview.ts";

const HELP = `Usage: pnpm brief --product <id|slug> [--days ${DEFAULT_WINDOW_DAYS}] [--json]

Where the product stands: the monthly profit goal, the last N complete days per channel, Meta ads by spend,
own posts, running experiments and stale data. The same numbers as the web overview. Read-only.
Agents: read this before marketing or analysis work.
`;

const { values } = parseArgs({
  options: {
    product: { type: "string" },
    days: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help || !values.product) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}
const days = values.days ? Number(values.days) : undefined;
if (days != null && (!Number.isInteger(days) || days < 1 || days > 90)) throw new Error("--days is a whole number from 1 to 90");
const overview = await overviewFor(await requireProduct(values.product), { days });
console.log(values.json ? JSON.stringify(overview, null, 2) : formatBrief(overview));
