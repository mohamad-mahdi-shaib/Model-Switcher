"use client";

import { useCallback, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown";

/**
 * Renders the Markdown AST as React elements. There is no HTML string and no
 * dangerouslySetInnerHTML anywhere in this file, so model output cannot inject
 * markup. Link hrefs were already restricted to safe schemes by the parser.
 */

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);
  return { copied, copy };
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return <span key={i}>{node.value}</span>;
          case "code":
            return (
              <code
                className="rounded-[5px] border border-white/20 bg-white/12 px-1 py-[1px] font-mono text-[0.92em] glass-text-dark"
                key={i}
              >
                {node.value}
              </code>
            );
          case "strong":
            return (
              <strong className="font-semibold glass-text-dark" key={i}>
                <Inline nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inline nodes={node.children} />
              </em>
            );
          case "link":
            return (
              <a
                className="focus-glass underline decoration-current/40 underline-offset-2 glass-text-dark hover:decoration-current"
                href={node.href}
                key={i}
                // Safe external-link attributes.
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function CodeBlock({
  lang,
  value,
  open,
}: {
  lang: string | null;
  value: string;
  open: boolean;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/22 bg-[color:var(--code-fill)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/15 px-3 py-1">
        <span className="font-mono text-[9.5px] tracking-wider uppercase glass-text-subtle">
          {lang ?? "code"}
          {open ? " · writing…" : ""}
        </span>
        <button
          aria-label={copied ? "Code copied" : "Copy code"}
          className="focus-glass flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
          onClick={() => copy(value)}
          type="button"
        >
          {copied ? (
            <CheckIcon className="h-2.5 w-2.5" />
          ) : (
            <CopyIcon className="h-2.5 w-2.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* Horizontal scroll keeps long lines readable without reflowing. */}
      <pre className="glass-scroll overflow-x-auto px-3 py-2">
        <code className="font-mono text-[11.5px] leading-relaxed whitespace-pre glass-text-dark">
          {value}
        </code>
      </pre>
    </div>
  );
}

function Block({ node }: { node: BlockNode }) {
  switch (node.type) {
    case "paragraph":
      return (
        <p className="my-1.5 break-words glass-text-muted">
          <Inline nodes={node.children} />
        </p>
      );
    case "heading": {
      const size =
        node.level === 1
          ? "text-[15px]"
          : node.level === 2
            ? "text-[14px]"
            : "text-[13px]";
      const Tag = (`h${Math.min(node.level + 1, 6)}` as unknown) as "h2";
      return (
        <Tag className={`mt-3 mb-1 font-semibold tracking-tight glass-text-dark ${size}`}>
          <Inline nodes={node.children} />
        </Tag>
      );
    }
    case "code":
      return <CodeBlock lang={node.lang} open={node.open} value={node.value} />;
    case "list":
      return node.ordered ? (
        <ol
          className="my-1.5 list-decimal space-y-1 pl-5 glass-text-muted"
          start={node.start}
        >
          {node.items.map((item, i) => (
            <li className="pl-0.5" key={i}>
              <Inline nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="my-1.5 list-disc space-y-1 pl-5 glass-text-muted">
          {node.items.map((item, i) => (
            <li className="pl-0.5" key={i}>
              <Inline nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="my-2 border-l-2 border-white/30 pl-3 italic glass-text-subtle">
          <Inline nodes={node.children} />
        </blockquote>
      );
    case "hr":
      return <hr className="my-3 border-0 border-t border-white/20" />;
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="markdown-body">
      {blocks.map((node, i) => (
        <Block key={i} node={node} />
      ))}
    </div>
  );
}

export { useCopy };
