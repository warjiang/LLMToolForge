import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Boxes,
  Loader2,
  RefreshCw,
  Wrench,
  FileText,
  MessageSquare,
  PlugZap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { McpServer } from "@/types";
import {
  callTool,
  getPrompt,
  inspectServer,
  isInspectorSupported,
  readResource,
  type McpInspectSnapshot,
  type McpPromptDef,
  type McpResourceDef,
  type McpToolDef,
} from "@/lib/mcpInspector";
import { ToolPanel } from "./ToolPanel";
import { ResourcePanel } from "./ResourcePanel";
import { PromptPanel } from "./PromptPanel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: McpServer | null;
}

type Status = "idle" | "connecting" | "ready" | "error";

export function McpInspectorDialog({ open, onOpenChange, server }: Props) {
  const { t } = useTranslation("pages");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<McpInspectSnapshot | null>(null);

  const supported = isInspectorSupported();

  const connect = async (srv: McpServer) => {
    setStatus("connecting");
    setError(null);
    setSnapshot(null);
    try {
      const snap = await inspectServer(srv);
      setSnapshot(snap);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  useEffect(() => {
    if (open && server && supported) {
      void connect(server);
    }
    if (!open) {
      setStatus("idle");
      setSnapshot(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server?.id]);

  const serverName =
    (snapshot?.serverInfo?.name as string | undefined) ?? server?.name ?? "";
  const serverVersion = snapshot?.serverInfo?.version as string | undefined;

  const counts = useMemo(
    () => ({
      tools: snapshot?.tools.length ?? 0,
      resources:
        (snapshot?.resources.length ?? 0) +
        (snapshot?.resourceTemplates.length ?? 0),
      prompts: snapshot?.prompts.length ?? 0,
    }),
    [snapshot]
  );

  const hasTools = snapshot?.capabilities?.tools != null || counts.tools > 0;
  const hasResources =
    snapshot?.capabilities?.resources != null || counts.resources > 0;

  const defaultTab = hasTools ? "tools" : hasResources ? "resources" : "prompts";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90dvh,900px)] max-h-[900px] w-[calc(100vw-32px)] max-w-6xl flex-col gap-0 overflow-hidden bg-background-secondary p-0">
        <div className="border-b border-border bg-popover p-5">
          <DialogHeader className="gap-4 pr-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                  <PlugZap className="h-5 w-5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <DialogTitle className="truncate text-heading-24">
                    {t("mcp_inspector_title")} · {server?.name}
                  </DialogTitle>
                  <DialogDescription>
                    {status === "ready" && snapshot ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground">{serverName}</span>
                        {serverVersion && (
                          <span className="text-muted-foreground">
                            v{serverVersion}
                          </span>
                        )}
                        {snapshot.protocolVersion && (
                          <Badge variant="outline" className="rounded-sm">
                            {snapshot.protocolVersion}
                          </Badge>
                        )}
                        <Badge variant="outline" className="rounded-sm uppercase">
                          {server?.transport}
                        </Badge>
                      </span>
                    ) : (
                      t("mcp_inspector_desc")
                    )}
                  </DialogDescription>
                </div>
              </div>
              {status === "ready" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => server && connect(server)}
                  aria-label={t("mcp_inspector_reconnect")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("mcp_inspector_reconnect")}
                </Button>
              )}
            </div>

            {status === "ready" && snapshot && (
              <div className="grid gap-2 sm:grid-cols-3">
                <CapabilityTile
                  icon={Wrench}
                  label={t("mcp_inspector_tools")}
                  value={counts.tools}
                />
                <CapabilityTile
                  icon={FileText}
                  label={t("mcp_inspector_resources")}
                  value={counts.resources}
                />
                <CapabilityTile
                  icon={MessageSquare}
                  label={t("mcp_inspector_prompts")}
                  value={counts.prompts}
                />
              </div>
            )}
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 p-4">
          {!supported ? (
            <Notice icon={AlertCircle} text={t("mcp_inspector_desktop_only")} />
          ) : status === "connecting" ? (
            <Notice icon={Loader2} spin text={t("mcp_inspector_connecting")} />
          ) : status === "error" ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-lg rounded-md border border-border bg-card p-5 text-center shadow-geist-sm">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-background-secondary text-destructive">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <p className="whitespace-pre-wrap text-label-13 text-destructive">
                  {error}
                </p>
                <Button
                  className="mt-4"
                  variant="secondary"
                  onClick={() => server && connect(server)}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("mcp_inspector_retry")}
                </Button>
              </div>
            </div>
          ) : status === "ready" && snapshot && server ? (
            <Tabs
              defaultValue={defaultTab}
              className="flex h-full min-h-0 flex-col"
            >
              <TabsList className="w-fit bg-card">
                <TabsTrigger value="tools">
                  <Wrench className="h-3.5 w-3.5" />
                  {t("mcp_inspector_tools")} ({counts.tools})
                </TabsTrigger>
                <TabsTrigger value="resources">
                  <FileText className="h-3.5 w-3.5" />
                  {t("mcp_inspector_resources")} ({counts.resources})
                </TabsTrigger>
                <TabsTrigger value="prompts">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("mcp_inspector_prompts")} ({counts.prompts})
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="tools"
                className="mt-3 min-h-0 flex-1 overflow-hidden"
              >
                <ToolPanel
                  tools={snapshot.tools as McpToolDef[]}
                  onCall={(name, args) => callTool(server, name, args)}
                />
              </TabsContent>
              <TabsContent
                value="resources"
                className="mt-3 min-h-0 flex-1 overflow-hidden"
              >
                <ResourcePanel
                  resources={snapshot.resources as McpResourceDef[]}
                  templates={snapshot.resourceTemplates}
                  onRead={(uri) => readResource(server, uri)}
                />
              </TabsContent>
              <TabsContent
                value="prompts"
                className="mt-3 min-h-0 flex-1 overflow-hidden"
              >
                <PromptPanel
                  prompts={snapshot.prompts as McpPromptDef[]}
                  onGet={(name, args) => getPrompt(server, name, args)}
                />
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CapabilityTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-sm border border-border bg-background-secondary px-3 py-2.5">
      <div className="flex items-center gap-2 text-label-12 font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className="font-mono text-label-14 tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function Notice({
  icon: Icon,
  text,
  spin,
}: {
  icon: typeof AlertCircle;
  text: string;
  spin?: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-lg rounded-md border border-border bg-card p-6 text-center shadow-geist-sm">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-background-secondary text-muted-foreground">
          <Icon className={`h-5 w-5 ${spin ? "animate-spin" : ""}`} />
        </div>
        <p className="mx-auto max-w-md text-label-13 text-muted-foreground">
          {text}
        </p>
        {spin && (
          <div className="mx-auto mt-5 grid max-w-sm gap-2">
            <div className="h-2.5 animate-pulse rounded-sm bg-secondary" />
            <div className="h-2.5 w-4/5 animate-pulse rounded-sm bg-secondary" />
            <div className="h-2.5 w-2/3 animate-pulse rounded-sm bg-secondary" />
          </div>
        )}
      </div>
    </div>
  );
}
