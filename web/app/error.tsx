"use client";

import Link from "next/link";
import { Button, Card } from "@/components/ui";

/** Any page that throws lands here instead of Next's bare error screen. Details stay in the server log. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-[60vh] grid place-items-center p-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-[15px] font-semibold">This page could not load</h1>
        <p className="text-fg-2 text-[13px] mt-1.5 leading-relaxed">
          Usually a missing key or a database that is not reachable or migrated. The server log has the details
          {error.digest && <> (look for <code className="num">{error.digest}</code>)</>}.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={reset}>Try again</Button>
          <Link href="/setup" className="btn">Check setup</Link>
        </div>
      </Card>
    </main>
  );
}
