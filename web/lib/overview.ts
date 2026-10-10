import "server-only";

// The overview is computed in src/ so `pnpm brief` (for agents) and this page always show the same numbers.
export { overviewFor } from "../../src/scorecard/load.ts";
export { DEFAULT_WINDOW_DAYS, formatBrief, type Overview } from "../../src/scorecard/overview.ts";
