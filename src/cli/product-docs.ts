import { basename } from "node:path";
import { docName, type ProductDocKind } from "../lib/product-docs.ts";

export interface ProductDocFile {
  name: string;
  title: string | null;
  sort: number;
  body_md: string;
}

export function docFromFile(filename: string, markdown: string): ProductDocFile {
  const file = basename(filename);
  const stem = file.endsWith(".md") ? file.slice(0, -3) : file;
  const title = markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() || null;
  if (file === "README.md") {
    return {
      name: "readme",
      title,
      sort: 0,
      body_md: markdown,
    };
  }
  const numbered = /^(\d+)-(.+)$/.exec(stem);
  return {
    name: numbered?.[2] ?? stem,
    title,
    sort: numbered ? Number(numbered[1]) : 100,
    body_md: markdown,
  };
}

export function productDocFromFile(filename: string, markdown: string, kind: ProductDocKind, overrides: { name?: string; title?: string } = {}): ProductDocFile {
  const parsed =
    kind === "brand"
      ? docFromFile(filename, markdown)
      : {
          name: docName(filename),
          title: markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() || null,
          sort: kind === "research" ? 100 : 0,
          body_md: markdown,
        };
  return {
    ...parsed,
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
  };
}
