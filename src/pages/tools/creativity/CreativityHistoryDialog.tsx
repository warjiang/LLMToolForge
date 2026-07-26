import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
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
  onDelete,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: CreativityHistoryRecord[];
  onDelete: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const { t } = useTranslation("pages");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <DialogTitle>{t("creativity_history")}</DialogTitle>
                <DialogDescription>
                  {t("creativity_history_desc")}
                </DialogDescription>
              </div>
              {records.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClearPending(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("creativity_clear_history")}
                </Button>
              )}
            </div>
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
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-label-14 font-medium">
                        {record.prompt.items
                          .map((item) => item.text)
                          .join(" + ")}
                      </div>
                      <div className="mt-1 text-label-12 text-muted-foreground">
                        {formatDateTime(record.updatedAt)}
                      </div>
                      {record.answer && (
                        <p className="mt-3 text-copy-14">{record.answer}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(record.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("creativity_delete_record")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={t("creativity_delete_record")}
        description={t("creativity_delete_record_desc")}
        confirmLabel={t("creativity_delete_record")}
        onConfirm={() => {
          if (pendingDelete) void onDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
      <ConfirmDialog
        open={clearPending}
        onOpenChange={setClearPending}
        title={t("creativity_clear_history_title")}
        description={t("creativity_clear_history_desc")}
        confirmLabel={t("creativity_clear_history")}
        onConfirm={() => {
          void onClear();
          setClearPending(false);
        }}
      />
    </>
  );
}
