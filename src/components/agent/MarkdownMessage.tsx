import { memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn, isTauri } from "@/lib/utils";

async function openExternal(href?: string) {
  if (!href) return;
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url: href });
    } catch (e) {
      console.error("Failed to open external link", e);
    }
    return;
  }
  try {
    window.open(href, "_blank", "noopener,noreferrer");
  } catch {
    /* no-op: never let a link break the app shell */
  }
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const raw = String(children ?? "").replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <div className="md-block group/code relative my-2 overflow-hidden rounded-md border border-border bg-[var(--background-secondary,#fafafa)]">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1">
        <span className="select-none font-mono text-label-12 lowercase text-muted-foreground">
          {lang ?? "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-label-12 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
        >
          {copied ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-label-13 leading-relaxed text-foreground">
          {raw}
        </code>
      </pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        void openExternal(href);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="font-medium text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
    >
      {children}
    </a>
  ),
  p: ({ children }) => (
    <p className="md-block my-1.5 leading-relaxed first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="text-muted-foreground line-through">{children}</del>
  ),
  ul: ({ children }) => (
    <ul className="md-block my-1.5 list-disc space-y-1 pl-5 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="md-block my-1.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="md-block mb-2 mt-3 text-[1.2rem] font-semibold leading-snug first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="md-block mb-2 mt-3 text-copy-16 font-semibold leading-snug first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="md-block mb-1.5 mt-2.5 text-copy-14 font-semibold first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="md-block mb-1.5 mt-2 text-copy-14 font-semibold first:mt-0">
      {children}
    </h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="md-block my-2 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="md-block my-3 border-border" />,
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded-[4px] bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="md-block my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-label-13">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-secondary/60">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border/50 px-3 py-1.5 align-top">
      {children}
    </td>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <img
        src={src}
        alt={alt ?? ""}
        className="md-block my-2 h-auto max-w-full rounded-md border border-border"
      />
    ) : null,
};

export interface MarkdownMessageProps {
  content: string;
  streaming?: boolean;
  className?: string;
}

function MarkdownMessageBase({
  content,
  streaming,
  className,
}: MarkdownMessageProps) {
  return (
    <div
      data-streaming={streaming ? "true" : undefined}
      className={cn("md-body break-words text-copy-14", className)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageBase);
