import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Share the repo-root .env (infrastructure credentials only) with the web app.
const rootEnv = resolve(__dirname, "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// /api/mcp reads these repo folders at runtime; a hosted build only ships files it can trace from imports.
const DOCS = ["../playbooks/**/*", "../docs/**/*"];

const nextConfig: NextConfig = {
  typedRoutes: false,
  experimental: {
    // Reuse a visited page for 5 minutes instead of showing its skeleton again. Data changes on the daily sync;
    // server actions call revalidatePath, which drops this cache, and a browser reload always fetches fresh.
    staleTimes: { dynamic: 300 },
  },
  outputFileTracingIncludes: { "/api/mcp": DOCS },
};

export default nextConfig;
