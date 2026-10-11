import assert from "node:assert/strict";
import { test } from "node:test";
import { readAuthConfig, safeNext, signSession, verifySession, type AuthConfig, type Session } from "./session.ts";

const config: AuthConfig = { clientId: "id", clientSecret: "cs", secret: "s".repeat(32), allowed: ["1234"] };
const now = 1_800_000_000;

test("a signed session verifies until it expires", async () => {
  const token = await signSession({ id: 1234, login: "owner", exp: now + 60 }, config.secret);
  assert.deepEqual(await verifySession(token, config, now), { id: 1234, login: "owner", exp: now + 60 });
  assert.equal(await verifySession(token, config, now + 61), null);
});

test("a tampered payload, another secret or garbage does not verify", async () => {
  const token = await signSession({ id: 1234, login: "owner", exp: now + 60 }, config.secret);
  const [, sig] = token.split(".");
  const forged = `${Buffer.from(JSON.stringify({ id: 1234, login: "owner", exp: now + 999_999 })).toString("base64url")}.${sig}`;
  assert.equal(await verifySession(forged, config, now), null);
  assert.equal(await verifySession(token, { ...config, secret: "x".repeat(32) }, now), null);
  for (const junk of [undefined, "", "a", "a.b", "a.b.c", "%%%.%%%"]) assert.equal(await verifySession(junk, config, now), null);
});

test("removing a user from the allowlist ends their session", async () => {
  const token = await signSession({ id: 1234, login: "owner", exp: now + 60 }, config.secret);
  assert.equal(await verifySession(token, { ...config, allowed: ["5678"] }, now), null);
});

test("the allowlist is matched on the GitHub user ID, not the username", async () => {
  const renamed = await signSession({ id: 5678, login: "owner", exp: now + 60 }, config.secret);
  assert.equal(await verifySession(renamed, config, now), null);
  const usernameOnly = await signSession({ login: "owner", exp: now + 60 } as unknown as Session, config.secret);
  assert.equal(await verifySession(usernameOnly, config, now), null);
  const stringId = await signSession({ id: "1234", login: "owner", exp: now + 60 } as unknown as Session, config.secret);
  assert.equal(await verifySession(stringId, config, now), null);
});

test("an allowlist with usernames instead of numeric IDs is refused", () => {
  const base = { AUTH_GITHUB_CLIENT_ID: "i", AUTH_GITHUB_CLIENT_SECRET: "c", AUTH_SECRET: "s".repeat(32) };
  for (const ids of ["owner", "1234, owner", "0", "-1", "12.5"]) {
    const r = readAuthConfig({ ...base, AUTH_ALLOWED_GITHUB_IDS: ids });
    assert.equal(!r.disabled && r.config, null, ids);
  }
  const old = readAuthConfig({ ...base, AUTH_ALLOWED_GITHUB_USERS: "owner" });
  assert.equal(!old.disabled && old.config, null);
});

test("AUTH_DISABLED only works outside production, and missing settings are named", () => {
  assert.deepEqual(readAuthConfig({ AUTH_DISABLED: "true", NODE_ENV: "development" }), { disabled: true });
  const prod = readAuthConfig({ AUTH_DISABLED: "true", NODE_ENV: "production" });
  assert.equal(prod.disabled, false);
  assert.equal(!prod.disabled && prod.config, null);
  assert.deepEqual(!prod.disabled && prod.missing, ["AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET", "AUTH_SECRET (32+ characters)", "AUTH_ALLOWED_GITHUB_IDS (numeric GitHub user IDs)"]);
  const ok = readAuthConfig({ AUTH_GITHUB_CLIENT_ID: "i", AUTH_GITHUB_CLIENT_SECRET: "c", AUTH_SECRET: "s".repeat(32), AUTH_ALLOWED_GITHUB_IDS: " 1234, 5678 " });
  assert.deepEqual(!ok.disabled && ok.config?.allowed, ["1234", "5678"]);
});

test("safeNext keeps same-site paths only", () => {
  assert.equal(safeNext("/p/x?days=7"), "/p/x?days=7");
  for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example"]) assert.equal(safeNext(bad), "/");
});
