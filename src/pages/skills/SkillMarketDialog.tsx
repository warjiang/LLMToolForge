import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  Store,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  installStatus,
  resolveMarketSkill,
  searchMarket,
  toSkillPayload,
  UnsupportedSkillSourceError,
} from "@/lib/skillMarket";
import { useMarketSettingsStore, useSkillStore } from "@/store";
import type {
  MarketSkillSummary,
  Skill,
  SkillRequirements,
} from "@/types";
import { SkillRequires } from "./SkillRequires";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Provider = "github" | "skills_sh";
type RowState = "idle" | "resolving" | "installed" | "error";

export function SkillMarketDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const skills = useSkillStore((s) => s.items);
  const addSkill = useSkillStore((s) => s.add);
  const editSkill = useSkillStore((s) => s.edit);
  const githubToken = useMarketSettingsStore((s) => s.githubToken);
  const setGithubToken = useMarketSettingsStore((s) => s.setGithubToken);

  const [provider, setProvider] = useState<Provider>("github");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketSkillSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [rowRequires, setRowRequires] = useState<
    Record<string, SkillRequirements>
  >({});
  const [showToken, setShowToken] = useState(false);

  const token = provider === "github" ? githubToken.trim() || undefined : undefined;

  const runSearch = async () => {
    const value = query.trim();
    if (!value) return;
    setSearching(true);
    setError(null);
    setResults([]);
    setRowStates({});
    setRowErrors({});
    setRowNotes({});
    try {
      const found = await searchMarket(provider, value, token);
      setResults(found);
      if (found.length === 0) setError(t("skill_market_no_results"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skill_market_search_failed"));
    } finally {
      setSearching(false);
    }
  };

  const install = async (summary: MarketSkillSummary) => {
    setRowStates((s) => ({ ...s, [summary.id]: "resolving" }));
    setRowErrors((s) => ({ ...s, [summary.id]: "" }));
    setRowNotes((s) => ({ ...s, [summary.id]: "" }));
    try {
      const detail = await resolveMarketSkill(
        summary,
        summary.provider === "github" ? token : undefined
      );
      const { existing } = installStatus(skills, detail);
      const payload = toSkillPayload(detail, existing);
      if (existing) {
        await editSkill(existing.id, payload);
      } else {
        await addSkill(payload);
      }
      setRowStates((s) => ({ ...s, [summary.id]: "installed" }));
      if (detail.requires?.bins?.length) {
        setRowRequires((s) => ({ ...s, [summary.id]: detail.requires! }));
      }
      const notes: string[] = [];
      if ((detail.files?.length ?? 0) > 1) {
        notes.push(t("skill_market_files_note", { count: detail.files!.length }));
      }
      if (detail.skippedFiles) {
        notes.push(t("skill_market_skipped_note", { count: detail.skippedFiles }));
      }
      if (notes.length > 0) {
        setRowNotes((s) => ({ ...s, [summary.id]: notes.join(" · ") }));
      }
    } catch (e) {
      setRowStates((s) => ({ ...s, [summary.id]: "error" }));
      const message =
        e instanceof UnsupportedSkillSourceError
          ? t("skill_market_unsupported_source", { host: e.host })
          : e instanceof Error
            ? e.message
            : t("skill_market_install_failed");
      setRowErrors((s) => ({
        ...s,
        [summary.id]: message,
      }));
    }
  };

  const switchProvider = (next: Provider) => {
    setProvider(next);
    setResults([]);
    setError(null);
    setQuery("");
    setRowStates({});
    setRowErrors({});
    setRowNotes({});
    setShowToken(false);
  };

  const placeholder =
    provider === "github"
      ? t("skill_market_github_placeholder")
      : t("skill_market_search_placeholder");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("skill_market_title")}</DialogTitle>
          <DialogDescription>{t("skill_market_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1">
          <section className="rounded-md border border-border bg-background-secondary p-3">
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background-secondary p-1">
              <ProviderButton
                active={provider === "github"}
                icon={<GitBranch className="h-4 w-4" />}
                label="GitHub"
                onClick={() => switchProvider("github")}
              />
              <ProviderButton
                active={provider === "skills_sh"}
                icon={<Store className="h-4 w-4" />}
                label="skills.sh"
                onClick={() => switchProvider("skills_sh")}
              />
            </div>

            <p className="mb-3 mt-3 text-label-12 text-muted-foreground">
              {provider === "github"
                ? t("skill_market_github_hint")
                : t("skill_market_skills_sh_hint")}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={query}
                placeholder={placeholder}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
              <Button
                className="sm:w-auto"
                onClick={runSearch}
                disabled={searching || !query.trim()}
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {provider === "github"
                  ? t("skill_market_list")
                  : t("skill_market_search")}
              </Button>
            </div>
          </section>

          {provider === "github" && (
            <section className="rounded-md border border-border bg-background-secondary p-3">
              <button
                type="button"
                className="text-label-12 font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
                onClick={() => setShowToken((v) => !v)}
              >
                {t("skill_market_token_toggle")}
              </button>
              {showToken && (
                <div className="mt-3 grid gap-1.5">
                  <Label htmlFor="gh-token">{t("skill_market_token_label")}</Label>
                  <Input
                    id="gh-token"
                    type="password"
                    value={githubToken}
                    placeholder="ghp_..."
                    onChange={(e) => setGithubToken(e.target.value)}
                  />
                  <p className="text-label-12 text-muted-foreground">
                    {t("skill_market_token_hint")}
                  </p>
                </div>
              )}
            </section>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-label-12 text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-heading-14">{t("skill_market_results")}</h3>
              <Badge variant="outline">
                {t("skill_market_result_count", { count: results.length })}
              </Badge>
            </div>
            {searching ? (
              <div className="grid gap-2">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-[82px] animate-pulse rounded-md border border-border bg-background-secondary"
                  />
                ))}
              </div>
            ) : results.length === 0 && !error ? (
              <div className="rounded-md border border-dashed border-border bg-background-secondary px-4 py-8 text-center">
                <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-label-13 font-medium">
                  {t("skill_market_empty_title")}
                </p>
                <p className="mt-1 text-label-12 text-muted-foreground">
                  {t("skill_market_empty_desc")}
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {results.map((item) => (
                  <MarketRow
                    key={item.id}
                    item={item}
                    skills={skills}
                    state={rowStates[item.id] ?? "idle"}
                    error={rowErrors[item.id]}
                    note={rowNotes[item.id]}
                    requires={rowRequires[item.id]}
                    onInstall={() => install(item)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("close", { ns: "common" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={
        active
          ? "inline-flex h-8 items-center gap-1.5 rounded-sm bg-background px-3 text-label-13 font-medium text-foreground shadow-geist-sm transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
          : "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-label-13 font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
      }
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function MarketRow({
  item,
  skills,
  state,
  error,
  note,
  requires,
  onInstall,
}: {
  item: MarketSkillSummary;
  skills: Skill[];
  state: RowState;
  error?: string;
  note?: string;
  requires?: SkillRequirements;
  onInstall: () => void;
}) {
  const { t } = useTranslation("pages");
  const installedSkill = useMemo(
    () =>
      skills.find(
        (s) =>
          s.sourceType === "github" &&
          s.source === item.source &&
          (item.skillPath ? s.skillPath === item.skillPath : s.name === item.name)
      ),
    [skills, item]
  );
  const alreadyInstalled = installedSkill != null;

  const installedNow = state === "installed";
  const busy = state === "resolving";
  // Prefer the freshly-resolved requirements from this session's install,
  // otherwise fall back to the stored skill's declared requirements so the
  // section also shows for skills installed in a previous session.
  const effectiveRequires = requires ?? installedSkill?.requires;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-label-13 font-medium">{item.name}</span>
          {typeof item.installs === "number" && (
            <Badge variant="outline">
              {t("skill_market_installs", { count: item.installs })}
            </Badge>
          )}
          {alreadyInstalled && (
            <Badge variant="success">{t("skill_market_already_installed")}</Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-label-12 text-muted-foreground">
          {item.source}
          {item.skillPath ? ` · ${item.skillPath}` : ""}
        </p>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-label-12 text-muted-foreground">
            {item.description}
          </p>
        )}
        {state === "error" && error && (
          <p className="mt-1 text-label-12 text-destructive">{error}</p>
        )}
        {state === "installed" && note && (
          <p className="mt-1 text-label-12 text-muted-foreground">{note}</p>
        )}
        {(installedNow || alreadyInstalled) && effectiveRequires?.bins?.length ? (
          <SkillRequires requires={effectiveRequires} className="mt-2" />
        ) : null}
      </div>

      <Button
        size="sm"
        className="shrink-0 self-start"
        variant={installedNow || alreadyInstalled ? "secondary" : "primary"}
        disabled={busy || installedNow}
        onClick={onInstall}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : installedNow ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : alreadyInstalled ? (
          <RefreshCw className="h-4 w-4" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {installedNow
          ? t("skill_market_installed")
          : alreadyInstalled
            ? t("skill_market_reinstall")
            : t("skill_market_install")}
      </Button>
    </div>
  );
}
