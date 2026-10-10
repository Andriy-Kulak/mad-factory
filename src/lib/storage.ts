import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
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

/** Download a CDN URL directly (no proxy; signed URLs expire quickly). */
export async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
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
