import { Outlet, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SshTerminalWorkspace } from "@/pages/ssh/SshTerminalWorkspace";
import { useChatStore } from "@/store";
import { useAppModeStore } from "@/store/appMode";
import { AGENT_ROUTE_PATH } from "@/lib/routes";

const AgentSidebar = lazy(() =>
  import("./AgentSidebar").then((m) => ({ default: m.AgentSidebar }))
);
const AgentChatView = lazy(() =>
  import("@/pages/agent/AgentChatView").then((m) => ({ default: m.AgentChatView }))
);

function AgentFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-label-13 text-muted-foreground">
      Loading...
    </div>
  );
}

export function AppLayout() {
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);
  const initChat = useChatStore((s) => s.init);
  const location = useLocation();

  useEffect(() => {
    const routeMode = location.pathname === `/${AGENT_ROUTE_PATH}` ? "agent" : "tool";
    if (routeMode !== mode) setMode(routeMode);
  }, [location.pathname, mode, setMode]);

  useEffect(() => {
    if (mode === "agent") void initChat();
  }, [mode, initChat]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <Topbar />
      <div className="flex min-h-0 flex-1">
        {mode === "agent" ? (
          <Suspense fallback={<AgentFallback />}>
            <AgentSidebar />
            <main className="min-w-0 flex-1 overflow-hidden">
              <AgentChatView />
            </main>
          </Suspense>
        ) : (
          <>
            <Sidebar />
            <main className="relative min-w-0 flex-1 overflow-hidden">
              <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-y-auto px-5 py-6 sm:px-6 lg:px-8">
                <Outlet />
              </div>
              <SshTerminalWorkspace visible={location.pathname.startsWith("/ssh")} />
            </main>
          </>
        )}
      </div>
    </div>
  );
}
