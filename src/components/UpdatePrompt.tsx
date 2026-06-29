import { Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/lib/useUpdater";

/**
 * App-wide auto-update prompt. Silently checks on mount and only surfaces a
 * dialog when a newer version is found or while it downloads/installs.
 */
export function UpdatePrompt() {
  const { t } = useTranslation("pages");
  const { state, install, dismiss } = useUpdater({ auto: true });

  const open =
    state.phase === "available" ||
    state.phase === "downloading" ||
    state.phase === "ready";

  const busy = state.phase === "downloading" || state.phase === "ready";

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? dismiss() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("update_available_title")}</DialogTitle>
          <DialogDescription>
            {t("update_available_desc", {
              version: state.newVersion,
              current: state.currentVersion,
            })}
          </DialogDescription>
        </DialogHeader>

        {state.notes && (
          <pre className="max-h-48 overflow-auto rounded-md bg-secondary p-3 text-copy-13 whitespace-pre-wrap text-muted-foreground">
            {state.notes}
          </pre>
        )}

        {busy && (
          <div className="mt-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <p className="mt-2 text-label-13 text-muted-foreground">
              {state.phase === "ready"
                ? t("update_relaunching")
                : t("update_downloading", { progress: state.progress })}
            </p>
          </div>
        )}

        {!busy && (
          <DialogFooter>
            <Button variant="secondary" onClick={dismiss}>
              {t("update_later")}
            </Button>
            <Button onClick={install}>
              <Download className="h-4 w-4" />
              {t("update_install_now")}
            </Button>
          </DialogFooter>
        )}
        {busy && (
          <DialogFooter>
            <Button variant="secondary" disabled>
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("update_installing")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
