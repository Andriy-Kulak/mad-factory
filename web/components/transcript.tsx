"use client";

import { useEffect, useRef, useState } from "react";

const cache = new Map<string, string | null>();

/** "Transcript" block in a preview: loads on open, cached per id while the page is open. */
export function Transcript({
  id,
  load,
  transcribe,
}: {
  id: string | null;
  load: (id: string) => Promise<string | null>;
  /** When set, an untranscribed video gets a "Transcribe" button. */
  transcribe?: (id: string) => Promise<{ transcript: string } | { error: string }>;
}) {
  const [state, setState] = useState<{ id: string; text: string | null } | "error" | null>(() => (id && cache.has(id) ? { id, text: cache.get(id)! } : null));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const current = useRef(id);

  useEffect(() => {
    current.current = id;
    setCopied(false);
    setBusy(false);
    setFailure(null);
    if (!id) return;
    if (cache.has(id)) {
      setState({ id, text: cache.get(id)! });
      return;
    }
    let live = true;
    setState(null);
    load(id).then(
      (text) => {
        cache.set(id, text);
        if (live) setState({ id, text });
      },
      () => live && setState("error"),
    );
    return () => { live = false; };
  }, [id, load]);
  const text = state && state !== "error" && state.id === id ? state.text : null;
  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => setCopied(true), () => {});
  };
  const run = () => {
    if (!id || !transcribe) return;
    const target = id;
    setBusy(true);
    setFailure(null);
    transcribe(target)
      .then(
        (r) => {
          if ("error" in r) return current.current === target && setFailure(r.error);
          cache.set(target, r.transcript);
          if (current.current === target) setState({ id: target, text: r.transcript });
        },
        () => current.current === target && setFailure("Transcription failed. Try again."),
      )
      .finally(() => current.current === target && setBusy(false));
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="label">Transcript</div>
        {text && <button type="button" onClick={copy} className="btn btn-ghost btn-sm !h-6 !px-1.5 text-[12px] ml-auto">{copied ? "Copied" : "Copy"}</button>}
      </div>
      {!id ? <p className="text-[13px] text-fg-3">No video stored.</p>
        : state === "error" ? <p className="text-[13px] text-danger">Couldn't load the transcript.</p>
        : state === null || state.id !== id ? <p className="text-[13px] text-fg-3">Loading…</p>
        : text === "" ? <p className="text-[13px] text-fg-3">No speech in this video.</p>
           : text ? <p className="text-[14px] leading-relaxed whitespace-pre-line break-words">{text}</p>
        : (
             <div className="flex items-center gap-2">
               <p className="text-[13px] text-fg-3">Not transcribed yet.</p>
               {transcribe && (
                 <button type="button" onClick={run} disabled={busy} className="btn btn-sm">
                   {busy ? "Transcribing…" : "Transcribe"}
                 </button>
               )}
             </div>
           )}
      {failure && <p className="text-[13px] text-danger mt-1">{failure}</p>}
    </div>
  );
}
