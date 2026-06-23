import { NavLink } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  LayoutDashboard,
  Boxes,
  Server,
  Wrench,
  Settings,
  Hammer,
  Cloud,
  MessageSquare,
  Network,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/store/sidebar";
import { useThemeStore } from "@/store/theme";

const navItems = [
  { to: "/", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/providers", label: "模型接入", icon: Cloud },
  { to: "/playground", label: "Playground", icon: MessageSquare },
  { to: "/unified", label: "Unified API", icon: Network },
  { to: "/skills", label: "Skills", icon: Boxes },
  { to: "/mcp", label: "MCP Servers", icon: Server },
  { to: "/tools", label: "实用工具", icon: Wrench },
  { to: "/settings", label: "设置", icon: Settings },
];

const EXPANDED = 240;
const COLLAPSED = 64;

export function Sidebar() {
  const reduce = useReducedMotion();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const labelTransition = reduce
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? COLLAPSED : EXPANDED }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 38 }
      }
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-chrome"
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2",
          collapsed ? "justify-center px-0" : "px-5"
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-geist-sm">
          <Hammer className="h-4 w-4" />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={reduce ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -4 }}
              transition={labelTransition}
              className="whitespace-nowrap text-heading-14 tracking-tight"
            >
              LLMToolForge
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className="group relative block"
          >
            {({ isActive }) => (
              <span
                className={cn(
                  "relative z-10 flex items-center gap-2.5 rounded-sm py-2 text-label-14 transition-colors duration-150",
                  collapsed ? "justify-center px-0" : "px-2.5",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:bg-secondary/60 group-hover:text-foreground"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-sm bg-secondary"
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 520, damping: 40 }
                    }
                  />
                )}
                <Icon className="h-4 w-4 shrink-0" />
                <AnimatePresence initial={false}>
                  {!collapsed && (
                    <motion.span
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={reduce ? undefined : { opacity: 0 }}
                      transition={labelTransition}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div
        className={cn(
          "flex flex-col gap-1 border-t border-border/60 py-3",
          collapsed ? "items-center px-2" : "px-3"
        )}
      >
        <button
          onClick={toggleTheme}
          aria-label="切换主题"
          title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-sm text-label-13 text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground",
            collapsed ? "w-9 justify-center px-0" : "px-2.5"
          )}
        >
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={reduce ? false : { opacity: 0, rotate: -90, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, rotate: 90, scale: 0.6 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </motion.span>
            </AnimatePresence>
          </span>
          {!collapsed && (
            <span className="whitespace-nowrap">
              {theme === "dark" ? "亮色模式" : "暗色模式"}
            </span>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
