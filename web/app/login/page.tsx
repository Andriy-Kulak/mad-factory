import { readAuthConfig, safeNext } from "@/lib/auth/session";
import { buttonClass, ButtonLink, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  config: "Sign-in is not configured on the server yet.",
  denied: "GitHub sign-in was cancelled.",
  state: "The sign-in link expired. Try again.",
  github: "GitHub did not confirm who you are. Try again.",
  not_allowed: "That GitHub account is not allowed here.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const auth = readAuthConfig();
  const error = sp.error ? ERRORS[sp.error] ?? "Sign-in failed. Try again." : !auth.disabled && !auth.config ? ERRORS.config : null;
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-12 shrink-0 flex items-center px-4 bg-chrome border-b border-chrome-line text-[13px] font-semibold text-chrome-fg">mad-factory</div>
      <main className="flex-1 grid place-items-center p-4">
        <Card className="w-full max-w-sm p-6">
          <h1 className="text-[15px] font-semibold">Sign in</h1>
          <p className="text-fg-2 text-[13px] mt-1.5 leading-relaxed">
            {auth.disabled ? "Sign-in is off for local development (AUTH_DISABLED)." : "Use the GitHub account that owns this workspace."}
          </p>
          {error && <p className="text-[13px] mt-4 px-3 py-2 rounded-[3px] bg-danger-soft text-danger" role="alert">{error}</p>}
          <div className="mt-5">
            {auth.disabled ? (
              <ButtonLink href={next} primary>Continue</ButtonLink>
            ) : (
              // A plain <a>, not next/link: a prefetch of this route would start an OAuth round trip.
              <a href={`/api/auth/github?next=${encodeURIComponent(next)}`} className={buttonClass("primary", "md", "w-full")}>Sign in with GitHub</a>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
