import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BrandDoc } from "@/lib/brand";

function textContent(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return textContent(children.props.children);
  return "";
}

function headingId(children: ReactNode): string {
  return textContent(children).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function BrandMarkdown({ slug, document, docs }: { slug: string; document: BrandDoc; docs: BrandDoc[] }) {
  const docNames = new Set(docs.map((doc) => doc.name));

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="max-w-[80ch] mt-1 mb-5 text-2xl sm:text-3xl leading-tight font-semibold tracking-tight">{children}</h1>,
        h2: ({ children }) => <h2 id={headingId(children)} className="max-w-[80ch] mt-8 mb-3 scroll-mt-4 text-xl leading-tight font-semibold tracking-tight">{children}</h2>,
        h3: ({ children }) => <h3 id={headingId(children)} className="max-w-[80ch] mt-6 mb-2 scroll-mt-4 text-base font-semibold">{children}</h3>,
        p: ({ children }) => <p className="max-w-[80ch] my-3 leading-7 text-fg-2">{children}</p>,
        ul: ({ children }) => <ul className="max-w-[80ch] my-3 list-disc space-y-1 pl-6 marker:text-fg-3">{children}</ul>,
        ol: ({ children }) => <ol className="max-w-[80ch] my-3 list-decimal space-y-1 pl-6 marker:text-fg-3">{children}</ol>,
        li: ({ children }) => <li className="pl-1 leading-7 text-fg-2">{children}</li>,
        table: ({ children }) => (
          <div className="my-5 w-full overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-bg-3">{children}</thead>,
        th: ({ children }) => <th className="min-w-[9rem] break-words border border-line px-3 py-2 text-left align-top leading-5 font-semibold">{children}</th>,
        td: ({ children }) => <td className="min-w-[9rem] break-words border border-line px-3 py-2 align-top leading-5 text-fg-2">{children}</td>,
        code: ({ children }) => <code className="num rounded border border-line bg-bg-3 px-1 py-0.5 text-[0.85em] text-fg">{children}</code>,
        pre: ({ children }) => (
          <pre className="num my-4 max-w-[80ch] overflow-x-auto rounded-xl border border-line bg-bg-3 p-4 text-xs leading-6 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => <blockquote className="my-5 max-w-[80ch] border-l-2 border-line-2 pl-4 text-fg-2">{children}</blockquote>,
        hr: () => <hr className="my-7 border-0 border-t border-line" />,
        strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
        a: ({ href, children }) => {
          if (href && /^https?:\/\//i.test(href)) {
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{children}</a>;
          }

          const sibling = href?.match(/^(?:\.\/)?([^/?#]+\.md)(#[^?]*)?$/);
          const name = sibling?.[1].slice(0, -3);
          if (name && docNames.has(name)) {
            return (
              <Link href={`/p/${slug}/brand?doc=${encodeURIComponent(name)}${sibling?.[2] ?? ""}`} className="text-accent underline underline-offset-2">
                {children}
              </Link>
            );
          }

          return <code className="num rounded border border-line bg-bg-3 px-1 py-0.5 text-[0.85em] text-fg">{children}</code>;
        },
      }}
    >
      {document.markdown}
    </ReactMarkdown>
  );
}
