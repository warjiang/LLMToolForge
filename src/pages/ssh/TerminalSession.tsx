import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
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

export type SessionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface Props {
  host: SshHost;
  /** All managed hosts, used to resolve a host's ProxyJump chain. */
  hosts: SshHost[];
  /** Whether this session's pane is currently visible (the active tab). */
  active: boolean;
  /** Bubbles status changes up so the tab bar can render a state dot. */
  onStatusChange?: (status: SessionStatus) => void;
}

/**
 * A single, self-contained SSH terminal: owns one xterm instance and one
 * backend session. It is mounted once when its tab is created and stays mounted
 * (hidden via CSS when inactive) so the connection survives tab switches — only
 * unmounting (closing the tab) tears the session down. Re-fits and focuses when
 * it becomes the active tab, since a hidden xterm cannot measure itself.
 */
export function TerminalSession({ host, hosts, active, onStatusChange }: Props) {
  const { t } = useTranslation("pages");
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // Recompute terminal dimensions to exactly fill its (visible) container and
  // push the new size to the remote PTY. Guards against fitting while hidden,
  // which would otherwise lock in a stale/oversized row count and clip the
  // bottom line once the pane is shown again.
  const refit = useCallback(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    const el = containerRef.current;
    if (!fit || !term || !el) return;
    if (el.clientWidth === 0 || el.clientHeight === 0) return;
    fit.fit();
    if (sessionRef.current) {
      resize(sessionRef.current, term.cols, term.rows).catch(() => {});
    }
  }, []);

  // Re-fit + focus whenever this pane becomes visible. A hidden (display:none)
  // xterm reports zero size, so we must recompute dimensions on show.
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      refit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [active, refit]);

  // The window resizing changes the container without firing a ResizeObserver
  // entry in some WebKit layout paths, so refit on it as a safety net.
  useEffect(() => {
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [refit]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const refitTimers: number[] = [];

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

    const start = async () => {
      setStatus("connecting");
      setMessage(null);

      const term = new Terminal({
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        // xterm v6 renders a VS Code-style overlay scrollbar whose width is
        // driven by overviewRuler.width (default 14px and not stylable via CSS).
        // Pin it slim and recolor the slider through the theme.
        overviewRuler: { width: 8 },
        theme: {
          background: "#0a0a0a",
          foreground: "#e5e5e5",
          scrollbarSliderBackground: "rgba(255, 255, 255, 0.18)",
          scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.32)",
          scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.42)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      fitRef.current = fit;

      // The pane can mount a tick after this effect fires, so wait for the ref
      // instead of silently bailing — a silent return here would leave the UI
      // stuck on "connecting" forever.
      let el = containerRef.current;
      for (let i = 0; i < 60 && !el && !disposed; i += 1) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        el = containerRef.current;
      }
      if (disposed) return;
      if (!el) {
        setStatus("error");
        setMessage("terminal container failed to mount");
        return;
      }
      term.open(el);
      // Let the renderer create its viewport/scrollable element and settle the
      // font metrics for a frame before the first measurement, otherwise the
      // initial fit can lock in one row too many and clip the bottom line.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (disposed) return;
      refit();

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

        // Layout often settles a frame or two after the connection resolves
        // (fonts, flex sizing, the pane's enter transition). Re-fit a couple of
        // times so the row count matches the final container height and the
        // bottom line is never left clipped under the rounded border.
        refitTimers.push(window.setTimeout(refit, 50));
        refitTimers.push(window.setTimeout(refit, 300));

        resizeObserver = new ResizeObserver(() => {
          refit();
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
      refitTimers.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {(status === "disconnected" || status === "error") && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-background-secondary px-4 py-2">
          <p className="truncate text-label-12 text-muted-foreground">
            {status === "error" && message
              ? message
              : t("ssh_disconnected")}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAttempt((a) => a + 1)}
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("ssh_reconnect")}</span>
          </Button>
        </div>
      )}
      <div
        ref={containerRef}
        className="min-h-0 w-full flex-1 overflow-hidden bg-[#0a0a0a] px-3 py-2"
      />
    </div>
  );
}
