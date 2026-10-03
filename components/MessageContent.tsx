'use client';

import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type Citation = { n: number; url: string; title?: string };

/** Internal link scheme for citation markers; never reaches the DOM. */
const CITE = 'cite:';

/**
 * Turns `[3]` / `[1, 4]` markers into citation links the renderer can style.
 * Numbers without a known source are dropped rather than left dangling. The
 * lookbehind skips things like `arr[0]`, and `(?!\()` skips real Markdown links.
 */
function linkCitations(text: string, known: Map<number, Citation>): string {
  return text.replace(/(?<![\w\]])\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (_match, list: string) =>
    list
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((n) => known.has(n))
      .map((n) => `[${n}](${CITE}${n})`)
      .join(''),
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Renders an assistant reply as Markdown (raw HTML in model output is ignored).
 * Pass `citations` for searched replies: markers become numbered links to their
 * source, and the sources actually cited are listed under the reply.
 */
export default function MessageContent({
  content,
  citations,
}: {
  content: string;
  citations?: Citation[];
}) {
  const byNumber = new Map((citations ?? []).map((citation) => [citation.n, citation]));
  const text = citations ? linkCitations(content, byNumber) : content;
  const cited = [...new Set([...text.matchAll(/\]\(cite:(\d+)\)/g)].map((m) => Number(m[1])))]
    .sort((a, b) => a - b)
    .map((n) => byNumber.get(n)!)
    .filter(Boolean);

  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith(CITE)) {
        const citation = byNumber.get(Number(href.slice(CITE.length)));
        if (!citation) return null;
        return (
          <sup className="ml-0.5">
            <a
              href={citation.url}
              {...external}
              title={citation.title ?? citation.url}
              className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700 no-underline hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-300"
            >
              {citation.n}
            </a>
          </sup>
        );
      }
      return (
        <a href={href} {...external} className="text-blue-700 underline dark:text-blue-300">
          {children}
        </a>
      );
    },
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
    h1: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
    h2: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
    h3: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
    code: ({ children }) => (
      <code className="rounded bg-black/[.06] px-1 font-mono text-[0.85em] dark:bg-white/[.1]">{children}</code>
    ),
    pre: ({ children }) => (
      <pre className="my-1.5 overflow-x-auto rounded-lg bg-black/[.06] p-2 text-xs dark:bg-white/[.08]">{children}</pre>
    ),
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto">
        <table className="text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-black/[.1] px-2 py-1 text-left dark:border-white/[.15]">{children}</th>,
    td: ({ children }) => <td className="border-b border-black/[.05] px-2 py-1 dark:border-white/[.08]">{children}</td>,
  };

  return (
    <div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) => (url.startsWith(CITE) ? url : defaultUrlTransform(url))}
      >
        {text}
      </ReactMarkdown>

      {cited.length > 0 && (
        <div className="mt-2 border-t border-black/[.08] pt-2 dark:border-white/[.1]">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Sources</p>
          <ol className="mt-1 space-y-0.5 text-xs">
            {cited.map((citation) => (
              <li key={citation.n} className="flex gap-1.5">
                <span className="text-zinc-400">{citation.n}.</span>
                <a href={citation.url} {...external} className="truncate text-blue-700 hover:underline dark:text-blue-300">
                  {citation.title || hostname(citation.url)}
                </a>
                <span className="shrink-0 text-zinc-400">{hostname(citation.url)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
