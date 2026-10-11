import Link from "next/link";
import { readAuthConfig } from "@/lib/auth/session";
import { Badge, Card } from "@/components/ui";
import { envHint, INTEGRATIONS, integrationStatus, type Integration } from "../../../src/lib/integrations.ts";

export const dynamic = "force-dynamic";

/**
 * Which keys this server has (names only, never values) and how to add the rest. The proxy sends every page here
 * while Supabase or sign-in is missing; then only the web host's own keys are listed, since nobody is signed in.
 */
export default function Setup() {
  const auth = readAuthConfig();
  const full = auth.disabled || auth.config != null;
  const db = integrationStatus("supabase").configured;
  const web = INTEGRATIONS.filter((it) => it.where !== "cli");
  const cli = INTEGRATIONS.filter((it) => it.where === "cli");
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-12 shrink-0 flex items-center px-4 bg-chrome border-b border-chrome-line text-[13px] font-semibold text-chrome-fg">
        <Link href="/" className="hover:text-signal transition-colors duration-200">Mad Factory</Link>
      </div>
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 enter">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em]">Setup</h1>
        <p className="text-fg-3 text-[13px] mt-1">Which keys this server has. Only names are shown, never values. Only Supabase is required; every other key turns on one feature.</p>

        {!db && <FirstSteps />}

        <h2 className="text-[15px] font-semibold mt-8 mb-2">This web server</h2>
        <Card className="divide-y divide-line-2">
          {web.map((it) => <Row key={it.key} it={it} missingTone="red" />)}
        </Card>
        {!auth.disabled && !auth.config && (
          <p className="text-[12px] text-fg-3 mt-2">Running locally? AUTH_DISABLED=true in .env skips sign-in for <code className="num">pnpm web</code> only.</p>
        )}

        {full && (
          <>
            <h2 className="text-[15px] font-semibold mt-8 mb-1">Syncs and analysis</h2>
            <p className="text-[13px] text-fg-2 mb-2">
              These keys belong on the machine that runs the commands; run <code className="num">pnpm doctor</code> there to check them. A hosted web
              server only reads the database, so “not on this server” is expected there, and it should never hold ad-account keys.
            </p>
            <Card className="divide-y divide-line-2">
              {cli.map((it) => <Row key={it.key} it={it} missingTone="neutral" />)}
            </Card>
          </>
        )}

        {db && full && <Link href="/" className="btn mt-8">Open the app →</Link>}
      </main>
    </div>
  );
}

/** The registry writes commands in backticks; show them as code. */
const code = (text: string) => text.split("`").map((part, i) => (i % 2 ? <code key={i} className="num text-[12px]">{part}</code> : part));

function Row({ it, missingTone }: { it: Integration; missingTone: "red" | "neutral" }) {
  const { configured, missing } = integrationStatus(it.key);
  const tone = it.required ? "red" : missingTone;
  return (
    <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{it.name}</span>
          {it.required && <span className="text-[11px] text-fg-3">required</span>}
        </div>
        <p className="text-[13px] text-fg-2 mt-0.5">{code(it.enables)}</p>
        {!configured && (
          <>
            <p className="text-[12px] text-fg-3 mt-1">Without it: {code(it.without)}</p>
            <p className="text-[12px] text-fg-3 mt-1">Set <span className="num text-fg-2">{envHint(it)}</span>. {it.setup}.</p>
          </>
        )}
      </div>
      <div className="shrink-0">
        {configured
          ? <Badge tone="green">set</Badge>
          : <span title={`Missing: ${missing.join(", ")}`}><Badge tone={tone}>{tone === "red" ? "missing" : "not on this server"}</Badge></span>}
      </div>
    </div>
  );
}

function FirstSteps() {
  const steps: { text: string; cmd?: string }[] = [
    { text: "Create a Supabase project (the free plan is enough) and copy its project URL and service_role key." },
    { text: "Put them in .env at the repository root as SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", cmd: "cp .env.example .env" },
    { text: "Create the tables (needs SUPABASE_DB_URL, or use `supabase db push`).", cmd: "pnpm db:migrate" },
    { text: "Create your first product.", cmd: "pnpm product create --file examples/product.example.json" },
    { text: "Restart the web app and reload this page.", cmd: "pnpm web" },
  ];
  return (
    <Card className="p-5 mt-6">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Connect a database first</h2>
        <Badge tone="red">Supabase missing</Badge>
      </div>
      <ol className="mt-3 flex flex-col gap-3 list-decimal pl-5 text-[13px]">
        {steps.map((s) => (
          <li key={s.text}>
            <span className="text-fg-2">{s.text}</span>
            {s.cmd && <pre className="num text-[11px] bg-bg border border-line rounded-[3px] px-2 py-1 mt-1 overflow-x-auto">{s.cmd}</pre>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
