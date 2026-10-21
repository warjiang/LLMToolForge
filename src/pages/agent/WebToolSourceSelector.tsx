import { useEffect } from "react";
import { ChevronDown, Globe2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WebToolSource } from "@/lib/agent/webToolSource";

export interface WebToolSourceCandidateOption {
  id: string;
  name: string;
  enabled?: boolean;
  installed?: boolean;
  webToolSourceCandidate?: boolean;
}

interface Props {
  value: WebToolSource;
  candidates: readonly WebToolSourceCandidateOption[];
  onChange: (value: WebToolSource) => void;
  className?: string;
  showHint?: boolean;
  layout?: "form" | "toolbar";
}

export function WebToolSourceSelector({
  value,
  candidates,
  onChange,
  className,
  showHint = true,
  layout = "form",
}: Props) {
  const { t } = useTranslation("pages");
  const eligibleCandidates = candidates.filter(
    (candidate) =>
      candidate.webToolSourceCandidate === true &&
      candidate.enabled !== false &&
      candidate.installed !== false
  );
  const selectedValue =
    value.kind === "mcp" &&
    eligibleCandidates.some((candidate) => candidate.id === value.serverId)
      ? `mcp:${value.serverId}`
      : value.kind;

  useEffect(() => {
    if (value.kind !== "mcp") return;
    const stillAvailable = eligibleCandidates.some(
      (candidate) => candidate.id === value.serverId
    );
    if (!stillAvailable) onChange({ kind: "off" });
  }, [eligibleCandidates, onChange, value]);

  const selector = (
    <select
      aria-label={t("web_tool_source_label")}
      value={selectedValue}
      onChange={(event) => {
        const next = event.target.value;
        if (next === "builtin") {
          onChange({ kind: "builtin" });
        } else if (next === "off") {
          onChange({ kind: "off" });
        } else if (next.startsWith("mcp:")) {
          onChange({ kind: "mcp", serverId: next.slice(4) });
        }
      }}
      className={
        layout === "toolbar"
          ? "h-7 w-full appearance-none rounded-md border border-transparent bg-transparent py-0 pl-7 pr-6 text-label-12 font-normal text-muted-foreground transition-colors hover:border-transparent hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:border-transparent focus-visible:bg-secondary"
          : "mt-1.5 flex h-9 w-full rounded-sm border border-input bg-background px-3 text-label-14 text-foreground transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:border-input"
      }
    >
      <option value="builtin">{t("web_tool_source_builtin")}</option>
      {eligibleCandidates.map((candidate) => (
        <option key={candidate.id} value={`mcp:${candidate.id}`}>
          {candidate.name}
        </option>
      ))}
      <option value="off">{t("web_tool_source_off")}</option>
    </select>
  );

  if (layout === "toolbar") {
    return (
      <div
        className={`relative w-[142px] shrink-0 ${className ?? ""}`}
        title={t("web_tool_source_label")}
      >
        <Globe2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        {selector}
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="text-label-13 font-medium text-foreground">
        {t("web_tool_source_label")}
        {selector}
      </label>
      {showHint && (
        <p className="mt-1 text-label-12 text-muted-foreground">
          {t("web_tool_source_hint")}
        </p>
      )}
    </div>
  );
}
