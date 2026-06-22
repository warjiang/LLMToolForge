import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const TITLES: Record<string, string> = {
  "/": "概览",
  "/api-keys": "API Keys",
  "/skills": "Skills",
  "/mcp": "MCP Servers",
  "/settings": "设置",
};

export function AppLayout() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? "LLMToolForge";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
