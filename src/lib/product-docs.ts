import { basename } from "node:path";

export const PRODUCT_DOC_KINDS = ["brand", "research", "plan", "writeup"] as const;
export type ProductDocKind = (typeof PRODUCT_DOC_KINDS)[number];

export function docName(ref: string): string {
  return basename(ref).replace(/\.(?:md|json)$/i, "");
}
