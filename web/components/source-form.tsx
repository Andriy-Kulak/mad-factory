"use client";

import { useActionState, type ReactNode } from "react";
import type { SourceFormState } from "@/lib/source-actions";

/** Add-source form: server-rendered inputs as children, inline result message. */
export function SourceForm({ action, submitLabel, children }: { action: (prev: SourceFormState, form: FormData) => Promise<SourceFormState>; submitLabel: string; children: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {children}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Adding…" : submitLabel}
      </button>
      {state?.error && (
        <span role="alert" className="text-danger text-[13px] w-full">
          {state.error}
        </span>
      )}
      {state?.ok && (
        <span role="status" className="text-good text-[13px] w-full">
          {state.ok}
        </span>
      )}
    </form>
  );
}
