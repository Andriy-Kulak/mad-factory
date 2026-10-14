import "server-only";
import type { ProductRow } from "@db/types";
import { cachedByProduct } from "./cache";
import { overviewFor } from "../../src/scorecard/load.ts";

// The overview is computed in src/ so `pnpm brief` (for agents) and this page always show the same numbers.
export { overviewFor };
export { DEFAULT_WINDOW_DAYS, formatBrief, type Overview, type WeekLine } from "../../src/scorecard/overview.ts";

export const overviewForCached = cachedByProduct("overview", (_productId: string, product: ProductRow, opts?: Parameters<typeof overviewFor>[1]) => overviewFor(product, opts));
