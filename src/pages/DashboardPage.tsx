import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Boxes, KeyRound, Server } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { useApiKeyStore, useMcpStore, useSkillStore } from "@/store";

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

  return (
    <div>
      <PageHeader
        title="概览"
        description="管理大模型的工具：API Key、Skill 与 MCP 服务器。"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          to="/providers"
          icon={KeyRound}
          label="模型接入"
          value={apiKeys.items.length}
          hint="已配置的密钥"
        />
        <StatCard
          to="/skills"
          icon={Boxes}
          label="Skills"
          value={skills.items.length}
          hint={`${activeSkills} 个已启用`}
        />
        <StatCard
          to="/mcp"
          icon={Server}
          label="MCP Servers"
          value={mcp.items.length}
          hint={`${activeMcp} 个已启用`}
        />
      </div>

      <Card className="mt-6 p-6">
        <h3 className="text-heading-16">快速开始</h3>
        <p className="mt-1 text-copy-14 text-muted-foreground">
          从左侧导航选择一个模块开始配置。所有数据当前保存在本地设备。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <QuickLink to="/providers" label="添加 API Key" />
          <QuickLink to="/skills" label="创建 Skill" />
          <QuickLink to="/mcp" label="接入 MCP Server" />
        </div>
      </Card>
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
    <Link to={to}>
      <Card className="group p-5 transition-colors hover:border-muted-foreground/30">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="mt-4 text-heading-32 leading-none">{value}</div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-label-14 font-medium">{label}</span>
          <span className="text-label-12 text-muted-foreground">{hint}</span>
        </div>
      </Card>
    </Link>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-label-13 text-foreground transition-colors hover:bg-secondary"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}
