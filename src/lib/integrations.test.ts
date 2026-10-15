import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { envHint, getIntegration, INTEGRATIONS, integrationStatus, MissingConfigError, requireIntegration } from "./integrations.ts";

const allVars = INTEGRATIONS.flatMap((it) => [...it.env.flat(), ...(it.optional ?? [])]);

test("only Supabase is required", () => {
  assert.deepEqual(
    INTEGRATIONS.filter((it) => it.required).map((it) => it.key),
    ["supabase"],
  );
});

test(".env.example and the README list every integration variable", () => {
  const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  for (const name of allVars) {
    assert.match(example, new RegExp(`^#? ?${name}=`, "m"), `.env.example is missing ${name}`);
    assert.match(readme, new RegExp(`\\b${name}\\b`), `README.md "Keys and integrations" is missing ${name}`);
  }
});

test(".env.example has no variable the registry does not know", () => {
  const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const names = [...example.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
  assert.deepEqual(
    names.filter((n) => !allVars.includes(n)),
    [],
  );
});

test("a group counts only when complete; the closest group names what is missing", () => {
  assert.deepEqual(integrationStatus("r2", { R2_ACCOUNT_ID: "a", R2_BUCKET: "b" }), {
    configured: false,
    missing: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_URL"],
  });
  assert.equal(integrationStatus("apple-ads", { APPLE_ADS_DIR: "/x" }).configured, true);
  assert.deepEqual(integrationStatus("apple-ads", { APPLE_ADS_CLIENT_ID: "c" }).missing, ["APPLE_ADS_TEAM_ID", "APPLE_ADS_KEY_ID", "APPLE_ADS_PRIVATE_KEY"]);
  assert.equal(integrationStatus("meta-ads", { META_ADS_TOKEN: "" }).configured, false);
});

test("requireIntegration throws a readable MissingConfigError", () => {
  assert.doesNotThrow(() => requireIntegration("gemini", { GEMINI_API_KEY: "k" }));
  assert.throws(
    () => requireIntegration("gemini", {}),
    (e: unknown) => {
      assert.ok(e instanceof MissingConfigError);
      assert.match(e.message, /Google Gemini is not configured/);
      assert.match(e.message, /GEMINI_API_KEY/);
      assert.match(e.message, /pnpm doctor/);
      return true;
    },
  );
});

test("envHint reads naturally", () => {
  assert.equal(envHint(getIntegration("supabase")), "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(envHint(getIntegration("apple-ads")), "APPLE_ADS_DIR, or APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID and APPLE_ADS_PRIVATE_KEY");
});
