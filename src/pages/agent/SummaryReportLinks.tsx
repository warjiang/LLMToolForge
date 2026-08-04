import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SummaryReportArtifact } from "./summaryReportArtifacts";

export function SummaryReportLinks({
  reports,
  openLabel,
  onOpen,
}: {
  reports: readonly SummaryReportArtifact[];
  openLabel: string;
  onOpen: (report: SummaryReportArtifact) => void;
}) {
  return (
    <div className="grid gap-1.5 border-t border-border/70 pt-2">
      {reports.map((report) => (
        <div
          key={`${report.dir}\0${report.file ?? ""}`}
          className="flex min-w-0 items-center gap-2 rounded-sm bg-secondary/60 px-2.5 py-1.5"
        >
          <Globe className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-label-12 text-foreground">
            {report.title ?? openLabel}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-label-12 text-accent hover:text-accent"
            onClick={() => onOpen(report)}
          >
            {openLabel}
          </Button>
        </div>
      ))}
    </div>
  );
}
