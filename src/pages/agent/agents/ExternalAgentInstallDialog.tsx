import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentDefStore } from "@/store";
import { useUnifiedStore } from "@/store/unified";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Manifest returned by the Rust `agent_read_manifest` command. */
interface AgentManifest {
  id: string;
  name: string;
  description: string;
  runtime: "python" | "node";
  entry: string;
  framework?: string | null;
  packageDir: string;
  defaultModel?: string | null;
  defaultTemperature?: number | null;
  defaultMaxTokens?: number | null;
  defaultSystemPrompt?: string | null;
}

interface BuildEnvResult {
  ok: boolean;
  envPath: string;
  exitCode: number | null;
}

interface InstallLine {
  taskId: string;
  stream: string;
  line: string;
}

type Phase = "idle" | "reading" | "review" | "building" | "done" | "error";

export function ExternalAgentInstallDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const add = useAgentDefStore((s) => s.add);
  const unifiedModels = useUnifiedStore((s) => s.models);
  const unifiedConfig = useUnifiedStore((s) => s.config);

  const [phase, setPhase] = useState<Phase>("idle");
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setManifest(null);
      setName("");
      setDescription("");
      setModelId("");
      setLog([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const disabledModelIds = new Set(unifiedConfig.disabledModelIds);
  const availableModels = unifiedModels.filter(
    (m) => !disabledModelIds.has(m.id)
  );

  const chooseFolder = async () => {
    setError(null);
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: t("agents_install_choose_folder"),
    });
    const dir = Array.isArray(picked) ? picked[0] : picked;
    if (!dir) return;

    setPhase("reading");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const m = await invoke<AgentManifest>("agent_read_manifest", {
        packageDir: dir,
      });
      setManifest(m);
      setName(m.name || m.id);
      setDescription(m.description || "");
      setModelId(
        m.defaultModel && availableModels.some((x) => x.id === m.defaultModel)
          ? m.defaultModel
          : ""
      );
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  };

  const install = async () => {
    if (!manifest) return;
    if (!name.trim()) return setError(t("agents_name_required"));
    if (!modelId) return setError(t("agents_model_required"));
    setError(null);
    setLog([]);
    setPhase("building");

    const taskId = `install-${manifest.id}-${Date.now()}`;
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const unlisten = await listen<InstallLine>(
      `agent://install/${taskId}`,
      (e) => {
        if (e.payload?.taskId !== taskId) return;
        setLog((prev) => [...prev, e.payload.line]);
      }
    );

    try {
      const res = await invoke<BuildEnvResult>("agent_build_env", {
        taskId,
        spec: { runtime: manifest.runtime, packageDir: manifest.packageDir },
      });
      unlisten();

      if (!res.ok) {
        setError(
          t("agents_install_failed", { code: res.exitCode ?? "?" })
        );
        setPhase("error");
        return;
      }

      await add({
        name: name.trim(),
        description: description.trim(),
        systemPrompt: manifest.defaultSystemPrompt ?? "",
        modelId,
        enabledInternalTools: [],
        enabledSkillIds: [],
        enabledMcpServerIds: [],
        sandboxMode: "workspace-write",
        workspacePath: "",
        temperature: manifest.defaultTemperature ?? 0.7,
        maxTokens: manifest.defaultMaxTokens ?? 4096,
        kind: "external",
        external: {
          packageId: manifest.id,
          runtime: manifest.runtime,
          entry: manifest.entry,
          packageDir: manifest.packageDir,
          envPath: res.envPath,
          framework: manifest.framework ?? undefined,
        },
      });
      setPhase("done");
    } catch (e) {
      unlisten();
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const building = phase === "building";
  const showReview =
    phase === "review" ||
    phase === "building" ||
    phase === "done" ||
    phase === "error";

  return (
    <Dialog open={open} onOpenChange={(o) => !building && onOpenChange(o)}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("agents_install_title")}</DialogTitle>
          <DialogDescription>{t("agents_install_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!showReview && (
            <div className="grid gap-1.5">
              <Button
                variant="secondary"
                onClick={chooseFolder}
                disabled={phase === "reading"}
              >
                {phase === "reading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="h-4 w-4" />
                )}
                {t("agents_install_choose_folder")}
              </Button>
              <p className="text-label-12 text-muted-foreground">
                {t("agents_install_folder_hint")}
              </p>
            </div>
          )}

          {manifest && showReview && (
            <>
              <div className="rounded-sm border border-border px-3 py-2.5 text-label-13">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{manifest.id}</span>
                  <Badge variant="outline" className="px-1 py-0">
                    {manifest.runtime}
                  </Badge>
                  {manifest.framework && (
                    <Badge variant="outline" className="px-1 py-0">
                      {manifest.framework}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-label-12 text-muted-foreground">
                  {manifest.packageDir}/{manifest.entry}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="ext-name">{t("name", { ns: "common" })}</Label>
                <Input
                  id="ext-name"
                  value={name}
                  disabled={building}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="ext-desc">
                  {t("agents_description_label")}
                </Label>
                <Input
                  id="ext-desc"
                  value={description}
                  disabled={building}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label>{t("agents_model_label")}</Label>
                <Select
                  value={modelId}
                  onValueChange={setModelId}
                  disabled={building}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("agents_model_placeholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.length === 0 ? (
                      <div className="px-2 py-1.5 text-label-12 text-muted-foreground">
                        {t("agents_no_models")}
                      </div>
                    ) : (
                      availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-label-12 text-muted-foreground">
                  {t("agents_model_hint")}
                </p>
              </div>
            </>
          )}

          {log.length > 0 && (
            <div className="grid gap-1.5">
              <Label>{t("agents_install_build_log")}</Label>
              <div className="max-h-48 overflow-y-auto rounded-sm border border-border bg-muted/40 p-2 font-mono text-label-12">
                {log.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {phase === "done" && (
            <p className="flex items-center gap-1.5 text-label-13 text-success">
              <CheckCircle2 className="h-4 w-4" />
              {t("agents_install_success")}
            </p>
          )}
          {error && (
            <p className="flex items-center gap-1.5 text-label-13 text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          {phase === "done" ? (
            <Button onClick={() => onOpenChange(false)}>
              {t("close", { ns: "common" })}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={building}
                onClick={() => onOpenChange(false)}
              >
                {t("cancel", { ns: "common" })}
              </Button>
              {showReview && (
                <Button onClick={install} disabled={building}>
                  {building ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("agents_install_building")}
                    </>
                  ) : (
                    t("agents_install_build")
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
