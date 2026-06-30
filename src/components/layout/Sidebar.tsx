import { NavLink } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Boxes,
  Server,
  TerminalSquare,
  Wrench,
  Globe,
  Settings,
  Cloud,
  Network,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/store/sidebar";
import { useThemeStore } from "@/store/theme";
import { FormModeToggle } from "./FormModeToggle";
import { useLocaleStore } from "@/store/locale";

const EXPANDED = 240;
const COLLAPSED = 64;

export function Sidebar() {
  const { t } = useTranslation("navigation");
  const reduce = useReducedMotion();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  const navItems = [
    { to: "/", label: t("dashboard"), icon: LayoutDashboard, end: true },
    { to: "/providers", label: t("providers"), icon: Cloud },
    { to: "/unified", label: t("unified_api"), icon: Network },
    { to: "/skills", label: t("skills"), icon: Boxes },
    { to: "/mcp", label: t("mcp_servers"), icon: Server },
    { to: "/ssh", label: t("ssh"), icon: TerminalSquare },
    { to: "/tools", label: t("tools"), icon: Wrench },
    { to: "/browser", label: t("browser"), icon: Globe },
    { to: "/settings", label: t("settings"), icon: Settings },
  ];

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
                    ? "font-medium text-foreground"
                    : "text-muted-foreground group-hover:bg-secondary/60 group-hover:text-foreground"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-sm bg-muted ring-1 ring-inset ring-border"
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
          "flex border-t border-border/60 py-3",
          collapsed
            ? "flex-col items-center gap-1 px-2"
            : "items-center justify-between px-3"
        )}
      >
        <div
          className={cn(
            "flex items-center",
            collapsed ? "flex-col gap-1" : "gap-1"
          )}
        >
          <button
            onClick={toggleTheme}
            aria-label={t("theme_toggle")}
            title={theme === "dark" ? t("switch_to_light") : t("switch_to_dark")}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground"
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
          </button>

          <button
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            aria-label={t("language")}
            title={t("select_language")}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={language}
                initial={reduce ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="text-[11px] font-semibold leading-none"
              >
                {language === "zh" ? "中" : "EN"}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
        <FormModeToggle />
      </div>
    </motion.aside>
  );
}
