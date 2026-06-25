import { useEffect } from "react";
import { Link } from "react-router-dom";
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
import { useAppModeStore } from "@/store/appMode";

export function DashboardPage() {
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
          label: "添加第一个 API Key",
          description: "先接入模型凭据，Playground 和工具编排才有可用模型。",
        }
      : skills.items.length === 0
        ? {
            to: "/skills",
            label: "创建第一个 Skill",
            description: "把常用提示词、工具说明和调用方式整理成可复用能力。",
          }
        : mcp.items.length === 0
          ? {
              to: "/mcp",
              label: "接入 MCP Server",
              description: "为模型接入本地或远端工具，扩展可调用能力。",
            }
          : {
              label: "进入 Agent 形态",
              description: "用已配置的模型、Skill 和工具组合，在独立的聊天界面里测试真实对话。",
              onClick: () => useAppModeStore.getState().setMode("agent"),
            };

  return (
    <div className="space-y-5">
      <PageHeader
        title="概览"
        description="管理大模型的工具：API Key、Skill 与 MCP 服务器。"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Reveal index={0} className="flex">
          <StatCard
            to="/providers"
            icon={KeyRound}
            label="模型接入"
            value={apiKeys.items.length}
            hint="已配置的密钥"
          />
        </Reveal>
        <Reveal index={1} className="flex">
          <StatCard
            to="/skills"
            icon={Boxes}
            label="Skills"
            value={skills.items.length}
            hint={`${activeSkills} 个已启用`}
          />
        </Reveal>
        <Reveal index={2} className="flex">
          <StatCard
            to="/mcp"
            icon={Server}
            label="MCP Servers"
            value={mcp.items.length}
            hint={`${activeMcp} 个已启用`}
          />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <Reveal index={3} className="flex">
          <Card className="flex min-h-[276px] flex-1 flex-col p-5 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-heading-20">工作台</h3>
                <p className="mt-1 max-w-2xl text-copy-14 text-muted-foreground">
                  先接入模型，再沉淀 Skills，并按需连接 MCP Server。
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
                title="模型接入"
                description="管理 API Key 与模型供应商连接。"
                meta={`${apiKeys.items.length} 个密钥`}
              />
              <WorkspaceLink
                to="/skills"
                icon={Boxes}
                title="Skills"
                description="创建可复用的技能说明与标签。"
                meta={`${activeSkills}/${skills.items.length} 已启用`}
              />
              <WorkspaceLink
                to="/mcp"
                icon={Server}
                title="MCP Servers"
                description="接入 stdio、SSE 或 HTTP 工具服务。"
                meta={`${activeMcp}/${mcp.items.length} 已启用`}
              />
            </div>
          </Card>
        </Reveal>

        <div className="grid gap-4">
          <Reveal index={4}>
            <Card className="p-5">
              <h3 className="text-heading-16">本地状态</h3>
              <div className="mt-4 space-y-3">
                <StatusRow label="数据位置" value="本地设备" />
                <StatusRow label="可用 Skills" value={`${activeSkills} 个`} />
                <StatusRow label="可用 MCP" value={`${activeMcp} 个`} />
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
                  <h3 className="text-heading-16">下一步</h3>
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
