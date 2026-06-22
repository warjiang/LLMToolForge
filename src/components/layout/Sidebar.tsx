import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  KeyRound,
  Boxes,
  Server,
  Settings,
  Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/api-keys", label: "API Keys", icon: KeyRound },
  { to: "/skills", label: "Skills", icon: Boxes },
  { to: "/mcp", label: "MCP Servers", icon: Server },
  { to: "/settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-background-secondary">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Hammer className="h-4 w-4" />
        </div>
        <span className="text-heading-14 tracking-tight">LLMToolForge</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-label-14 transition-colors duration-150",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 py-4 text-label-12 text-muted-foreground">
        v0.1.0 · 本地模式
      </div>
    </aside>
  );
}
