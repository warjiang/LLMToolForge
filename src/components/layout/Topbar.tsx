import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn, isMacOS, isTauri } from "@/lib/utils";
import { useSidebarStore } from "@/store/sidebar";

function historyIdx(): number {
  return (window.history.state?.idx as number) ?? 0;
}

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggle);

  const [idx, setIdx] = useState(historyIdx);
  const [maxIdx, setMaxIdx] = useState(historyIdx);

  useEffect(() => {
    const cur = historyIdx();
    setIdx(cur);
    setMaxIdx((m) => Math.max(m, cur));
  }, [location]);

  const canBack = idx > 0;
  const canForward = idx < maxIdx;

  // On macOS the native traffic lights sit at the top-left; pad past them so our
  // left control doesn't overlap. Only when running inside the Tauri macOS window.
  const trafficLightPad = useMemo(() => isTauri() && isMacOS(), []);

  const btn =
    "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-all duration-150 ease-geist hover:bg-secondary/60 hover:text-foreground active:scale-[0.92] disabled:pointer-events-none disabled:opacity-30";

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-11 shrink-0 items-center justify-between border-b border-border bg-chrome pr-3",
        trafficLightPad ? "pl-[84px]" : "pl-3"
      )}
    >
      <button
        onClick={toggleSidebar}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        className={cn(btn)}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>

      <div className="flex items-center gap-0.5">
        <button
          onClick={() => navigate(-1)}
          disabled={!canBack}
          aria-label="后退"
          title="后退"
          className={cn(btn)}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={() => navigate(1)}
          disabled={!canForward}
          aria-label="前进"
          title="前进"
          className={cn(btn)}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
