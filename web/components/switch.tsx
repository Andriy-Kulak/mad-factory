"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";

/**
 * Toggle that runs a server action. Flips immediately (optimistic) and settles when the action returns;
 * the server's value wins if the action fails.
 */
export function ActionSwitch({ checked, action, label, children }: { checked: boolean; action: () => Promise<void>; label: string; children?: ReactNode }) {
  const [on, setOn] = useOptimistic(checked);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => start(async () => { setOn(!on); await action(); })}
      aria-busy={pending}
      className="switch"
    >
      <span className="switch-track" data-busy={pending || undefined} />
      {children}
    </button>
  );
}

/** Checkbox drawn as a switch, for GET filter forms. Works without JavaScript. */
export function SwitchField({ name, value = "1", defaultChecked, label, autoSubmit = false }: { name: string; value?: string; defaultChecked?: boolean; label: ReactNode; autoSubmit?: boolean }) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
        onChange={autoSubmit ? (e) => e.currentTarget.form?.requestSubmit() : undefined}
      />
      <span className="switch-track" />
      {label}
    </label>
  );
}
