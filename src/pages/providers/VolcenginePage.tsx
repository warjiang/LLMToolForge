import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Cloud,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModelFeatureBadges } from "@/components/common/ModelFeatureBadges";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVolcCredentialStore } from "@/store";
import type { ArkApiKeyRef, VolcCredential } from "@/types";
import { cn, maskSecret } from "@/lib/utils";
import { isLiveRequestSupported } from "@/lib/http";
import type { ModelInfo } from "@/lib/providers/types";
import {
  getRawApiKey,
  listApiKeys,
  listEndpoints,
} from "@/lib/providers/volcengine";
import { VolcCredentialDialog } from "./VolcCredentialDialog";

export function VolcenginePage() {
  const { items, loaded, load } = useVolcCredentialStore();
  const remove = useVolcCredentialStore((s) => s.remove);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VolcCredential | null>(null);
  const [deleting, setDeleting] = useState<VolcCredential | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id);
    if (selectedId && !items.some((c) => c.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const selected = items.find((c) => c.id === selectedId) ?? null;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Volcengine 火山引擎"
        description="录入 AK/SK，自动拉取已开通的模型与 Ark API Key，用于在 Playground 中测试。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建凭证
          </Button>
        }
      />

      {!isLiveRequestSupported() && (
        <div className="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-2.5 text-label-13 text-amber-900">
          浏览器开发模式下，跨域请求会被拦截。请在桌面应用（pnpm tauri:dev）中使用拉取功能。
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Cloud}
          title="还没有火山引擎凭证"
          description="添加你的 AccessKey / SecretKey，开始拉取已开通的模型。"
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建凭证
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-2">
            {items.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                  c.id === selectedId
                    ? "border-foreground/20 bg-secondary"
                    : "border-border hover:bg-secondary/50"
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                  <Cloud className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-label-14 font-medium">
                    {c.name}
                  </div>
                  <div className="truncate text-label-12 text-muted-foreground">
                    {c.region} · {c.apiKeys.length} Key
                  </div>
                </div>
                <RowMenu
                  onEdit={() => {
                    setEditing(c);
                    setDialogOpen(true);
                  }}
                  onDelete={() => setDeleting(c)}
                />
              </button>
            ))}
          </div>

          {selected && <CredentialDetail credential={selected} />}
        </div>
      )}

      <VolcCredentialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        description={`确定删除 “${deleting?.name}” 吗？此操作无法撤销。`}
        onConfirm={() => {
          if (deleting) remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function CredentialDetail({ credential }: { credential: VolcCredential }) {
  const edit = useVolcCredentialStore((s) => s.edit);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [keysLoading, setKeysLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cred = useMemo(
    () => ({
      accessKey: credential.accessKey,
      secretKey: credential.secretKey,
      region: credential.region,
      project: credential.project,
    }),
    [credential]
  );

  const fetchModels = async () => {
    setError(null);
    setModelsLoading(true);
    try {
      setModels(await listEndpoints(cred));
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setModelsLoading(false);
    }
  };

  const fetchKeys = async () => {
    setError(null);
    setKeysLoading(true);
    try {
      const summaries = await listApiKeys(cred);
      const refs: ArkApiKeyRef[] = [];
      for (const s of summaries) {
        let key: string | undefined;
        try {
          key = await getRawApiKey(s.id, cred);
        } catch {
          key = undefined;
        }
        refs.push({ arkId: s.id, name: s.name, key });
      }
      await edit(credential.id, { apiKeys: refs });
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉取 API Key 失败");
    } finally {
      setKeysLoading(false);
    }
  };

  return (
    <Card className="p-5">
      {error && (
        <div className="mb-4 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-label-13 text-destructive">
          {error}
        </div>
      )}
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">
            <Boxes className="h-3.5 w-3.5" />
            模型 {models.length > 0 && `(${models.length})`}
          </TabsTrigger>
          <TabsTrigger value="keys">
            <KeyRound className="h-3.5 w-3.5" />
            Ark API Key {credential.apiKeys.length > 0 && `(${credential.apiKeys.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="models">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-label-13 text-muted-foreground">
              已开通的模型（推理 Endpoint）
            </p>
            <Button size="sm" variant="secondary" onClick={fetchModels} disabled={modelsLoading}>
              {modelsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              拉取模型
            </Button>
          </div>
          {models.length === 0 ? (
            <p className="py-8 text-center text-label-13 text-muted-foreground">
              点击「拉取模型」获取已开通的模型列表。
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {models.map((m) => (
                <div key={m.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-label-14 font-medium">{m.name}</span>
                    <code className="font-mono text-label-12 text-muted-foreground">
                      {m.id}
                    </code>
                  </div>
                  <ModelFeatureBadges model={m} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="keys">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-label-13 text-muted-foreground">
              用于调用模型的 Ark API Key（Bearer）
            </p>
            <Button size="sm" variant="secondary" onClick={fetchKeys} disabled={keysLoading}>
              {keysLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              拉取 API Key
            </Button>
          </div>
          {credential.apiKeys.length === 0 ? (
            <p className="py-8 text-center text-label-13 text-muted-foreground">
              点击「拉取 API Key」获取并保存可用于推理的密钥。
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {credential.apiKeys.map((k) => (
                <div
                  key={k.arkId ?? k.name}
                  className="flex items-center gap-3 py-3"
                >
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-label-14 font-medium">
                      {k.name}
                    </div>
                    <code className="font-mono text-label-12 text-muted-foreground">
                      {k.key ? maskSecret(k.key) : "（未获取到密钥）"}
                    </code>
                  </div>
                  {k.key && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigator.clipboard?.writeText(k.key!)}
                    >
                      复制
                    </Button>
                  )}
                  {!k.key && <Badge variant="warning">无值</Badge>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function RowMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
          aria-label="操作"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
