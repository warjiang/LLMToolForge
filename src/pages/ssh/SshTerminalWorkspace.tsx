import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Server, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSshHostStore, useSshSessionStore } from "@/store";
import { TerminalSession, type SessionStatus } from "./TerminalSession";

interface Props {
  /**
   * Whether the workspace is on-screen. It stays mounted when false (so
   * background sessions survive route changes) but is hidden via CSS.
   */
  visible: boolean;
}

const DOT: Record<SessionStatus, string> = {
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  disconnected: "bg-muted-foreground",
  error: "bg-destructive",
};

/**
 * Terminal workspace: a tab bar of independent SSH sessions plus a `+` picker to
 * open more (including multiple instances of the same host). All sessions stay
 * mounted so background tabs keep their connections; only the active tab's pane
 * is visible. Rendered inside the app's main content area (below the topbar,
 * beside the sidebar) — not a fullscreen portal — so the app chrome stays put.
 */
export function SshTerminalWorkspace({ visible }: Props) {
  const { t } = useTranslation("pages");
  const hosts = useSshHostStore((s) => s.items);
  const loaded = useSshHostStore((s) => s.loaded);
  const loadHosts = useSshHostStore((s) => s.load);
  const tabs = useSshSessionStore((s) => s.tabs);
  const activeTabId = useSshSessionStore((s) => s.activeTabId);
  const workspaceOpen = useSshSessionStore((s) => s.workspaceOpen);
  const openTab = useSshSessionStore((s) => s.openTab);
  const closeTab = useSshSessionStore((s) => s.closeTab);
  const setActive = useSshSessionStore((s) => s.setActive);
  const closeWorkspace = useSshSessionStore((s) => s.closeWorkspace);

  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});

  useEffect(() => {
    if (workspaceOpen && !loaded) void loadHosts();
  }, [workspaceOpen, loaded, loadHosts]);

  // Stable; guards against re-render loops by bailing when status is unchanged.
  const setStatusFor = useCallback((id: string, status: SessionStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  if (!workspaceOpen) return null;

  const hostById = (id: string) => hosts.find((h) => h.id === id) ?? null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 flex-col bg-background",
        visible ? "flex" : "hidden"
      )}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border bg-card pl-2 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const status = statuses[tab.id] ?? "connecting";
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(tab.id)}
                className={cn(
                  "group flex shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-label-12 transition-colors",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-background-secondary"
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[status])} />
                <span className="max-w-[160px] truncate">{tab.title}</span>
                <button
                  type="button"
                  aria-label={t("ssh_close_tab")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="rounded-sm p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-secondary hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label={t("ssh_new_session")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[320px] overflow-y-auto">
              {hosts.length === 0 ? (
                <DropdownMenuItem disabled>{t("ssh_no_hosts")}</DropdownMenuItem>
              ) : (
                hosts.map((h) => (
                  <DropdownMenuItem key={h.id} onClick={() => openTab(h)}>
                    <Server className="h-4 w-4" />
                    <span className="truncate">{h.name}</span>
                    <span className="ml-auto pl-3 text-label-12 text-muted-foreground">
                      {h.username}@{h.hostname}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={closeWorkspace}
          aria-label={t("close", { ns: "common" })}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Panes — all mounted, only the active one visible. */}
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <TerminalSquare className="h-8 w-8" />
            <p className="text-copy-14">{t("ssh_workspace_empty")}</p>
          </div>
        ) : (
          tabs.map((tab) => {
            const host = hostById(tab.hostId);
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "absolute inset-3 overflow-hidden rounded-md border border-border",
                  isActive ? "block" : "hidden"
                )}
              >
                {host && (
                  <TerminalSession
                    host={host}
                    hosts={hosts}
                    active={isActive}
                    onStatusChange={(s) => setStatusFor(tab.id, s)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
