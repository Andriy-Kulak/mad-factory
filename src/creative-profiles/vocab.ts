import { listProductDocs } from "../db/products.ts";
import type { ProductVocab, VocabAngle, VocabAudience } from "./prompt.ts";

/** Load a product's angle/audience/desire vocabulary from its brand docs. */

const kebab = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function parseAudiences(markdown: string): { letter: string; slug: string; name: string }[] {
  const audiences: { letter: string; slug: string; name: string }[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^## ([A-Z])\. (.+)$/.exec(line.trim());
    if (match) {
      const name = match[2]!.replace(/\s*\([^)]*\)\s*$/, "");
      audiences.push({ letter: match[1]!.toLowerCase(), slug: kebab(name), name });
    }
  }
  return audiences;
}

/** Column meaning from a table header cell, matched case-insensitively. */
function angleColumn(header: string): keyof VocabAngle | "name" | null {
  const name = header.trim().toLowerCase();
  if (name === "angle") return "name";
  if (name === "audience" || name === "audiences") return "audiences";
  if (name === "desire" || name === "desires") return "desires";
  if (name === "promise") return "promise";
  if (name === "not this") return "not";
  if (name.startsWith("example") || name === "hook ideas") return "examples";
  return null;
}

export function parseAngles(markdown: string): VocabAngle[] {
  const lines = markdown.split("\n");
  const isRow = (line: string) => line.trim().startsWith("|");
  const cells = (line: string) =>
    line
      .trim()
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  // Find the table header row (the row with an Angle column), then the columns' meaning.
  const angles: VocabAngle[] = [];
  let columns: ReturnType<typeof angleColumn>[] | null = null;
  for (const line of lines) {
    if (!isRow(line)) continue;
    const row = cells(line);
    if (columns === null) {
      if (!row.some((cell) => angleColumn(cell) === "name")) continue;
      columns = row.map(angleColumn);
      continue;
    }
    if (row.every((cell) => /^:?-+:?$/.test(cell))) continue; // --- separator
    const name = /^\*\*(.+)\*\*$/.exec(row[0] ?? "")?.[1];
    if (!name) continue;
    const angle: VocabAngle = { slug: kebab(name), name, audiences: [], desires: [] };
    for (const [i, column] of columns.entries()) {
      const value = row[i] ?? "";
      if (column === "audiences") {
        angle.audiences = value
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter(Boolean);
      } else if (column === "desires") {
        angle.desires = value
          .split(",")
          .map((d) => kebab(d))
          .filter(Boolean);
      } else if (column === "promise" && value) {
        angle.promise = value;
      } else if (column === "not" && value && value !== "—") {
        angle.not = value;
      } else if (column === "examples" && value) {
        angle.examples = value;
      }
    }
    angles.push(angle);
  }
  return angles;
}

export function vocabFromDocs(docs: { name: string; body_md: string }[]): ProductVocab {
  const audiencesMd = docs.find((doc) => doc.name === "audiences")?.body_md ?? null;
  const libraryMd = docs.find((doc) => doc.name === "angle-library")?.body_md ?? null;
  const anglesMd = docs.find((doc) => doc.name === "angles")?.body_md ?? null;
  const parsed = audiencesMd === null ? [] : parseAudiences(audiencesMd);
  const library = libraryMd !== null;
  const sourceMd = libraryMd ?? anglesMd;
  const angles = sourceMd === null ? [] : parseAngles(sourceMd);
  // Angle table cells hold letters ("A, B"); map them to the audience's kebab slug.
  const slugByLetter = new Map(parsed.map((audience) => [audience.letter, audience.slug]));
  for (const angle of angles) {
    angle.audiences = angle.audiences.map((letter) => slugByLetter.get(letter) ?? letter);
  }
  const audiences: VocabAudience[] = parsed.map(({ slug, name }) => ({ slug, name }));
  const desires = [...new Set(angles.flatMap((angle) => angle.desires))].sort();
  return { angles, audiences, desires, library };
}

export async function loadProductVocab(productId: string): Promise<ProductVocab> {
  return vocabFromDocs(await listProductDocs(productId));
}

/**
 * With a loaded angle library the angle must be one of its slugs or "other";
 * without one there is no check. Returns the problem message or null.
 */
export function angleProblem(angle: string | null, vocab: ProductVocab): string | null {
  if (!vocab.library) return null;
  const allowed = vocab.angles.map((angle) => angle.slug);
  if (angle !== null && (angle === "other" || allowed.includes(angle))) return null;
  return `strategy.angle must be one of the angle library slugs (${allowed.join(", ")}) or "other"`;
}
