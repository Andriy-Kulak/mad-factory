"use client";

import { useState } from "react";
import { ActiveFilters, BrowseLayout, Chips, FilterSection, Modal, MultiSelect, NoMatches, RangeFilter, ResultsBar, SearchInput, Toggle } from "@/components/controls";
import { Card } from "@/components/ui";

/** Live demo of components/controls.tsx with placeholder data. */
export function BrowseDemo() {
  const [sort, setSort] = useState("top");
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [open, setOpen] = useState(false);
  const options = ["Example page", "Another page", "Third page", "Fourth page"].map((name, i) => ({ value: String(i), label: name, detail: `${(i + 1) * 12} items` }));
  const reset = () => { setPicked([]); setQ(""); setStatus(""); setRange({ min: null, max: null }); };
  const count = [picked.length > 0, !!q, !!status, range.min != null || range.max != null].filter(Boolean).length;
  return (
    <BrowseLayout count={count} onReset={reset}
      filters={
        <>
          <FilterSection label="MultiSelect"><MultiSelect options={options} selected={picked} onChange={setPicked} allLabel="All pages" noun="pages" /></FilterSection>
          <FilterSection label="SearchInput" hint="press /"><SearchInput value={q} onChange={setQ} placeholder="Search copy" label="Search copy" /></FilterSection>
          <FilterSection label="Chips"><Chips items={[{ key: "", label: "All" }, { key: "on", label: "Running" }, { key: "off", label: "Ended" }]} active={status} onChange={setStatus} /></FilterSection>
          <FilterSection label="RangeFilter"><RangeFilter label="Views" value={range} onChange={setRange} presets={[1000, 10000]} fmt={(v) => `${v / 1000}K`} parse={(s) => (s.trim() ? Number(s) : null)} /></FilterSection>
        </>
      }>
      <ResultsBar shown={12} total={48} noun={["item", "items"]}>
        <Toggle label="Sort" items={[{ key: "top", label: "Top" }, { key: "new", label: "Newest" }]} active={sort} onChange={setSort} />
      </ResultsBar>
      <ActiveFilters onClear={reset} filters={[
        ...picked.map((v) => ({ key: v, label: options[Number(v)]!.label, remove: () => setPicked(picked.filter((p) => p !== v)) })),
        ...(q ? [{ key: "q", label: `“${q}”`, remove: () => setQ("") }] : []),
        ...(status ? [{ key: "s", label: status === "on" ? "Running" : "Ended", remove: () => setStatus("") }] : []),
      ]} />
      <Card className="p-5 flex flex-wrap items-center gap-3 mb-3">
        <button type="button" className="btn" onClick={() => setOpen(true)}>Open Modal</button>
        <span className="text-[13px] text-fg-3">Esc, the × or a backdrop click closes it; ← → call onPrev/onNext.</span>
      </Card>
      <NoMatches onClear={reset}>NoMatches: say what is missing, offer the way out.</NoMatches>
      <Modal open={open} onClose={() => setOpen(false)} onPrev={() => {}} onNext={null} position="1 / 2" label="Demo" header={<span className="font-semibold">Modal header</span>}>
        <div className="p-6 text-[14px] text-fg-2">Body content. Media on the left and details on the right is the pattern used by post and ad previews.</div>
      </Modal>
    </BrowseLayout>
  );
}
