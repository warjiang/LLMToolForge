import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { AgentSidebar } from "./AgentSidebar";
import { Topbar } from "./Topbar";
import { AgentChatView } from "@/pages/agent/AgentChatView";
import { useUnifiedStore } from "@/store/unified";
import { useChatStore } from "@/store";
import { useAppModeStore } from "@/store/appMode";

export function AppLayout() {
  const init = useUnifiedStore((s) => s.init);
  const mode = useAppModeStore((s) => s.mode);
  const initChat = useChatStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (mode === "agent") void initChat();
  }, [mode, initChat]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <Topbar />
      <div className="flex min-h-0 flex-1">
        {mode === "agent" ? (
          <>
            <AgentSidebar />
            <main className="min-w-0 flex-1 overflow-hidden">
              <AgentChatView />
            </main>
          </>
        ) : (
          <>
            <Sidebar />
            <main className="min-w-0 flex-1 overflow-hidden">
              <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-y-auto px-5 py-6 sm:px-6 lg:px-8">
                <Outlet />
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}
