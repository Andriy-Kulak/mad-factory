import type { ReactNode } from "react";

/** Page header + content inside the product frame (app/p/[slug]/layout.tsx). Content settles in on navigation. */
export function Shell({ title, subtitle, action, tabs, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="px-4 sm:px-6 pt-6 pb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
          {subtitle && <div className="text-fg-3 text-[13px] mt-1">{subtitle}</div>}
        </div>
        {action}
      </header>
      {tabs && <div className="px-4 sm:px-6 -mt-1 mb-5">{tabs}</div>}
      <main className="px-4 sm:px-6 pb-12 enter">{children}</main>
    </>
  );
}
