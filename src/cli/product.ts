import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  addTrackedSource,
  createProduct,
  deleteProduct,
  getProductDoc,
  listProductDocs,
  listProducts,
  listTrackedSources,
  removeTrackedSource,
  requireProduct,
  setTrackedSourceEnabled,
  upsertProductDocs,
  updateProduct,
} from "../db/products.ts";
import type { ProductDocInsert, ProductInsert, ProductUpdate } from "../db/types.ts";
import { knownSources } from "../sources/index.ts";
import { docName, PRODUCT_DOC_KINDS, type ProductDocKind } from "../lib/product-docs.ts";
import { productDocFromFile } from "./product-docs.ts";

const HELP = `Usage: pnpm product <command> [options]

Commands:
  list                                   List products
  show <id|slug>                         Show a product profile and its tracked sources
  docs list <id|slug> [--kind <kind>]    List product documents
  docs import <id|slug> --dir <folder> [--kind <kind>]
                                         Import top-level markdown files (default kind: brand)
  docs add <id|slug> --kind <kind> --file <path> [--name <n>] [--title <t>]
                                         Add or replace one product document
  docs show <id|slug> <name>             Print one document body
  docs export <id|slug> --dir <folder> [--kind <kind>]
                                         Export product documents
  create --file <profile.json>           Create a product (and its tracked sources) from JSON
  create --slug <s> --name <n> [fields]  Create a product from flags
  update <id|slug> [fields]              Update profile fields
  delete <id|slug> --yes                 Delete a product and everything linked to it
  add-source <id|slug> --source meta --kind page|keyword --value <v> [--country US] [--label <l>] [--config '{"relation":"inspiration"}']
  add-source <id|slug> --source instagram --kind account --value <handle> --country ALL --config '{"relation":"inspiration"}'
  remove-source <tracked-source-uuid>
  enable-source <tracked-source-uuid>    disable-source <tracked-source-uuid>

Profile fields (flags): --name --description --target-audience --positioning --tone
  --customer-desires "a|b|c"  --pain-points "a|b"  --competitors "a|b"   (pipe-separated lists)

JSON file shape: see examples/product.example.json
Known sources: ${knownSources().join(", ")}
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    "target-audience": { type: "string" },
    positioning: { type: "string" },
    tone: { type: "string" },
    "customer-desires": { type: "string" },
    "pain-points": { type: "string" },
    competitors: { type: "string" },
    source: { type: "string", default: "meta" },
    kind: { type: "string" },
    value: { type: "string" },
    country: { type: "string", default: "ALL" },
    label: { type: "string" },
    config: { type: "string" },
    dir: { type: "string" },
    title: { type: "string" },
    yes: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [cmd, arg, docRef, docNameRef] = positionals;

function list(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return v.split("|").map((s) => s.trim()).filter(Boolean);
}

function fieldsFromFlags(): ProductUpdate {
  const patch: ProductUpdate = {};
  if (values.name !== undefined) patch.name = values.name;
  if (values.slug !== undefined) patch.slug = values.slug;
  if (values.description !== undefined) patch.description = values.description;
  if (values["target-audience"] !== undefined) patch.target_audience = values["target-audience"];
  if (values.positioning !== undefined) patch.positioning = values.positioning;
  if (values.tone !== undefined) patch.tone = values.tone;
  const cd = list(values["customer-desires"]);
  if (cd) patch.customer_desires = cd;
  const pp = list(values["pain-points"]);
  if (pp) patch.pain_points = pp;
  const co = list(values.competitors);
  if (co) patch.competitors = co;
  return patch;
}

interface ProfileFile extends ProductInsert {
  tracked_sources?: Array<{ source?: string; kind: string; value: string; country?: string; label?: string; enabled?: boolean }>;
}

function need(v: string | undefined, what: string): string {
  if (!v) {
    console.error(`Missing ${what}\n\n${HELP}`);
    process.exit(1);
  }
  return v;
}

function productDocKind(value: string): ProductDocKind {
  if ((PRODUCT_DOC_KINDS as readonly string[]).includes(value)) return value as ProductDocKind;
  throw new Error(`--kind must be one of ${PRODUCT_DOC_KINDS.join(", ")}`);
}

async function show(ref: string) {
  const p = await requireProduct(ref);
  const sources = await listTrackedSources(p.id);
  if (values.json) {
    console.log(JSON.stringify({ ...p, tracked_sources: sources }, null, 2));
    return;
  }
  console.log(`${p.name}  [${p.slug}]  ${p.id}`);
  console.log(`  description:      ${p.description ?? "-"}`);
  console.log(`  target audience:  ${p.target_audience ?? "-"}`);
  console.log(`  positioning:      ${p.positioning ?? "-"}`);
  console.log(`  tone:             ${p.tone ?? "-"}`);
  console.log(`  customer desires: ${p.customer_desires.join(" | ") || "-"}`);
  console.log(`  pain points:      ${p.pain_points.join(" | ") || "-"}`);
  console.log(`  competitors:      ${p.competitors.join(" | ") || "-"}`);
  console.log(`  tracked sources (${sources.length}):`);
  for (const s of sources) {
    const flag = s.enabled ? " " : "x";
    console.log(`   [${flag}] ${s.id}  ${s.source} ${s.kind}=${s.value} country=${s.country}${s.label ? `  "${s.label}"` : ""}  last=${s.last_scraped_at ?? "never"}`);
  }
}

if (values.help || !cmd) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

switch (cmd) {
  case "list": {
    const ps = await listProducts();
    if (values.json) console.log(JSON.stringify(ps, null, 2));
    else for (const p of ps) console.log(`${p.id}  ${p.slug.padEnd(24)} ${p.name}`);
    if (!ps.length && !values.json) console.log("(no products)");
    break;
  }
  case "show":
    await show(need(arg, "product id or slug"));
    break;
  case "docs": {
    const action = arg;
    const product = await requireProduct(need(docRef, "product id or slug"));
    if (action === "list") {
      const kinds = values.kind === undefined ? undefined : [productDocKind(values.kind)];
      const docs = await listProductDocs(product.id, kinds);
      console.log("name\tkind\ttitle\tsort\tchars\tupdated_at");
      for (const doc of docs) {
        console.log(`${doc.name}\t${doc.kind}\t${doc.title ?? "-"}\t${doc.sort}\t${doc.body_md.length}\t${doc.updated_at}`);
      }
      if (!docs.length) console.log("(no docs)");
    } else if (action === "import") {
      const directory = need(values.dir, "--dir");
      const kind = productDocKind(values.kind ?? "brand");
      const rows: ProductDocInsert[] = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => ({
          product_id: product.id,
          ...productDocFromFile(entry.name, readFileSync(join(directory, entry.name), "utf8"), kind),
          kind,
        }))
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
      await upsertProductDocs(rows);
      for (const row of rows) console.log(row.name);
      if (!rows.length) console.log("(no markdown files)");
    } else if (action === "add") {
      const kind = productDocKind(need(values.kind, "--kind"));
      const file = need(values.file, "--file");
      const row: ProductDocInsert = {
        product_id: product.id,
        ...productDocFromFile(file, readFileSync(file, "utf8"), kind, {
          ...(values.name !== undefined ? { name: values.name } : {}),
          title: values.title,
        }),
        kind,
      };
      await upsertProductDocs([row]);
      console.log(row.name);
    } else if (action === "show") {
      const name = docName(need(docNameRef, "document name"));
      const doc = await getProductDoc(product.id, name);
      if (!doc) throw new Error(`document not found: ${name}`);
      process.stdout.write(doc.body_md);
    } else if (action === "export") {
      const directory = need(values.dir, "--dir");
      const kinds = values.kind === undefined ? undefined : [productDocKind(values.kind)];
      const docs = await listProductDocs(product.id, kinds);
      mkdirSync(directory, { recursive: true });
      for (const doc of docs) {
        if (basename(doc.name) !== doc.name || doc.name.includes("\\")) {
          throw new Error(`Cannot export invalid document name "${doc.name}"`);
        }
        let filename: string;
        if (doc.kind === "brand") {
          filename = doc.name === "readme" ? "README.md" : `${doc.name}.md`;
        } else {
          try {
            JSON.parse(doc.body_md);
            filename = `${doc.name}.json`;
          } catch {
            filename = `${doc.name}.md`;
          }
        }
        writeFileSync(join(directory, filename), doc.body_md);
      }
      console.log(`Exported ${docs.length} document(s) to ${directory}`);
    } else {
      console.error(`Unknown product docs command "${action}"\n\n${HELP}`);
      process.exit(1);
    }
    break;
  }
  case "create": {
    let input: ProductInsert;
    let sources: ProfileFile["tracked_sources"] = [];
    if (values.file) {
      const parsed = JSON.parse(readFileSync(values.file, "utf8")) as ProfileFile & Record<string, unknown>;
      // Keys starting with "_" (e.g. "_comment") are documentation, not columns.
      for (const k of Object.keys(parsed)) if (k.startsWith("_")) delete parsed[k];
      ({ tracked_sources: sources = [], ...input } = parsed);
      Object.assign(input, fieldsFromFlags());
    } else {
      input = { ...fieldsFromFlags(), slug: need(values.slug, "--slug"), name: need(values.name, "--name") };
    }
    const p = await createProduct(input);
    for (const s of sources) {
      await addTrackedSource({
        product_id: p.id,
        source: s.source ?? "meta",
        kind: s.kind,
        value: String(s.value),
        country: s.country ?? "ALL",
        label: s.label ?? null,
        enabled: s.enabled ?? true,
      });
    }
    console.log(`Created product ${p.slug} (${p.id}) with ${sources.length} tracked source(s)`);
    break;
  }
  case "update": {
    const p = await requireProduct(need(arg, "product id or slug"));
    const patch = fieldsFromFlags();
    if (!Object.keys(patch).length) {
      console.error("Nothing to update; pass at least one field flag.");
      process.exit(1);
    }
    await updateProduct(p.id, patch);
    await show(p.id);
    break;
  }
  case "delete": {
    const p = await requireProduct(need(arg, "product id or slug"));
    if (!values.yes) {
      console.error(`Refusing to delete "${p.slug}" without --yes (cascades to tracked sources, product_ads, scrape_runs).`);
      process.exit(1);
    }
    await deleteProduct(p.id);
    console.log(`Deleted ${p.slug}`);
    break;
  }
  case "add-source": {
    const p = await requireProduct(need(arg, "product id or slug"));
    const s = await addTrackedSource({
      product_id: p.id,
      source: values.source,
      kind: need(values.kind, "--kind"),
      value: need(values.value, "--value"),
      country: values.country,
      label: values.label ?? null,
      ...(values.config ? { config: JSON.parse(values.config) } : {}),
    });
    console.log(`Tracked source ${s.id}: ${s.source} ${s.kind}=${s.value} country=${s.country}`);
    break;
  }
  case "remove-source":
    await removeTrackedSource(need(arg, "tracked source id"));
    console.log("Removed");
    break;
  case "enable-source":
  case "disable-source":
    await setTrackedSourceEnabled(need(arg, "tracked source id"), cmd === "enable-source");
    console.log(cmd === "enable-source" ? "Enabled" : "Disabled");
    break;
  default:
    console.error(`Unknown command "${cmd}"\n\n${HELP}`);
    process.exit(1);
}
