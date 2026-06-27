import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, isTauri } from "@/lib/utils";
import {
  browserBack,
  browserForward,
  browserReload,
  getBrowserStatus,
  hideBrowser,
  onBrowserLoading,
  onBrowserNavigated,
  openBrowser,
  setBrowserBounds,
  showBrowser,
  type BrowserBounds,
} from "@/lib/browser";

const QUICK_LINKS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
];

export interface BrowserPreviewProps {
  /** When set (paired with a changing `navNonce`), auto-navigates to this URL. */
  navUrl?: string | null;
  /** Bump to force navigation even when `navUrl` is unchanged. */
  navNonce?: number;
  /** Show a close button in the toolbar. */
  onClose?: () => void;
  /** Render quick-link shortcuts on the empty state (standalone browser page). */
  showQuickLinks?: boolean;
  className?: string;
}

/**
 * Hosts the single native embedded webview (driven by Rust) and a navigation
 * toolbar. Shared by the standalone Browser page and the in-chat DataAgent
 * preview panel. Only one instance should be mounted at a time, which the app's
 * mutually-exclusive tool/agent layouts already guarantee.
 */
export function BrowserPreview({
  navUrl,
  navNonce,
  onClose,
  showQuickLinks = false,
  className,
}: BrowserPreviewProps) {
  const { t } = useTranslation("pages");
  const desktop = isTauri();

  const hostRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const lastNavRef = useRef<number | undefined>(undefined);

  const readBounds = useCallback((): BrowserBounds | null => {
    const el = hostRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, []);

  const syncBounds = useCallback(() => {
    const bounds = readBounds();
    if (bounds) void setBrowserBounds(bounds);
  }, [readBounds]);

  const go = useCallback(
    (raw?: string) => {
      const url = (raw ?? address).trim();
      if (!url) return;
      const bounds = readBounds();
      if (!bounds) return;
      setLoading(true);
      void openBrowser(url, bounds);
    },
    [address, readBounds]
  );

  // Subscribe to navigation / loading events and restore an existing session.
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const unsubs: Array<() => void> = [];

    void onBrowserNavigated((p) => {
      if (!active) return;
      setCurrentUrl(p.url);
      setAddress(p.url);
      setCanGoBack(p.canGoBack);
      setCanGoForward(p.canGoForward);
    }).then((u) => unsubs.push(u));

    void onBrowserLoading((l) => {
      if (active) setLoading(l);
    }).then((u) => unsubs.push(u));

    void getBrowserStatus().then((s) => {
      if (!active) return;
      if (s.exists) {
        if (s.url) {
          setCurrentUrl(s.url);
          setAddress(s.url);
        }
        setCanGoBack(s.canGoBack);
        setCanGoForward(s.canGoForward);
        syncBounds();
        void showBrowser();
      }
    });

    return () => {
      active = false;
      unsubs.forEach((u) => u());
      // Keep the webview alive across mounts, just hide it.
      void hideBrowser();
    };
  }, [desktop, syncBounds]);

  // Keep the native webview aligned with the host element.
  useLayoutEffect(() => {
    if (!desktop) return;
    syncBounds();
    const el = hostRef.current;
    const ro = el ? new ResizeObserver(() => syncBounds()) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", syncBounds);
    document.addEventListener("scroll", syncBounds, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncBounds);
      document.removeEventListener("scroll", syncBounds, true);
    };
  }, [desktop, syncBounds]);

  // Auto-navigate when an external URL is supplied (e.g. DataAgent artifact).
  useEffect(() => {
    if (!desktop || !navUrl) return;
    if (lastNavRef.current === navNonce) return;
    lastNavRef.current = navNonce;
    setAddress(navUrl);
    // Defer so the host element has its final bounds before opening.
    const id = requestAnimationFrame(() => go(navUrl));
    return () => cancelAnimationFrame(id);
  }, [desktop, navUrl, navNonce, go]);

  if (!desktop) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-background-secondary p-6 text-center",
          className
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Globe className="h-5 w-5" />
        </div>
        <p className="max-w-sm text-copy-14 text-muted-foreground">
          {t("browser_desktop_only_desc")}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="mb-3 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void browserBack()}
          disabled={!canGoBack}
          title={t("browser_back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void browserForward()}
          disabled={!canGoForward}
          title={t("browser_forward")}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void browserReload()}
          disabled={!currentUrl}
          title={t("browser_reload")}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCw className="h-4 w-4" />
          )}
        </Button>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("browser_address_placeholder")}
            spellCheck={false}
            className="flex-1 font-mono text-copy-13"
          />
          <Button type="submit" size="sm" disabled={!address.trim()}>
            {t("browser_go")}
          </Button>
        </form>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title={t("browser_close_preview")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div
        ref={hostRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-background-secondary"
      >
        {!currentUrl && (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Globe className="h-5 w-5" />
            </div>
            <p className="max-w-sm text-copy-14 text-muted-foreground">
              {t("browser_empty_hint")}
            </p>
            {showQuickLinks && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {QUICK_LINKS.map((link) => (
                  <Button
                    key={link}
                    variant="secondary"
                    size="sm"
                    className="font-mono"
                    onClick={() => {
                      setAddress(link);
                      go(link);
                    }}
                  >
                    {link.replace(/^https?:\/\//, "")}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
