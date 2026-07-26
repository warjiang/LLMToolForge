import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CreativityHistoryRecord } from "@/lib/creativity/types";
import { formatDateTime } from "@/lib/utils";

export function CreativityHistoryDialog({
  open,
  onOpenChange,
  records,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: CreativityHistoryRecord[];
}) {
  const { t } = useTranslation("pages");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("creativity_history")}</DialogTitle>
          <DialogDescription>
            {t("creativity_history_desc")}
          </DialogDescription>
        </DialogHeader>
        {records.length === 0 ? (
          <p className="py-10 text-center text-copy-14 text-muted-foreground">
            {t("creativity_history_empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {records.map((record) => (
              <div
                key={record.id}
                className="rounded-md border border-border bg-background-secondary p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-label-14 font-medium">
                    {record.prompt.items.map((item) => item.text).join(" + ")}
                  </span>
                  <span className="text-label-12 text-muted-foreground">
                    {formatDateTime(record.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
