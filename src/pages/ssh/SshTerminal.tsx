import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCw, TerminalSquare } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SshHost } from "@/types";
import {
  buildConnectConfig,
  connect,
  disconnect,
  fromBase64,
  resize,
  write,
  type SshEvent,
} from "@/lib/ssh/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: SshHost | null;
  /** All managed hosts, used to resolve a host's ProxyJump chain. */
  hosts: SshHost[];
}

type Status = "connecting" | "connected" | "disconnected" | "error";

export function SshTerminal({ open, onOpenChange, host, hosts }: Props) {
  const { t } = useTranslation("pages");
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Tear down the active SSH session and xterm instance.
  const teardown = async () => {
    const sid = sessionRef.current;
    sessionRef.current = null;
    if (sid) {
      try {
        await disconnect(sid);
      } catch {
        // best effort
      }
    }
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
  };

  useEffect(() => {
    if (!open || !host) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const start = async () => {
      setStatus("connecting");
      setMessage(null);

      const term = new Terminal({
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        theme: { background: "#0a0a0a", foreground: "#e5e5e5" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      fitRef.current = fit;

      const el = containerRef.current;
      if (!el) return;
      term.open(el);
      fit.fit();

      try {
        const config = await buildConnectConfig(
          host,
          hosts,
          term.cols,
          term.rows
        );
        if (disposed) return;

        const onEvent = (event: SshEvent) => {
          if (event.type === "data") {
            term.write(fromBase64(event.data));
          } else if (event.type === "closed") {
            setStatus("disconnected");
            term.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
          } else if (event.type === "error") {
            setStatus("error");
            setMessage(event.message);
            term.write(`\r\n\x1b[31m${event.message}\x1b[0m\r\n`);
          }
        };

        const result = await connect(config, onEvent);
        if (disposed) {
          await disconnect(result.sessionId).catch(() => {});
          return;
        }
        sessionRef.current = result.sessionId;
        setStatus("connected");

        term.onData((data) => {
          if (sessionRef.current) write(sessionRef.current, data).catch(() => {});
        });

        resizeObserver = new ResizeObserver(() => {
          if (!fitRef.current || !termRef.current) return;
          fitRef.current.fit();
          if (sessionRef.current) {
            resize(sessionRef.current, termRef.current.cols, termRef.current.rows).catch(
              () => {}
            );
          }
        });
        resizeObserver.observe(el);
        term.focus();
      } catch (e) {
        if (disposed) return;
        setStatus("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    };

    start();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host, attempt]);

  const handleOpenChange = (o: boolean) => {
    if (!o) teardown();
    onOpenChange(o);
  };

  const statusBadge = () => {
    switch (status) {
      case "connecting":
        return (
          <Badge variant="outline" className="rounded-sm gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("ssh_connecting")}
          </Badge>
        );
      case "connected":
        return (
          <Badge variant="accent" className="rounded-sm gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {t("ssh_connected")}
          </Badge>
        );
      case "disconnected":
        return (
          <Badge variant="outline" className="rounded-sm">
            {t("ssh_disconnected")}
          </Badge>
        );
      case "error":
        return (
          <Badge variant="outline" className="rounded-sm text-destructive">
            {t("ssh_connect_failed")}
          </Badge>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[920px] gap-3 p-0">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border py-3 pl-5 pr-14">
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="flex items-center gap-2 truncate text-heading-16">
              <TerminalSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{host?.name}</span>
            </DialogTitle>
            <span className="truncate pl-6 text-label-12 font-mono text-muted-foreground">
              {host ? `${host.username}@${host.hostname}:${host.port}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(status === "disconnected" || status === "error") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAttempt((a) => a + 1)}
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("ssh_reconnect")}</span>
              </Button>
            )}
            {statusBadge()}
          </div>
        </DialogHeader>

        {message && status === "error" && (
          <p className="px-5 text-label-12 text-destructive">{message}</p>
        )}

        <div
          ref={containerRef}
          className="h-[460px] w-full overflow-hidden rounded-b-lg bg-[#0a0a0a] px-3 py-2"
        />
      </DialogContent>
    </Dialog>
  );
}
