import assert from "node:assert/strict";
import { test } from "node:test";
import { download, isBlockedAddress } from "./storage.ts";

test("non-public addresses are blocked, public ones are not", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
    assert.equal(isBlockedAddress(a), true, a);
  }
  for (const a of ["::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
    assert.equal(isBlockedAddress(a), true, a);
  }
  assert.equal(isBlockedAddress("not-an-ip"), true);
  for (const a of ["8.8.8.8", "157.240.1.1", "2a03:2880:f12f:83:face:b00c:0:25de"]) {
    assert.equal(isBlockedAddress(a), false, a);
  }
});

test("download rejects non-https, credentials and non-public hosts before any request", async () => {
  await assert.rejects(download("http://example.com/a.mp4"), /https only/);
  await assert.rejects(download("file:///etc/passwd"), /https only/);
  await assert.rejects(download("not a url"), /invalid URL/);
  await assert.rejects(download("https://user:pw@example.com/a.mp4"), /credentials/);
  await assert.rejects(download("https://169.254.169.254/latest/meta-data/"), /non-public address/);
  await assert.rejects(download("https://127.0.0.1:8443/x"), /non-public address/);
  await assert.rejects(download("https://[::1]/x"), /non-public address/);
  await assert.rejects(download("https://[::ffff:a9fe:a9fe]/x"), /non-public address/);
});

test("download refuses hostnames that resolve to loopback", async () => {
  await assert.rejects(download("https://localhost/x"), /non-public address/);
});
