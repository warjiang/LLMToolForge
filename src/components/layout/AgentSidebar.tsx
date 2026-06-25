import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Check,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  Pencil,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormModeToggle } from "./FormModeToggle";
import { useChatStore } from "@/store";
import { useSidebarStore } from "@/store/sidebar";
import { useThemeStore } from "@/store/theme";
import { useLocaleStore } from "@/store/locale";
import { cn, formatDate } from "@/lib/utils";

const EXPANDED = 240;
const COLLAPSED = 64;

export function AgentSidebar() {
  const { t } = useTranslation("common");
  const reduce = useReducedMotion();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const newSession = useChatStore((s) => s.newSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const pendingDelete = sessions.find((s) => s.id === deleteSessionId);
  const canDeleteSession = sessions.length > 1;

  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenameDraft(title);
  };
  const commitRename = (id: string) => {
    void renameSession(id, renameDraft);
    setRenamingId(null);
    setRenameDraft("");
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? COLLAPSED : EXPANDED }}
      transition={
        reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38 }
      }
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-chrome"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "justify-between px-3"
        )}
      >
        {!collapsed && (
          <div className="text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
            {t("sessions")}
          </div>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => newSession()}
          title={t("new_session")}
          aria-label={t("new_session")}
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {sessions.map((session) => {
            const active = activeSessionId === session.id;
            if (collapsed) {
              return (
                <button
                  key={session.id}
                  title={session.title}
                  onClick={() => selectSession(session.id)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center self-center rounded-sm transition-colors",
                    active
                      ? "bg-muted text-foreground ring-1 ring-inset ring-border"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              );
            }
            const renaming = renamingId === session.id;
            return (
              <div key={session.id} className="group relative">
                {renaming ? (
                  <div className="flex items-center gap-1 px-1 py-1">
                    <Input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(session.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-7 text-label-13"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      title={t("save")}
                      onClick={() => commitRename(session.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      title={t("cancel")}
                      onClick={() => setRenamingId(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      className={cn(
                        "grid w-full gap-1 rounded-sm py-2 pl-3 pr-16 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
                        active && "bg-muted ring-1 ring-inset ring-border"
                      )}
                      onClick={() => selectSession(session.id)}
                    >
                      <span className="truncate text-label-13 font-medium">
                        {session.title}
                      </span>
                      <span className="text-label-12 text-muted-foreground">
                        {formatDate(session.updatedAt)}
                      </span>
                    </button>
                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("rename_session")}
                        onClick={() => startRename(session.id, session.title)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {canDeleteSession && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                          title={t("delete_session")}
                          onClick={() => setDeleteSessionId(session.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
                {language === "zh" ? t("lang_short_zh") : t("lang_short_en")}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
        <FormModeToggle />
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteSessionId(null);
        }}
        title={t("delete_session")}
        description={t("confirm_delete_session", { name: pendingDelete?.title ?? t("sessions") })}
        confirmLabel={t("delete")}
        onConfirm={() => {
          if (pendingDelete) void deleteSession(pendingDelete.id);
          setDeleteSessionId(null);
        }}
      />
    </motion.aside>
  );
}
