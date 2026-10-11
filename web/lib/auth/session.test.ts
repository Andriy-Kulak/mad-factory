import assert from "node:assert/strict";
import { test } from "node:test";
import { readAuthConfig, safeNext, signSession, verifySession, type AuthConfig } from "./session.ts";

const config: AuthConfig = { clientId: "id", clientSecret: "cs", secret: "s".repeat(32), allowed: ["owner"] };
const now = 1_800_000_000;

test("a signed session verifies until it expires", async () => {
  const token = await signSession({ login: "owner", exp: now + 60 }, config.secret);
  assert.deepEqual(await verifySession(token, config, now), { login: "owner", exp: now + 60 });
  assert.equal(await verifySession(token, config, now + 61), null);
});

test("a tampered payload, another secret or garbage does not verify", async () => {
  const token = await signSession({ login: "owner", exp: now + 60 }, config.secret);
  const [, sig] = token.split(".");
  const forged = `${Buffer.from(JSON.stringify({ login: "owner", exp: now + 999_999 })).toString("base64url")}.${sig}`;
  assert.equal(await verifySession(forged, config, now), null);
  assert.equal(await verifySession(token, { ...config, secret: "x".repeat(32) }, now), null);
  for (const junk of [undefined, "", "a", "a.b", "a.b.c", "%%%.%%%"]) assert.equal(await verifySession(junk, config, now), null);
});

test("removing a user from the allowlist ends their session", async () => {
  const token = await signSession({ login: "owner", exp: now + 60 }, config.secret);
  assert.equal(await verifySession(token, { ...config, allowed: ["someone-else"] }, now), null);
});

test("AUTH_DISABLED only works outside production, and missing settings are named", () => {
  assert.deepEqual(readAuthConfig({ AUTH_DISABLED: "true", NODE_ENV: "development" }), { disabled: true });
  const prod = readAuthConfig({ AUTH_DISABLED: "true", NODE_ENV: "production" });
  assert.equal(prod.disabled, false);
  assert.equal(!prod.disabled && prod.config, null);
  assert.deepEqual(!prod.disabled && prod.missing, ["AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET", "AUTH_SECRET (32+ characters)", "AUTH_ALLOWED_GITHUB_USERS"]);
  const ok = readAuthConfig({ AUTH_GITHUB_CLIENT_ID: "i", AUTH_GITHUB_CLIENT_SECRET: "c", AUTH_SECRET: "s".repeat(32), AUTH_ALLOWED_GITHUB_USERS: " Owner, other " });
  assert.deepEqual(!ok.disabled && ok.config?.allowed, ["owner", "other"]);
});

test("safeNext keeps same-site paths only", () => {
  assert.equal(safeNext("/p/x?days=7"), "/p/x?days=7");
  assert.equal(safeNext("/p/x#ads"), "/p/x#ads");
  const bad = [
    null,
    "",
    "p/x",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\r\\evil.example",
    "\t//evil.example",
    "/\u0000/evil.example",
    "/\u007f/evil.example",
    "/p/x\\..\\..\\evil",
  ];
  for (const value of bad) assert.equal(safeNext(value), "/", JSON.stringify(value));
});

test("whatever safeNext returns resolves on the app's own origin", () => {
  const origin = "https://app.example";
  const tricky = ["\t", "\n", "\r", "\\", "/", "%09", "%2f", "%5c", ".", "..", "@", ":", " ", "\u3000", "\uff0f"];
  for (const a of tricky)
    for (const b of tricky)
      for (const c of tricky) {
        const value = `/${a}${b}${c}evil.example`;
        assert.equal(new URL(safeNext(value), origin).origin, origin, JSON.stringify(value));
      }
});
