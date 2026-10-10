import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AppleAdsClient, buildClientSecret, isWrite, normalizePem, type AppleAdsCredentials } from "./client.ts";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const creds: AppleAdsCredentials = {
  clientId: "client",
  teamId: "team",
  keyId: "key",
  privateKeyPem: privateKey.export({ type: "sec1", format: "pem" }).toString(),
};

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
    seen.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
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
