import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { optionalEnv } from "./env.ts";

const R2_ACCOUNT_ID = optionalEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = optionalEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = optionalEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = optionalEnv("R2_BUCKET");
const R2_PUBLIC_URL = optionalEnv("R2_PUBLIC_URL");

export const r2Enabled = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);

const s3 = r2Enabled
  ? new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY! },
    })
  : null;

const LOCAL_DIR = join("data", "media");

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Media URLs come from third-party payloads (ScrapeCreators, Graph, Playwright), so download() only
// fetches https URLs on public addresses, checks every redirect hop, and caps time and size.
// Separate lists: one BlockList with an ::ffff:0:0/96 rule would also match every IPv4 address.
const BLOCKED_IPV4 = new BlockList();
const BLOCKED_IPV6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_IPV4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 127],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_IPV6.addSubnet(net, prefix, "ipv6");
}

/** True for loopback, private, link-local (cloud metadata), CGNAT, multicast and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 4 ? BLOCKED_IPV4.check(address, "ipv4") : BLOCKED_IPV6.check(address, "ipv6");
}

/** Resolves like dns.lookup but fails when any resolved address is not public, so the socket can't reach one. */
const publicOnlyLookup = ((hostname: string, options: LookupOptions, callback: LookupCallback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const first = addresses[0];
    if (!first || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new Error(`download blocked: ${hostname} resolves to a non-public address`), "", 0);
    }
    if (options.all) return (callback as unknown as LookupAllCallback)(null, addresses);
    callback(null, first.address, first.family);
  });
}) as unknown as typeof dnsLookup;

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string, family: number) => void;
type LookupAllCallback = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("download blocked: invalid URL");
  }
  if (url.protocol !== "https:") throw new Error(`download blocked: ${url.protocol} URL (https only)`);
  if (url.username || url.password) throw new Error("download blocked: URL with credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new Error(`download blocked: non-public address ${host}`);
  return url;
}

export interface DownloadOptions {
  /** Largest body accepted, in bytes. Default 300 MB. */
  maxBytes?: number;
  /** Total time for the download including redirects, in ms. Default 120 s. */
  timeoutMs?: number;
}

const MAX_REDIRECTS = 5;

/** Download a CDN URL directly (no proxy; signed URLs expire quickly). https and public hosts only. */
export async function download(url: string, options: DownloadOptions = {}): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchCapped(url, options.maxBytes ?? 300 * 1024 * 1024, signal);
  } catch (error) {
    if (signal.aborted) throw new Error(`download timed out after ${timeoutMs} ms ${url}`);
    throw error;
  }
}

async function fetchCapped(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  let current = checkUrl(url);
  for (let hop = 0; ; hop++) {
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpsRequest(current, { method: "GET", lookup: publicOnlyLookup, signal }, resolve);
      req.on("error", reject);
      req.end();
    });
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop >= MAX_REDIRECTS) throw new Error(`download: too many redirects ${url}`);
      current = checkUrl(new URL(res.headers.location, current).toString());
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new Error(`download ${status} ${url}`);
    }
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new Error(`download too large (${declared} bytes > ${maxBytes}) ${url}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy();
        throw new Error(`download too large (> ${maxBytes} bytes) ${url}`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

export interface StoredObject {
  storageKey: string;
  publicUrl: string | null;
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Store bytes under a content-addressed key (`<prefix>/<sha256>.<ext>`). Idempotent. */
export async function store(hash: string, buf: Buffer, ext = "mp4", prefix = "videos"): Promise<StoredObject> {
  const storageKey = `${prefix}/${hash}.${ext}`;

  if (!s3) {
    mkdirSync(join(LOCAL_DIR, prefix), { recursive: true });
    const path = join(LOCAL_DIR, storageKey);
    if (!existsSync(path)) writeFileSync(path, buf);
    return { storageKey: path, publicUrl: null };
  }

  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
  } catch {
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: buf,
        ContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      }),
    );
  }
  return {
    storageKey,
    publicUrl: R2_PUBLIC_URL ? `${R2_PUBLIC_URL.replace(/\/$/, "")}/${storageKey}` : null,
  };
}
