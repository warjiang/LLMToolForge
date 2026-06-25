import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { JsonSchema } from "@/lib/mcpInspector";

/**
 * Render clamped text with a show more/less toggle that only appears when the
 * text actually overflows.
 */
export function ExpandableText({
  text,
  lines = 4,
  className,
}: {
  text: string;
  lines?: number;
  className?: string;
}) {
  const { t } = useTranslation("pages");
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", measure);
    };
  }, [text, expanded]);

  const clampStyle: React.CSSProperties | undefined = expanded
    ? undefined
    : {
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      };

  return (
    <div className="space-y-1">
      <p
        ref={ref}
        style={clampStyle}
        className={
          className ??
          "whitespace-pre-wrap text-label-12 leading-relaxed text-muted-foreground"
        }
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-sm text-label-12 font-medium text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
        >
          {expanded ? t("mcp_inspector_collapse") : t("mcp_inspector_expand")}
        </button>
      )}
    </div>
  );
}

/** Pretty-printed JSON in a scrollable code block. */
export function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-sm border border-border bg-background-secondary p-3 text-label-12 leading-relaxed">
      <code className="font-mono">{text}</code>
    </pre>
  );
}

interface ContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

/** Render MCP content blocks (text / image / resource) generically. */
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === "text" && typeof block.text === "string") {
          return (
            <pre
              key={i}
              className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-background-secondary p-3 text-label-12 leading-relaxed font-mono"
            >
              {block.text}
            </pre>
          );
        }
        return <JsonBlock key={i} value={block} />;
      })}
    </div>
  );
}

/** Collapsible raw-JSON disclosure. */
export function RawJson({ value }: { value: unknown }) {
  const { t } = useTranslation("pages");
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-sm text-label-12 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {t("mcp_inspector_raw_json")}
      </button>
      {open && (
        <div className="mt-1.5">
          <JsonBlock value={value} />
        </div>
      )}
    </div>
  );
}

/**
 * Render the result of a tool call / resource read / prompt get. Surfaces text
 * content blocks, flags `isError`, and always offers the raw JSON.
 */
export function ResultView({ result }: { result: unknown }) {
  const { t } = useTranslation("pages");
  const obj =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : null;

  const isError = obj?.isError === true;
  const blocks =
    (obj?.content as ContentBlock[] | undefined) ??
    (obj?.contents as ContentBlock[] | undefined) ??
    null;
  const messages = obj?.messages as
    | { role?: string; content?: ContentBlock | ContentBlock[] }[]
    | undefined;

  return (
    <div className="space-y-2">
      {isError && (
        <p className="rounded-sm bg-destructive/10 p-3 text-label-12 font-medium text-destructive">
          {t("mcp_inspector_tool_error")}
        </p>
      )}
      {messages ? (
        <div className="space-y-2">
          {messages.map((m, i) => {
            const content = Array.isArray(m.content)
              ? m.content
              : m.content
                ? [m.content]
                : [];
            return (
              <div key={i} className="rounded-sm border border-border bg-background p-3">
                <p className="mb-2 text-label-12 font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {m.role ?? "message"}
                </p>
                <ContentBlocks blocks={content} />
              </div>
            );
          })}
        </div>
      ) : blocks && blocks.length > 0 ? (
        <ContentBlocks blocks={blocks} />
      ) : null}
      <RawJson value={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema-driven argument form
// ---------------------------------------------------------------------------

function schemaType(schema: JsonSchema | undefined): string {
  if (!schema) return "string";
  const tt = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return tt ?? (schema.enum ? "string" : "object");
}

export function defaultForSchema(schema: JsonSchema | undefined): unknown {
  if (!schema) return "";
  if (schema.default !== undefined) return schema.default;
  switch (schemaType(schema)) {
    case "boolean":
      return false;
    case "number":
    case "integer":
      return "";
    case "array":
    case "object":
      return "";
    default:
      return "";
  }
}

/**
 * Build the arguments object from raw field values, coercing types and parsing
 * JSON for array/object fields. Throws on invalid JSON in a complex field.
 */
export function buildArguments(
  schema: JsonSchema | undefined,
  values: Record<string, unknown>
): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const out: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(props)) {
    const raw = values[key];
    const type = schemaType(propSchema);

    if (type === "boolean") {
      out[key] = Boolean(raw);
      continue;
    }
    if (type === "number" || type === "integer") {
      if (raw === "" || raw == null) {
        if (required.has(key)) out[key] = type === "integer" ? 0 : 0;
        continue;
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        throw new Error(`"${key}" must be a number`);
      }
      out[key] = num;
      continue;
    }
    if (type === "array" || type === "object") {
      const str = typeof raw === "string" ? raw.trim() : "";
      if (!str) {
        if (required.has(key)) out[key] = type === "array" ? [] : {};
        continue;
      }
      try {
        out[key] = JSON.parse(str);
      } catch {
        throw new Error(`"${key}" must be valid JSON`);
      }
      continue;
    }
    // string-like
    const str = raw == null ? "" : String(raw);
    if (str === "" && !required.has(key)) continue;
    out[key] = str;
  }

  return out;
}

interface SchemaFormProps {
  schema: JsonSchema | undefined;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaForm({ schema, values, onChange }: SchemaFormProps) {
  const { t } = useTranslation("pages");
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const keys = Object.keys(props);

  if (keys.length === 0) {
    return (
      <p className="text-label-12 text-muted-foreground">
        {t("mcp_inspector_no_args")}
      </p>
    );
  }

  const set = (key: string, value: unknown) =>
    onChange({ ...values, [key]: value });

  return (
    <div className="grid gap-3">
      {keys.map((key) => {
        const propSchema = props[key];
        const type = schemaType(propSchema);
        const isReq = required.has(key);
        const label = (
          <label className="flex flex-wrap items-baseline gap-1.5 text-label-12 font-medium">
            <span>{propSchema.title ?? key}</span>
            {isReq && <span className="text-destructive">*</span>}
            <span className="font-normal text-muted-foreground">{type}</span>
          </label>
        );
        const help = propSchema.description ? (
          <ExpandableText
            text={propSchema.description}
            lines={3}
            className="whitespace-pre-wrap text-label-12 leading-relaxed text-muted-foreground"
          />
        ) : null;

        if (type === "boolean") {
          return (
            <div key={key} className="grid gap-1">
              <div className="flex items-center justify-between">
                {label}
                <input
                  type="checkbox"
                  checked={Boolean(values[key])}
                  onChange={(e) => set(key, e.target.checked)}
                  className="h-4 w-4 accent-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
                />
              </div>
              {help}
            </div>
          );
        }

        if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
          return (
            <div key={key} className="grid gap-1">
              {label}
              <select
                value={String(values[key] ?? "")}
                onChange={(e) => set(key, e.target.value)}
                className="h-9 rounded-sm border border-border bg-background-secondary px-3 text-label-13 outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
              >
                <option value="">—</option>
                {propSchema.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
              {help}
            </div>
          );
        }

        if (type === "array" || type === "object") {
          return (
            <div key={key} className="grid gap-1">
              {label}
              <textarea
                value={String(values[key] ?? "")}
                onChange={(e) => set(key, e.target.value)}
                placeholder={type === "array" ? "[]" : "{}"}
                className="min-h-[88px] rounded-sm border border-border bg-background-secondary px-3 py-2 text-label-12 font-mono outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
              />
              {help}
            </div>
          );
        }

        return (
          <div key={key} className="grid gap-1">
            {label}
            <input
              type={type === "number" || type === "integer" ? "number" : "text"}
              value={String(values[key] ?? "")}
              onChange={(e) => set(key, e.target.value)}
              className="h-9 rounded-sm border border-border bg-background-secondary px-3 text-label-13 outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
            />
            {help}
          </div>
        );
      })}
    </div>
  );
}
