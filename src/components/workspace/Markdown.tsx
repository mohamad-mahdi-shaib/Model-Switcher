"use client";

import { useCallback, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown";
import { tagRuns, type TextRun } from "@/lib/reveal";

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

/**
 * Renders one text value as its reveal runs.
 *
 * Each run is keyed by its group index, which is derived from the run's
 * absolute position, so a run that has already been shown keeps the same key
 * and the same DOM node on every later render. Mounting is therefore the only
 * moment `reveal-run` can fire -- settled words never re-animate when the next
 * chunk lands. Without `runs` (a restored or fully revealed answer) the text is
 * emitted plainly, with no extra elements at all.
 */
function Runs({ value, runs }: { value: string; runs?: TextRun[] }) {
  if (!runs) return <>{value}</>;
  return (
    <>
      {runs.map((run) => (
        <span className="reveal-run" key={run.group}>
          {run.text}
        </span>
      ))}
    </>
  );
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return <Runs key={i} runs={node.runs} value={node.value} />;
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
  runs,
  copyValue,
}: {
  lang: string | null;
  /** What is currently on screen. */
  value: string;
  open: boolean;
  runs?: TextRun[];
  /** The whole received block, including anything still queued for reveal. */
  copyValue: string;
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
          className="focus-glass flex min-h-11 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
          onClick={() => copy(copyValue)}
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
        {/* em-relative (0.92em of the 12.5px default container == 11.5px,
            matching the previous fixed size exactly) so code blocks scale
            with the text-size setting too, rather than staying fixed while
            the prose around them grows or shrinks -- they still never
            reflow, since the block's own `overflow-x-auto` handles any
            line that grows past the panel width at a larger scale. */}
        <code className="font-mono text-[0.92em] leading-relaxed whitespace-pre glass-text-dark">
          {/* Copy always sends the whole `value`, never the revealed runs. */}
          <Runs runs={runs} value={value} />
        </code>
      </pre>
    </div>
  );
}

function Block({ node, copyValue }: { node: BlockNode; copyValue?: string }) {
  switch (node.type) {
    case "paragraph":
      return (
        <p className="my-1.5 break-words glass-text-muted">
          <Inline nodes={node.children} />
        </p>
      );
    case "heading": {
      // Settings pass: em-relative (not fixed px) so a heading scales with
      // the text-size setting exactly like the surrounding prose does --
      // these ratios (1.2/1.12/1.04) reproduce the previous fixed 15/14/13px
      // sizes exactly at the default 12.5px container size.
      const size =
        node.level === 1
          ? "text-[1.2em]"
          : node.level === 2
            ? "text-[1.12em]"
            : "text-[1.04em]";
      const Tag = (`h${Math.min(node.level + 1, 6)}` as unknown) as "h2";
      return (
        <Tag className={`mt-3 mb-1 font-semibold tracking-tight glass-text-dark ${size}`}>
          <Inline nodes={node.children} />
        </Tag>
      );
    }
    case "code":
      return (
        <CodeBlock
          copyValue={copyValue ?? node.value}
          lang={node.lang}
          open={node.open}
          runs={node.runs}
          value={node.value}
        />
      );
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

export function Markdown({
  text,
  cuts,
  copySource,
}: {
  text: string;
  cuts?: readonly number[];
  /** Full received content, when `text` is only the revealed prefix. */
  copySource?: string;
}) {
  const parsed = parseMarkdown(text);
  // No cuts means nothing is being paced: render the AST untouched, so a
  // restored conversation emits no run spans and no animations whatsoever.
  const blocks = cuts && cuts.length ? tagRuns(parsed, cuts) : parsed;

  // Code blocks copy from the canonical parse, matched by their ordinal among
  // code blocks. The revealed text is a prefix of the same source, so the nth
  // displayed block is the nth received one; a block not yet reached simply
  // falls back to what is on screen.
  const fullCode =
    copySource && copySource !== text
      ? parseMarkdown(copySource).flatMap((b) => (b.type === "code" ? [b.value] : []))
      : null;
  let codeIndex = 0;

  return (
    <div className="markdown-body">
      {blocks.map((node, i) => {
        const copyValue =
          node.type === "code" ? fullCode?.[codeIndex++] : undefined;
        return <Block copyValue={copyValue} key={i} node={node} />;
      })}
    </div>
  );
}

export { useCopy };
