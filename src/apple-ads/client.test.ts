import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AppleAdsClient, buildClientSecret, isWrite, loadCredentials, normalizePem, type AppleAdsCredentials } from "./client.ts";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const creds: AppleAdsCredentials = {
  clientId: "client",
  teamId: "team",
  keyId: "key",
  privateKeyPem: privateKey.export({ type: "sec1", format: "pem" }).toString(),
  access: "read",
};

const APPLE_ENV = [
  "APPLE_ADS_READ_DIR",
  "APPLE_ADS_READ_CLIENT_ID",
  "APPLE_ADS_READ_TEAM_ID",
  "APPLE_ADS_READ_KEY_ID",
  "APPLE_ADS_READ_PRIVATE_KEY",
  "APPLE_ADS_WRITE_DIR",
  "APPLE_ADS_WRITE_CLIENT_ID",
  "APPLE_ADS_WRITE_TEAM_ID",
  "APPLE_ADS_WRITE_KEY_ID",
  "APPLE_ADS_WRITE_PRIVATE_KEY",
  "APPLE_ADS_DIR",
  "APPLE_ADS_CLIENT_ID",
  "APPLE_ADS_TEAM_ID",
  "APPLE_ADS_KEY_ID",
  "APPLE_ADS_PRIVATE_KEY",
] as const;

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const keys = new Set([...APPLE_ENV, ...Object.keys(values)]);
  const previous = Object.fromEntries([...keys].map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("client secret is a verifiable ES256 JWT with Apple's claims", () => {
  const [h, p, s] = buildClientSecret(creds, 1000).split(".") as [string, string, string];
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "key" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString()), { iss: "team", sub: "client", aud: "https://appleid.apple.com", iat: 1000, exp: 4600 });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("normalizePem restores a flattened or escaped PEM so it signs", () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "sec1", format: "pem" }) as string;
  const flattened = pem.replace(/\n/g, " ");
  const escaped = pem.replace(/\n/g, "\\n");
  for (const variant of [pem, flattened, escaped]) {
    const restored = normalizePem(variant);
    assert.doesNotThrow(() => crypto.createPrivateKey(restored));
  }
  assert.equal(normalizePem(flattened), pem);
  assert.equal(normalizePem("not a pem"), "not a pem");
});

test("isWrite treats POST …/query as a read", () => {
  assert.equal(isWrite("POST", "/campaigns/query"), false);
  assert.equal(isWrite("POST", "/reports/apps/keywords/query"), false);
  assert.equal(isWrite("GET", "/campaigns/1"), false);
  assert.equal(isWrite("POST", "/keywords/bulk-create"), true);
  assert.equal(isWrite("PUT", "/keywords/1"), true);
  assert.equal(isWrite("DELETE", "/campaigns/1"), true);
});

function stubFetch(pages: unknown[][]) {
  const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("appleid.apple.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    seen.push({ url: String(url), headers: init!.headers as Record<string, string>, body: init!.body === undefined ? undefined : JSON.parse(String(init!.body)) });
    return new Response(JSON.stringify({ result: pages[seen.length - 1] ?? [] }), { headers: { "ratelimit-remaining": "150" } });
  }) as typeof fetch;
  return { fn, seen };
}

test("queryAll pages until a short page and sends the account header", async () => {
  const { fn, seen } = stubFetch([[1, 2], [3]]);
  const client = new AppleAdsClient(creds, fn);
  assert.deepEqual(await client.queryAll<number>(99, "/campaigns/query", {}, 2), [1, 2, 3]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.headers["X-AP-Context"], "adAccountId=99");
  assert.equal(seen[0]!.headers.Authorization, "Bearer tok");
  assert.deepEqual(seen[1]!.body, { pagination: { offset: 2, pageSize: 2 } });
  assert.equal(client.rateLimitRemaining, 150);
});

test("read refuses write calls", async () => {
  const client = new AppleAdsClient(creds, stubFetch([]).fn);
  await assert.rejects(client.read(1, "POST", "/keywords/bulk-create", {}), /refused a write/);
});

test("loadCredentials read prefers APPLE_ADS_READ_* over the legacy names", () =>
  withEnv(
    {
      APPLE_ADS_READ_CLIENT_ID: "read-client",
      APPLE_ADS_READ_TEAM_ID: "read-team",
      APPLE_ADS_READ_KEY_ID: "read-key",
      APPLE_ADS_READ_PRIVATE_KEY: creds.privateKeyPem,
      APPLE_ADS_CLIENT_ID: "legacy-client",
      APPLE_ADS_TEAM_ID: "legacy-team",
      APPLE_ADS_KEY_ID: "legacy-key",
      APPLE_ADS_PRIVATE_KEY: creds.privateKeyPem,
    },
    () => {
      const loaded = loadCredentials();
      assert.equal(loaded.clientId, "read-client");
      assert.equal(loaded.access, "read");
    },
  ));

test("loadCredentials read falls back to the legacy APPLE_ADS_* names", () =>
  withEnv(
    {
      APPLE_ADS_CLIENT_ID: "legacy-client",
      APPLE_ADS_TEAM_ID: "legacy-team",
      APPLE_ADS_KEY_ID: "legacy-key",
      APPLE_ADS_PRIVATE_KEY: creds.privateKeyPem,
    },
    () => {
      const loaded = loadCredentials();
      assert.equal(loaded.clientId, "legacy-client");
      assert.equal(loaded.access, "read");
    },
  ));

test("loadCredentials write ignores the legacy names and needs APPLE_ADS_WRITE_*", () =>
  withEnv(
    {
      APPLE_ADS_CLIENT_ID: "legacy-client",
      APPLE_ADS_TEAM_ID: "legacy-team",
      APPLE_ADS_KEY_ID: "legacy-key",
      APPLE_ADS_PRIVATE_KEY: creds.privateKeyPem,
    },
    () => {
      assert.throws(() => loadCredentials("write"), /APPLE_ADS_WRITE_DIR or the APPLE_ADS_WRITE_\* variables/);
    },
  ));

test("a read-credentials client refuses PUT, DELETE and non-/query POSTs with zero fetches", async () => {
  let fetches = 0;
  const client = new AppleAdsClient(creds, (async () => {
    fetches++;
    return new Response("{}");
  }) as typeof fetch);
  for (const [method, apiPath] of [
    ["PUT", "/keywords/1"],
    ["DELETE", "/campaigns/1"],
    ["POST", "/keywords/bulk-create"],
  ] as const) {
    await assert.rejects(client.call(1, method, apiPath), /write blocked: this client has read credentials/);
  }
  assert.equal(fetches, 0);
  assert.equal(client.calls, 0);
});

test("a read-credentials client may GET and POST to /query", async () => {
  const { fn, seen } = stubFetch([[1], []]);
  const client = new AppleAdsClient(creds, fn);
  await client.call(1, "GET", "/campaigns");
  await client.call(1, "POST", "/campaigns/query", {});
  assert.equal(seen.length, 2);
});

test("a write-credentials client may PUT", async () => {
  const { fn, seen } = stubFetch([[]]);
  const client = new AppleAdsClient({ ...creds, access: "write" }, fn);
  await client.call(1, "PUT", "/keywords/1", {});
  assert.equal(seen.length, 1);
});
