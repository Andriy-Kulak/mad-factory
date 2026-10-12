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
    // Keep this aligned with CLIENT_CACHE_SECONDS in components/refresh-on-revisit.tsx.
    staleTimes: { dynamic: 300 },
  },
  outputFileTracingIncludes: { "/api/mcp": DOCS },
};

export default nextConfig;
