import { motion, useReducedMotion } from "motion/react";
import { Bot, Settings } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAppModeStore, type AppMode } from "@/store/appMode";
import { useSidebarStore } from "@/store/sidebar";
import { AGENT_ROUTE_PATH } from "@/lib/routes";

export function FormModeToggle() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const mode = useAppModeStore((s) => s.mode);

  const switchMode = (nextMode: AppMode) => {
    navigate(nextMode === "agent" ? `/${AGENT_ROUTE_PATH}` : "/");
  };

  const OPTIONS: {
    value: AppMode;
    label: string;
    icon: ComponentType<LucideProps>;
  }[] = [
    { value: "tool", label: t("settings"), icon: Settings },
    { value: "agent", label: "Agent", icon: Bot },
  ];

  if (collapsed) {
    const toAgent = mode === "tool";
    const Icon = toAgent ? Bot : Settings;
    const title = toAgent ? t("switch_to_agent") : t("back_to_settings");
    return (
      <button
        onClick={() => switchMode(toAgent ? "agent" : "tool")}
        title={title}
        aria-label={title}
        className="flex h-9 w-9 items-center justify-center self-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground"
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background-secondary p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            onClick={() => switchMode(value)}
            title={t("switch_to", { label })}
            aria-label={t("switch_to", { label })}
            className={cn(
              "relative flex h-7 w-7 items-center justify-center rounded-sm transition-colors duration-200 ease-geist",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId="form-mode-active"
                className="absolute inset-0 rounded-sm bg-background shadow-geist-sm"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
              />
            )}
            <Icon className="relative z-10 h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
