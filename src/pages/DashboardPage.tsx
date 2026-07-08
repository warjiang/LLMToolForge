import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  KeyRound,
  PlayCircle,
  Server,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Reveal } from "@/components/common/Reveal";
import { Card } from "@/components/ui/card";
import { useApiKeyStore, useMcpStore, useSkillStore } from "@/store";
import { AGENT_ROUTE_PATH } from "@/lib/routes";

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const apiKeys = useApiKeyStore();
  const skills = useSkillStore();
  const mcp = useMcpStore();

  useEffect(() => {
    if (!apiKeys.loaded) apiKeys.load();
    if (!skills.loaded) skills.load();
    if (!mcp.loaded) mcp.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSkills = skills.items.filter((s) => s.enabled).length;
  const activeMcp = mcp.items.filter((s) => s.enabled).length;
  const nextAction =
    apiKeys.items.length === 0
      ? {
          to: "/providers",
          label: t("setup_model_label"),
          description: t("setup_model_desc"),
        }
      : skills.items.length === 0
        ? {
            to: "/skills",
            label: t("setup_skills_label"),
            description: t("setup_skills_desc"),
          }
        : mcp.items.length === 0
          ? {
              to: "/mcp",
              label: t("setup_mcp_label"),
              description: t("setup_mcp_desc"),
            }
          : {
              label: t("ready_agent_label"),
              description: t("ready_agent_desc"),
              onClick: () => navigate(`/${AGENT_ROUTE_PATH}`),
            };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Reveal index={0} className="flex">
          <StatCard
            to="/providers"
            icon={KeyRound}
            label={t("model_integration")}
            value={apiKeys.items.length}
            hint={t("configured_keys")}
          />
        </Reveal>
        <Reveal index={1} className="flex">
          <StatCard
            to="/skills"
            icon={Boxes}
            label={t("skills")}
            value={skills.items.length}
            hint={t("enabled_skills", { count: activeSkills })}
          />
        </Reveal>
        <Reveal index={2} className="flex">
          <StatCard
            to="/mcp"
            icon={Server}
            label={t("mcp_servers")}
            value={mcp.items.length}
            hint={t("enabled_mcp", { count: activeMcp })}
          />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <Reveal index={3} className="flex">
          <Card className="flex min-h-[276px] flex-1 flex-col p-5 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-heading-20">{t("workspace")}</h3>
                <p className="mt-1 max-w-2xl text-copy-14 text-muted-foreground">
                  {t("workspace_description")}
                </p>
              </div>
              <div className="hidden h-10 w-10 items-center justify-center rounded-md bg-accent-subtle text-accent sm:flex">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 grid flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
              <WorkspaceLink
                to="/providers"
                icon={KeyRound}
                title={t("model_integration_card")}
                description={t("model_integration_desc")}
                meta={t("keys_count", { count: apiKeys.items.length })}
              />
              <WorkspaceLink
                to="/skills"
                icon={Boxes}
                title={t("skills_card")}
                description={t("skills_desc")}
                meta={t("skills_enabled", { enabled: activeSkills, total: skills.items.length })}
              />
              <WorkspaceLink
                to="/mcp"
                icon={Server}
                title={t("mcp_servers_card")}
                description={t("mcp_desc")}
                meta={t("mcp_enabled", { enabled: activeMcp, total: mcp.items.length })}
              />
            </div>
          </Card>
        </Reveal>

        <div className="grid gap-4">
          <Reveal index={4}>
            <Card className="p-5">
              <h3 className="text-heading-16">{t("local_status")}</h3>
              <div className="mt-4 space-y-3">
                <StatusRow label={t("data_location")} value={t("local_device")} />
                <StatusRow label={t("available_skills")} value={`${activeSkills}`} />
                <StatusRow label={t("available_mcp")} value={`${activeMcp}`} />
              </div>
            </Card>
          </Reveal>

          <Reveal index={5}>
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                  <PlayCircle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-heading-16">{t("next_step")}</h3>
                  <p className="mt-1 text-copy-14 text-muted-foreground">
                    {nextAction.description}
                  </p>
                  <QuickLink
                    to={"to" in nextAction ? nextAction.to : undefined}
                    onClick={
                      "onClick" in nextAction ? nextAction.onClick : undefined
                    }
                    label={nextAction.label}
                    className="mt-4"
                  />
                </div>
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  to,
  icon: Icon,
  label,
  value,
  hint,
}: {
  to: string;
  icon: ComponentType<LucideProps>;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Link to={to} className="block flex-1">
      <Card className="group flex h-full min-h-[156px] flex-col p-5 transition-all duration-200 ease-geist hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-geist-md">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="mt-auto pt-5 text-heading-32 leading-none">{value}</div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-label-14 font-medium">{label}</span>
          <span className="text-right text-label-12 text-muted-foreground">
            {hint}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function WorkspaceLink({
  to,
  icon: Icon,
  title,
  description,
  meta,
}: {
  to: string;
  icon: ComponentType<LucideProps>;
  title: string;
  description: string;
  meta: string;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-[168px] flex-col rounded-sm border border-border bg-background-secondary p-4 transition-all duration-200 ease-geist hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:bg-card hover:shadow-geist-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-card text-muted-foreground shadow-geist-sm">
          <Icon className="h-4 w-4" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-auto pt-6">
        <div className="text-label-14 font-medium">{title}</div>
        <p className="mt-1 text-copy-13 text-muted-foreground">
          {description}
        </p>
        <div className="mt-3 font-mono text-label-12 text-muted-foreground">
          {meta}
        </div>
      </div>
    </Link>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-label-13 text-muted-foreground">{label}</span>
      <span className="text-label-13 font-medium">{value}</span>
    </div>
  );
}

function QuickLink({
  to,
  onClick,
  label,
  className,
}: {
  to?: string;
  onClick?: () => void;
  label: string;
  className?: string;
}) {
  const classes = `inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-label-13 text-foreground transition-colors hover:bg-secondary ${className ?? ""}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {label}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <Link to={to ?? "#"} className={classes}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}
