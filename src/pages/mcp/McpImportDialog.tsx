import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useMcpStore } from "@/store";
import { parseMcpJson } from "./importMcp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { "API_TOKEN": "xxx" }
    },
    "remote": {
      "url": "https://example.com/mcp",
      "type": "http"
    }
  }
}`;

export function McpImportDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const add = useMcpStore((s) => s.add);
  const items = useMcpStore((s) => s.items);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const result = useMemo(
    () => (text.trim() ? parseMcpJson(text) : null),
    [text]
  );

  const { importable, conflicts } = useMemo(() => {
    if (!result) return { importable: [], conflicts: [] as string[] };
    const existing = new Set(
      items.map((s) => s.name.trim().toLowerCase())
    );
    const seen = new Set<string>();
    const importable: typeof result.servers = [];
    const conflicts: string[] = [];
    for (const server of result.servers) {
      const key = server.name.trim().toLowerCase();
      if (existing.has(key)) {
        conflicts.push(t("mcp_import_conflict_existing", { name: server.name }));
      } else if (seen.has(key)) {
        conflicts.push(t("mcp_import_conflict_duplicate", { name: server.name }));
      } else {
        seen.add(key);
        importable.push(server);
      }
    }
    return { importable, conflicts };
  }, [result, items, t]);

  const submit = async () => {
    if (importable.length === 0) {
      setError(t("mcp_import_none"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      for (const server of importable) {
        await add(server);
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mcp_import_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("mcp_import_title")}</DialogTitle>
          <DialogDescription>{t("mcp_import_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="mcp-import-json">{t("mcp_import_json_label")}</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setText(SAMPLE)}
              >
                {t("mcp_import_sample")}
              </Button>
            </div>
            <Textarea
              id="mcp-import-json"
              className="min-h-[220px] font-mono text-label-12"
              placeholder={SAMPLE}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          {result && (
            <div className="grid gap-2">
              {importable.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label-13 text-muted-foreground">
                    {t("mcp_import_detected", { count: importable.length })}
                  </span>
                  {importable.map((s) => (
                    <Badge key={s.name} variant="outline" className="gap-1.5">
                      {s.name}
                      <span className="uppercase text-muted-foreground">
                        {s.transport}
                      </span>
                    </Badge>
                  ))}
                </div>
              )}
              {(result.errors.length > 0 || conflicts.length > 0) && (
                <ul className="space-y-0.5 text-label-12 text-destructive">
                  {conflicts.map((msg, i) => (
                    <li key={`c-${i}`}>{msg}</li>
                  ))}
                  {result.errors.map((err, i) => (
                    <li key={`e-${i}`}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel", { ns: "common" })}
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || importable.length === 0}
          >
            {t("mcp_import_action", { count: importable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
