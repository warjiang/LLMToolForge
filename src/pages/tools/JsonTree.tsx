import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type Json = unknown;

const isContainer = (v: Json): v is Record<string, Json> | Json[] =>
  v !== null && typeof v === "object";


function Scalar({ value, onSelect }: { value: Json; onSelect?: (v: Json) => void }) {
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  switch (typeof value) {
    case "string":
      return (
        <span
          className="cursor-pointer text-success hover:underline"
          onClick={() => onSelect?.(value)}
          title="点击查看详情"
        >
          "{value}"
        </span>
      );
    case "number":
      return <span className="text-accent">{String(value)}</span>;
    case "boolean":
      return <span className="text-destructive">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

interface NodeProps {
  /** Object key or array index label for this node, if any. */
  label?: string;
  value: Json;
  depth: number;
  defaultOpen: boolean;
  /** Render a trailing comma after the node. */
  trailingComma?: boolean;
  onSelectValue?: (value: Json) => void;
}

function Node({ label, value, depth, defaultOpen, trailingComma, onSelectValue }: NodeProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Re-sync when an expand-all / collapse-all signal flips defaultOpen.
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const keyLabel =
    label !== undefined ? <span className="text-foreground/80">{label}</span> : null;
  const colon = label !== undefined ? <span>: </span> : null;

  if (!isContainer(value)) {
    return (
      <div style={{ paddingLeft: depth * 14 }} className="whitespace-pre-wrap">
        {keyLabel}
        {colon}
        <Scalar value={value} onSelect={onSelectValue} />
        {trailingComma ? "," : ""}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, Json][] = isArray
    ? (value as Json[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, Json>);
  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 14 }}
        className="flex cursor-pointer items-start hover:bg-muted/40"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          className={cn(
            "mr-0.5 mt-[3px] h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="whitespace-pre-wrap">
          {keyLabel}
          {colon}
          {openBrace}
          {!open && (
            <span className="text-muted-foreground">
              {entries.length ? ` … ${entries.length} ` : ""}
              {closeBrace}
              {trailingComma ? "," : ""}
            </span>
          )}
        </span>
      </div>

      {open && (
        <>
          {entries.map(([k, v], i) => (
            <Node
              key={k}
              label={isArray ? undefined : `"${k}"`}
              value={v}
              depth={depth + 1}
              defaultOpen={defaultOpen}
              trailingComma={i < entries.length - 1}
              onSelectValue={onSelectValue}
            />
          ))}
          <div style={{ paddingLeft: depth * 14 }} className="whitespace-pre-wrap">
            <span className="pl-[14px]">
              {closeBrace}
              {trailingComma ? "," : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

interface JsonTreeProps {
  value: Json;
  error?: string | null;
  /** Increment to expand all nodes; pair with `collapseSignal`. */
  expandSignal?: number;
  collapseSignal?: number;
  defaultOpen?: boolean;
  onSelectValue?: (value: Json) => void;
}

export function JsonTree({
  value,
  error,
  expandSignal = 0,
  collapseSignal = 0,
  defaultOpen = false,
  onSelectValue,
}: JsonTreeProps) {
  const { t } = useTranslation("common");

  if (error) {
    return <p className="text-label-13 text-destructive">{error}</p>;
  }
  if (value === undefined) {
    return (
      <p className="text-label-13 text-muted-foreground">
        {t("result_placeholder")}
      </p>
    );
  }

  // Remount the whole tree whenever an expand/collapse signal changes so every
  // node re-initialises its open state from the new defaultOpen.
  const computedDefaultOpen = expandSignal >= collapseSignal ? true : defaultOpen;

  return (
    <div
      key={`${expandSignal}-${collapseSignal}`}
      className="font-mono text-copy-13 leading-relaxed"
    >
      <Node value={value} depth={0} defaultOpen={computedDefaultOpen} onSelectValue={onSelectValue} />
    </div>
  );
}
