import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/config";
import {
  Bot,
  Boxes,
  Check,
  Database,
  Eraser,
  FileAudio,
  FileText,
  FileVideo,
  Loader2,
  Pencil,
  Plus,
  Play,
  RefreshCcw,
  RotateCcw,
  Send,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { TypingDots } from "@/components/common/Reveal";
import { getModelFeatureTitle } from "@/components/common/ModelFeatureBadges";
import {
  ModelIcon,
  ModelIconLabel,
  ProviderIconLabel,
} from "@/components/common/ProviderModelIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  useVolcCredentialStore,
  useGatewayStore,
  useApiKeyStore,
  useChatStore,
  useSkillStore,
  useMcpStore,
} from "@/store";
import { cn, uid } from "@/lib/utils";
import { isLiveRequestSupported } from "@/lib/http";
import { getAdapter } from "@/lib/providers";
import {
  isImageGenerationModel,
  isVideoGenerationModel,
} from "@/lib/providers/capabilities";
import type {
  ChatMessage,
  ChatRequest,
  ContentPart,
  ImageGenerationImage,
  ModelInfo,
  ProviderCredential,
  ToolDefinition,
  VideoGenerationReference,
  VideoGenerationResult,
  VideoGenerationVideo,
  WireFormat,
} from "@/lib/providers/types";
import { listEndpoints } from "@/lib/providers/volcengine";
import type {
  ChatAttachment,
  ChatSessionSettings,
  MessagePart,
  PersistedChatMessage,
  SandboxMode,
} from "@/types/chat";
import {
  PROVIDER_METAS,
  type VolcCredential,
  type GatewayConnection,
  type ApiKey,
} from "@/types";

interface ConnOption {
  key: string;
  name: string;
  kind: "volc" | "gateway" | "manual";
  provider: string;
}

const WIRE_FORMATS: { value: WireFormat; label: string }[] = [
  { value: "openai-chat", label: "OpenAI Chat" },
  { value: "openai-responses", label: "Responses" },
];

const SANDBOX_MODES: { value: SandboxMode; label: string }[] = [
  { value: "read-only", label: "Read only" },
  { value: "workspace-write", label: "Workspace write" },
  { value: "danger-full-access", label: "Full access" },
];

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_MAX_ATTEMPTS = 120;
const VIDEO_FAILED_STATUSES = new Set(["failed", "expired", "cancelled"]);

function providerLabel(provider: string): string {
  const label = PROVIDER_METAS.find((p) => p.id === provider)?.label ?? provider;
  return label.startsWith("provider_label_") ? i18n.t(`pages:${label}`) : label;
}

function safeToolName(prefix: string, value: string): string {
  return `${prefix}_${value}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function jsonParams(value: ChatSessionSettings) {
  return JSON.stringify({
    temperature: Number(value.temperature),
    maxTokens: Number(value.maxTokens),
    streaming: value.streaming,
    wireFormat: value.wireFormat,
  });
}

function imageToDataUrl(image: ImageGenerationImage): string | undefined {
  if (image.url) return image.url;
  if (!image.b64Json) return undefined;
  return `data:${image.mime ?? "image/png"};base64,${image.b64Json}`;
}

function generatedImageAttachment(
  sessionId: string,
  image: ImageGenerationImage,
  index: number
): ChatAttachment {
  return {
    id: uid("att"),
    sessionId,
    kind: "image",
    name: `generated-${index + 1}.png`,
    mime: image.mime ?? "image/png",
    size: 0,
    dataUrl: imageToDataUrl(image),
    hash: image.url ?? undefined,
    createdAt: new Date().toISOString(),
  };
}

function generatedVideoAttachment(
  sessionId: string,
  video: VideoGenerationVideo,
  index: number
): ChatAttachment {
  return {
    id: uid("att"),
    sessionId,
    kind: "video",
    name: `generated-${index + 1}.mp4`,
    mime: video.mime ?? "video/mp4",
    size: 0,
    dataUrl: video.url,
    hash: video.url ?? undefined,
    createdAt: new Date().toISOString(),
  };
}

function attachmentSrc(attachment: ChatAttachment): string | undefined {
  return attachment.dataUrl ?? attachment.path;
}

function mediaKindForUrl(url: string): VideoGenerationReference["kind"] | null {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(clean)) return "image";
  if (/\.(mp4|mov|webm|m4v|mpeg|mpg)$/i.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(clean)) return "audio";
  return null;
}

function mediaKindForAttachment(
  attachment: ChatAttachment
): VideoGenerationReference["kind"] | null {
  if (attachment.kind === "image" || attachment.kind === "video") {
    return attachment.kind;
  }
  if (attachment.kind === "audio") return "audio";
  if (attachment.mime.startsWith("image/")) return "image";
  if (attachment.mime.startsWith("video/")) return "video";
  if (attachment.mime.startsWith("audio/")) return "audio";
  return null;
}

function referenceRole(kind: VideoGenerationReference["kind"]) {
  return `reference_${kind}` as VideoGenerationReference["role"];
}

function videoReferencesFromInput(
  prompt: string,
  attachments: ChatAttachment[]
): VideoGenerationReference[] {
  const references: VideoGenerationReference[] = [];
  const seen = new Set<string>();
  const push = (kind: VideoGenerationReference["kind"], url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    references.push({ kind, url, role: referenceRole(kind) });
  };

  for (const attachment of attachments) {
    const kind = mediaKindForAttachment(attachment);
    const url = attachmentSrc(attachment);
    if (kind && url) push(kind, url);
  }

  for (const match of prompt.matchAll(/https?:\/\/[^\s"'<>),，。]+/g)) {
    const url = match[0];
    const kind = mediaKindForUrl(url);
    if (kind) push(kind, url);
  }
  return references;
}

function taskIdFromMessage(message: PersistedChatMessage): string | null {
  const match = message.content.match(/\bTask ID:\s*([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function videoContentForStatus(taskId: string, status?: string, attempt?: number) {
  const lines = [i18n.t("pages:agent_video_polling"), `Task ID: ${taskId}`];
  if (status) lines.push(i18n.t("pages:agent_video_status", { status }));
  if (attempt != null) lines.push(i18n.t("pages:agent_video_attempt", { attempt }));
  return lines.join("\n");
}

export function AgentChatView() {
  const { t } = useTranslation("pages");
  const volc = useVolcCredentialStore();
  const gateway = useGatewayStore();
  const apiKeys = useApiKeyStore();
  const skills = useSkillStore();
  const mcp = useMcpStore();
  const chat = useChatStore();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoPollingRef = useRef<Set<string>>(new Set());

  const settings = chat.settings;
  const loaded =
    volc.loaded &&
    gateway.loaded &&
    apiKeys.loaded &&
    skills.loaded &&
    mcp.loaded &&
    !!settings;

  useEffect(() => {
    useVolcCredentialStore.getState().load();
    useGatewayStore.getState().load();
    useApiKeyStore.getState().load();
    useSkillStore.getState().load();
    useMcpStore.getState().load();
    useChatStore.getState().init();
  }, []);

  const options = useMemo<ConnOption[]>(() => {
    const volcOpts: ConnOption[] = volc.items.map((c) => ({
      key: `volc:${c.id}`,
      name: c.name,
      kind: "volc",
      provider: "volcengine",
    }));
    const gwOpts: ConnOption[] = gateway.items.map((c) => ({
      key: `gw:${c.id}`,
      name: c.name,
      kind: "gateway",
      provider: c.provider,
    }));
    const keyOpts: ConnOption[] = apiKeys.items.map((c) => ({
      key: `key:${c.id}`,
      name: c.name,
      kind: "manual",
      provider: c.provider,
    }));
    return [...volcOpts, ...gwOpts, ...keyOpts];
  }, [volc.items, gateway.items, apiKeys.items]);

  useEffect(() => {
    if (!settings || options.length === 0) return;
    if (!settings.connKey || !options.some((o) => o.key === settings.connKey)) {
      useChatStore.getState().saveSettings({ connKey: options[0].key });
    }
  }, [options, settings?.connKey]);

  const connKey = settings?.connKey ?? null;
  const volcCred = useMemo<VolcCredential | null>(
    () =>
      connKey?.startsWith("volc:")
        ? volc.items.find((c) => `volc:${c.id}` === connKey) ?? null
        : null,
    [connKey, volc.items]
  );
  const gwConn = useMemo<GatewayConnection | null>(
    () =>
      connKey?.startsWith("gw:")
        ? gateway.items.find((c) => `gw:${c.id}` === connKey) ?? null
        : null,
    [connKey, gateway.items]
  );
  const keyConn = useMemo<ApiKey | null>(
    () =>
      connKey?.startsWith("key:")
        ? apiKeys.items.find((c) => `key:${c.id}` === connKey) ?? null
        : null,
    [connKey, apiKeys.items]
  );
  const isVolc = !!volcCred;
  const provider = volcCred
    ? "volcengine"
    : gwConn
      ? gwConn.provider
      : keyConn
        ? "manual"
        : null;
  const usableKeys = useMemo(
    () => (volcCred?.apiKeys ?? []).filter((k) => k.key),
    [volcCred]
  );
  const manualModels = useMemo<ModelInfo[]>(
    () =>
      (keyConn?.models ?? []).map((id) => ({
        id,
        name: id,
        provider: "manual",
      })),
    [keyConn]
  );
  const storedModels = useMemo<ModelInfo[]>(() => {
    if (volcCred) return volcCred.models ?? [];
    if (gwConn) return gwConn.models ?? [];
    if (keyConn) return manualModels;
    return [];
  }, [volcCred, gwConn, keyConn, manualModels]);
  const modelsForOption = (option: ConnOption): ModelInfo[] => {
    if (option.key === settings?.connKey) return models;
    if (option.kind === "volc") {
      return (
        volc.items.find((c) => `volc:${c.id}` === option.key)?.models ?? []
      );
    }
    if (option.kind === "gateway") {
      return (
        gateway.items.find((c) => `gw:${c.id}` === option.key)?.models ?? []
      );
    }
    const conn = apiKeys.items.find((c) => `key:${c.id}` === option.key);
    return (conn?.models ?? []).map((id) => ({
      id,
      name: id,
      provider: "manual",
    }));
  };
  const selectedModel =
    models.find((m) => m.id === settings?.modelId) ?? null;
  const currentConn = options.find((o) => o.key === connKey) ?? null;
  const activeSkills = skills.items.filter(
    (s) => s.enabled !== false && settings?.enabledSkillIds.includes(s.id)
  );
  const activeMcp = mcp.items.filter(
    (s) => s.enabled !== false && settings?.enabledMcpServerIds.includes(s.id)
  );
  const activeSession = chat.sessions.find((s) => s.id === chat.activeSessionId);

  useEffect(() => {
    setModels(storedModels);
    if (!settings) return;
    if (!storedModels.some((m) => m.id === settings.modelId)) {
      useChatStore.getState().saveSettings({ modelId: storedModels[0]?.id ?? "" });
    }
  }, [storedModels, settings?.modelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages]);

  const updateSettings = (
    patch: Partial<Omit<ChatSessionSettings, "sessionId" | "updatedAt">>
  ) => {
    if (!settings) return;
    chat.saveSettings(patch);
  };

  const fetchModels = async (targetConnKey = settings?.connKey ?? options[0]?.key) => {
    if (!targetConnKey) return;
    setError(null);
    setModelsLoading(true);
    try {
      let list: ModelInfo[] = [];
      const targetVolc = targetConnKey.startsWith("volc:")
        ? volc.items.find((c) => `volc:${c.id}` === targetConnKey) ?? null
        : null;
      const targetGateway = targetConnKey.startsWith("gw:")
        ? gateway.items.find((c) => `gw:${c.id}` === targetConnKey) ?? null
        : null;
      const targetKey = targetConnKey.startsWith("key:")
        ? apiKeys.items.find((c) => `key:${c.id}` === targetConnKey) ?? null
        : null;

      if (targetVolc) {
        list = await listEndpoints({
          accessKey: targetVolc.accessKey,
          secretKey: targetVolc.secretKey,
          region: targetVolc.region,
          project: targetVolc.project,
        });
        await volc.edit(targetVolc.id, { models: list });
      } else if (targetGateway) {
        const adapter = getAdapter(targetGateway.provider);
        if (!adapter) throw new Error(t("agent_adapter_not_found", { provider: targetGateway.provider }));
        list = await adapter.listModels({
          baseUrl: targetGateway.baseUrl,
          apiKey: targetGateway.apiKey,
        });
        await gateway.edit(targetGateway.id, { models: list });
      } else if (targetKey) {
        if (!targetKey.baseUrl) throw new Error(t("agent_fetch_no_base_url"));
        const adapter = getAdapter("manual")!;
        list = await adapter.listModels({
          baseUrl: targetKey.baseUrl,
          apiKey: targetKey.key,
        });
        const mergedIds = [
          ...new Set([...(targetKey.models ?? []), ...list.map((m) => m.id)]),
        ];
        await apiKeys.edit(targetKey.id, { models: mergedIds });
      }
      setModels(list);
      updateSettings({
        connKey: targetConnKey,
        modelId: list[0]?.id ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("agent_fetch_failed"));
    } finally {
      setModelsLoading(false);
    }
  };

  const pickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const next = await Promise.all(files.map((f) => chat.fileToAttachment(f)));
      setAttachments((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("agent_read_attachment_failed"));
    }
  };

  const toolDefinitions = (): ToolDefinition[] => [
    ...activeSkills.map((skill) => ({
      type: "function" as const,
      function: {
        name: safeToolName("skill", skill.name || skill.id),
        description: skill.description || `Run skill ${skill.name}`,
        parameters: {
          type: "object",
          properties: {
            input: { type: "string", description: "Input for the skill" },
          },
        },
      },
    })),
    ...activeMcp.map((server) => ({
      type: "function" as const,
      function: {
        name: safeToolName("mcp", server.name || server.id),
        description:
          server.description ||
          `Use MCP server ${server.name}. Runtime connection is managed by LLMToolForge.`,
        parameters: {
          type: "object",
          properties: {
            request: { type: "string" },
          },
        },
      },
    })),
  ];

  const buildApiMessages = (history: PersistedChatMessage[]): ChatMessage[] => {
    const msgs: ChatMessage[] = [];
    if (settings?.system.trim()) {
      msgs.push({ role: "system", content: settings.system.trim() });
    }
    for (const m of history) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (m.role === "user") {
        const parts: ContentPart[] = [];
        if (m.content) parts.push({ type: "text", text: m.content });
        for (const part of m.parts) {
          if (part.kind === "image" && part.url) {
            parts.push({ type: "image", url: part.url });
          }
          if (part.kind === "file") {
            parts.push({
              type: "text",
              text: `[Attached file: ${part.name ?? "file"} (${part.mime ?? "unknown"})]`,
            });
          }
          if (part.kind === "audio" || part.kind === "video") {
            parts.push({
              type: "text",
              text: `[Attached ${part.kind}: ${part.name ?? part.kind} (${part.mime ?? "unknown"})]`,
            });
          }
          if (part.kind === "tool_result" && part.text) {
            parts.push({ type: "text", text: `[Tool result]\n${part.text}` });
          }
        }
        msgs.push({ role: "user", content: parts.length ? parts : m.content });
      } else {
        msgs.push({ role: "assistant", content: m.content });
      }
    }
    return msgs;
  };

  const credentialForConnKey = (targetConnKey?: string | null): ProviderCredential | null => {
    if (!targetConnKey) return null;
    if (targetConnKey.startsWith("volc:")) {
      const cred = volc.items.find((c) => `volc:${c.id}` === targetConnKey);
      const key = (cred?.apiKeys ?? []).filter((k) => k.key)[
        Number(settings?.keyIdx ?? "0")
      ]?.key;
      if (!key) throw new Error(t("agent_no_ark_key"));
      return { apiKey: key, region: cred?.region };
    }
    if (targetConnKey.startsWith("gw:")) {
      const conn = gateway.items.find((c) => `gw:${c.id}` === targetConnKey);
      return conn ? { baseUrl: conn.baseUrl, apiKey: conn.apiKey } : null;
    }
    if (targetConnKey.startsWith("key:")) {
      const conn = apiKeys.items.find((c) => `key:${c.id}` === targetConnKey);
      if (!conn?.baseUrl)
        throw new Error(t("agent_no_base_url"));
      return { baseUrl: conn.baseUrl, apiKey: conn.key };
    }
    return null;
  };

  const credential = (): ProviderCredential | null =>
    credentialForConnKey(settings?.connKey);

  const partsFromInput = (
    content: string,
    inputAttachments: ChatAttachment[]
  ): Omit<MessagePart, "messageId">[] => {
    const parts: Omit<MessagePart, "messageId">[] = [];
    if (content) {
      parts.push({ id: uid("part"), kind: "text", text: content, sortOrder: 0 });
    }
    inputAttachments.forEach((attachment, index) => {
      parts.push({
        id: uid("part"),
        kind: attachment.kind,
        url: attachment.dataUrl,
        attachmentId: attachment.id,
        mime: attachment.mime,
        name: attachment.name,
        sortOrder: index + 1,
      });
    });
    return parts;
  };

  const editedPartsForMessage = (
    message: PersistedChatMessage,
    content: string
  ): Omit<MessagePart, "messageId">[] => {
    const mediaParts = message.parts
      .filter((part) => part.kind !== "text")
      .map((part, index) => ({
        id: part.id,
        kind: part.kind,
        text: part.text,
        url: part.url,
        attachmentId: part.attachmentId,
        mime: part.mime,
        name: part.name,
        sortOrder: content ? index + 1 : index,
      }));
    return content
      ? [
          {
            id: uid("part"),
            kind: "text" as const,
            text: content,
            sortOrder: 0,
          },
          ...mediaParts,
        ]
      : mediaParts;
  };

  const validateGenerationInput = (
    content: string,
    inputAttachments: ChatAttachment[]
  ): string | null => {
    if (!volcCred && !gwConn && !keyConn) return t("agent_select_connection");
    if (!settings?.modelId) return t("agent_fetch_model_first");
    if (!selectedModel) return t("agent_select_model_first");
    if (!provider) return t("agent_no_provider");
    if (!content && inputAttachments.length === 0) return t("agent_message_required");
    if (isImageGenerationModel(selectedModel) && !content) {
      return t("agent_image_prompt_required");
    }
    if (isVideoGenerationModel(selectedModel) && !content) {
      return t("agent_video_prompt_required");
    }
    return null;
  };

  const appendVideoResultToMessage = async (
    message: PersistedChatMessage,
    result: VideoGenerationResult
  ) => {
    const generatedAttachments = result.videos
      .map((video, index) => generatedVideoAttachment(message.sessionId, video, index))
      .filter((attachment) => attachment.dataUrl);
    const existingUrls = new Set(message.attachments.map((a) => attachmentSrc(a)));
    const nextAttachments = generatedAttachments.filter(
      (attachment) => attachmentSrc(attachment) && !existingUrls.has(attachmentSrc(attachment))
    );
    const nextParts: Omit<MessagePart, "messageId">[] = nextAttachments.map(
      (attachment, index) => ({
        id: uid("part"),
        kind: "video",
        url: attachment.dataUrl,
        attachmentId: attachment.id,
        mime: attachment.mime,
        name: attachment.name,
        sortOrder: message.parts.length + index,
      })
    );
    if (nextAttachments.length > 0) {
      await chat.appendMessageArtifacts(message.id, {
        parts: nextParts,
        attachments: nextAttachments,
      });
    }
  };

  const pollVideoTask = async ({
    taskId,
    message,
    adapterProvider,
    cred,
    signal,
  }: {
    taskId: string;
    message: PersistedChatMessage;
    adapterProvider: string;
    cred: ProviderCredential;
    signal?: AbortSignal;
  }) => {
    const pollingKey = `${message.id}:${taskId}`;
    if (videoPollingRef.current.has(pollingKey)) return;
    videoPollingRef.current.add(pollingKey);
    try {
      const adapter = getAdapter(adapterProvider);
      if (!adapter?.getVideoGenerationTask) {
        throw new Error(t("agent_no_video_query", { provider: providerLabel(adapterProvider) }));
      }
      let latestMessage = message;
      for (let attempt = 1; attempt <= VIDEO_POLL_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 1) await sleep(VIDEO_POLL_INTERVAL_MS, signal);
        const result = await adapter.getVideoGenerationTask({ taskId, signal }, cred);
        const status = (result.status ?? "").toLowerCase();
        latestMessage =
          useChatStore.getState().messages.find((m) => m.id === message.id) ??
          latestMessage;
        if (result.videos.length > 0) {
          await appendVideoResultToMessage(latestMessage, result);
        }
        if (status === "succeeded" || result.videos.length > 0) {
          await chat.updateMessage(message.id, {
            content: t("agent_video_done") + `\nTask ID: ${taskId}`,
            status: "complete",
            raw: result.raw,
            error: "",
          });
          return;
        }
        if (VIDEO_FAILED_STATUSES.has(status)) {
          await chat.updateMessage(message.id, {
            content: t("agent_video_ended", { taskId, status }),
            status: "error",
            error: t("agent_video_failed", { status }),
            raw: result.raw,
          });
          return;
        }
        await chat.updateMessage(message.id, {
          content: videoContentForStatus(taskId, result.status, attempt),
          status: "pending",
          raw: result.raw,
        });
      }
      await chat.updateMessage(message.id, {
        content: t("agent_video_still_running", { taskId }),
        status: "complete",
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : t("agent_request_failed");
      await chat.updateMessage(message.id, {
        status: "error",
        error: msg,
      });
    } finally {
      videoPollingRef.current.delete(pollingKey);
    }
  };

  useEffect(() => {
    if (!loaded) return;
    for (const message of chat.messages) {
      const taskId = taskIdFromMessage(message);
      if (!taskId) continue;
      if (message.attachments.some((attachment) => attachment.kind === "video")) {
        continue;
      }
      if (message.status === "error" || message.content.startsWith(t("agent_video_done"))) {
        continue;
      }
      const adapterProvider = message.provider ?? provider;
      if (!adapterProvider) continue;
      let taskCredential: ProviderCredential | null = null;
      try {
        taskCredential = credentialForConnKey(message.connKey ?? settings?.connKey);
      } catch {
        continue;
      }
      if (!taskCredential) continue;
      void pollVideoTask({
        taskId,
        message,
        adapterProvider,
        cred: taskCredential,
      });
    }
  }, [loaded, chat.messages, provider, settings?.connKey]);

  const handleGenerationError = async (e: unknown) => {
    const msg = e instanceof Error ? e.message : t("agent_request_failed");
    const currentMessages = useChatStore.getState().messages;
    const last = currentMessages[currentMessages.length - 1];
    if (last?.role === "assistant" && last.status === "pending") {
      await chat.updateMessage(last.id, {
        status: "error",
        error: msg,
        content: "",
      });
    } else {
      setError(msg);
    }
  };

  const generateAssistantForUser = async ({
    userMsg,
    history,
    prompt,
    inputAttachments,
  }: {
    userMsg: PersistedChatMessage;
    history: PersistedChatMessage[];
    prompt: string;
    inputAttachments: ChatAttachment[];
  }) => {
    if (!settings || !selectedModel || !provider) return;
    const adapter = getAdapter(provider)!;
    const cred = credential();
    if (!cred) throw new Error(t("agent_no_credential"));
    const controller = new AbortController();
    abortRef.current = controller;
    const tools = toolDefinitions();
    const imageGenerationModel = isImageGenerationModel(selectedModel);
    const videoGenerationModel = isVideoGenerationModel(selectedModel);

    if (videoGenerationModel) {
      if (!adapter.videoGeneration) {
        throw new Error(t("agent_no_video_api", { provider: providerLabel(provider) }));
      }
      const result = await adapter.videoGeneration(
        {
          model: settings.modelId,
          prompt,
          references: videoReferencesFromInput(prompt, inputAttachments),
          generateAudio: true,
          ratio: "16:9",
          duration: 5,
          watermark: false,
          signal: controller.signal,
        },
        cred
      );
      const statusText = result.status ? `\n${t("agent_status_prefix")}${result.status}` : "";
      const taskText = result.taskId ? `\nTask ID: ${result.taskId}` : "";
      const videoAssistant = await chat.addMessage({
        role: "assistant",
        content:
          result.videos.length > 0
            ? t("agent_video_done")
            : t("agent_video_submitted") + `${taskText}${statusText}`,
        status: result.videos.length > 0 || !result.taskId ? "complete" : "pending",
        connKey: settings.connKey ?? undefined,
        provider,
        modelId: settings.modelId,
        paramsJson: jsonParams(settings),
      });
      await chat.updateMessage(videoAssistant.id, {
        raw: result.raw,
      });
      if (result.videos.length > 0) {
        await appendVideoResultToMessage(videoAssistant, result);
      } else if (result.taskId) {
        void pollVideoTask({
          taskId: result.taskId,
          message: videoAssistant,
          adapterProvider: provider,
          cred,
          signal: controller.signal,
        });
      }
      return;
    }

    if (imageGenerationModel) {
      if (!adapter.imageGeneration) {
        throw new Error(t("agent_no_image_api", { provider: providerLabel(provider) }));
      }
      const result = await adapter.imageGeneration(
        {
          model: settings.modelId,
          prompt,
          responseFormat: "url",
          size: "2K",
          sequentialImageGeneration: "disabled",
          watermark: true,
          signal: controller.signal,
        },
        cred
      );
      const generatedAttachments = result.images
        .map((image, index) =>
          generatedImageAttachment(userMsg.sessionId, image, index)
        )
        .filter((attachment) => attachment.dataUrl);
      const generatedParts: Omit<MessagePart, "messageId">[] =
        generatedAttachments.map((attachment, index) => ({
          id: uid("part"),
          kind: "image",
          url: attachment.dataUrl,
          attachmentId: attachment.id,
          mime: attachment.mime,
          name: attachment.name,
          sortOrder: index,
        }));
      const imageAssistant = await chat.addMessage({
        role: "assistant",
        content:
          generatedAttachments.length > 1
            ? t("agent_images_done", { count: generatedAttachments.length })
            : t("agent_image_done"),
        status: "complete",
        parts: generatedParts,
        attachments: generatedAttachments,
        connKey: settings.connKey ?? undefined,
        provider,
        modelId: settings.modelId,
        paramsJson: jsonParams(settings),
      });
      await chat.updateMessage(imageAssistant.id, {
        usage: result.usage,
        raw: result.raw,
      });
      return;
    }

    const assistant = await chat.addMessage({
      role: "assistant",
      content: "",
      status: "pending",
      connKey: settings.connKey ?? undefined,
      provider,
      modelId: settings.modelId,
      paramsJson: jsonParams(settings),
    });
    const req: ChatRequest = {
      model: settings.modelId,
      messages: buildApiMessages(history),
      params: {
        temperature: Number(settings.temperature),
        maxTokens: Number(settings.maxTokens),
      },
      tools,
      toolChoice: tools.length > 0 ? "auto" : undefined,
      wireFormat: isVolc ? settings.wireFormat : "openai-chat",
      signal: controller.signal,
    };

    if (settings.streaming && adapter.chatStream && tools.length === 0) {
      let acc = "";
      for await (const chunk of adapter.chatStream(req, cred)) {
        acc += chunk.delta;
        await chat.updateMessage(assistant.id, { content: acc });
      }
      await chat.updateMessage(assistant.id, { content: acc, status: "complete" });
    } else {
      const res = await adapter.chat(req, cred);
      await chat.updateMessage(assistant.id, {
        content: res.content || summarizeToolCalls(res.toolCalls?.length ?? 0),
        status: "complete",
        usage: res.usage,
        raw: res.raw,
      });
      if (res.toolCalls?.length) {
        for (const call of res.toolCalls) {
          await chat.recordToolCall({
            sessionId: userMsg.sessionId,
            messageId: assistant.id,
            source: call.function.name.startsWith("mcp_") ? "mcp" : "skill",
            toolName: call.function.name,
            title: call.function.name,
            argumentsJson: call.function.arguments || "{}",
            resultText: t("agent_tool_call_recorded"),
            status: "success",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
          });
        }
      }
    }
  };

  const send = async () => {
    if (sending || !settings) return;
    const content = input.trim();
    const validationError = validateGenerationInput(content, attachments);
    if (validationError) return setError(validationError);

    setError(null);
    const pendingAttachments = attachments;
    const parts = partsFromInput(content, pendingAttachments);
    setInput("");
    setAttachments([]);
    setSending(true);

    try {
      const userMsg = await chat.addMessage({
        role: "user",
        content,
        parts,
        attachments: pendingAttachments,
      });
      await generateAssistantForUser({
        userMsg,
        history: [...chat.messages, userMsg],
        prompt: content,
        inputAttachments: pendingAttachments,
      });
    } catch (e) {
      await handleGenerationError(e);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const retryFromUserMessage = async (message: PersistedChatMessage) => {
    if (sending || !settings) return;
    const prompt = message.content.trim();
    const validationError = validateGenerationInput(prompt, message.attachments);
    if (validationError) return setError(validationError);
    abortRef.current?.abort();
    setError(null);
    setEditingMessageId(null);
    setSending(true);
    try {
      await chat.deleteMessagesFrom(message.sessionId, message.id, false);
      const currentMessages = useChatStore.getState().messages;
      const userMsg = currentMessages.find((m) => m.id === message.id) ?? message;
      await generateAssistantForUser({
        userMsg,
        history: currentMessages,
        prompt,
        inputAttachments: userMsg.attachments,
      });
    } catch (e) {
      await handleGenerationError(e);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const retryFromAssistantMessage = async (message: PersistedChatMessage) => {
    if (sending || !settings) return;
    const index = chat.messages.findIndex((m) => m.id === message.id);
    const userMsg = [...chat.messages]
      .slice(0, index)
      .reverse()
      .find((m) => m.role === "user");
    if (!userMsg) return setError(t("agent_no_retry_msg"));
    const prompt = userMsg.content.trim();
    const validationError = validateGenerationInput(prompt, userMsg.attachments);
    if (validationError) return setError(validationError);
    abortRef.current?.abort();
    setError(null);
    setEditingMessageId(null);
    setSending(true);
    try {
      await chat.deleteMessagesFrom(message.sessionId, message.id, true);
      const currentMessages = useChatStore.getState().messages;
      const latestUser = currentMessages.find((m) => m.id === userMsg.id) ?? userMsg;
      await generateAssistantForUser({
        userMsg: latestUser,
        history: currentMessages,
        prompt,
        inputAttachments: latestUser.attachments,
      });
    } catch (e) {
      await handleGenerationError(e);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const deleteFromMessage = async (message: PersistedChatMessage) => {
    if (sending) return;
    abortRef.current?.abort();
    setError(null);
    setEditingMessageId(null);
    try {
      await chat.deleteMessagesFrom(message.sessionId, message.id, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("agent_delete_failed"));
    }
  };

  const startEditingMessage = (message: PersistedChatMessage) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  };

  const saveEditedMessage = async (message: PersistedChatMessage) => {
    if (sending || message.role !== "user") return;
    const prompt = editingDraft.trim();
    if (!prompt && message.attachments.length === 0) {
      setError(t("agent_edit_empty"));
      return;
    }
    const validationError = validateGenerationInput(prompt, message.attachments);
    if (validationError) return setError(validationError);
    abortRef.current?.abort();
    setError(null);
    setSending(true);
    try {
      const edited = await chat.replaceMessageContent(
        message.id,
        prompt,
        editedPartsForMessage(message, prompt)
      );
      await chat.deleteMessagesFrom(message.sessionId, message.id, false);
      setEditingMessageId(null);
      setEditingDraft("");
      const currentMessages = useChatStore.getState().messages;
      const userMsg = currentMessages.find((m) => m.id === edited.id) ?? edited;
      await generateAssistantForUser({
        userMsg,
        history: currentMessages,
        prompt,
        inputAttachments: userMsg.attachments,
      });
    } catch (e) {
      await handleGenerationError(e);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  if (loaded && options.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <EmptyState
          icon={Bot}
          title={t("agent_no_connection_title")}
          description={t("agent_no_connection_desc")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full [&_[role=button]]:focus-visible:!outline-none [&_[role=button]]:focus-visible:!shadow-none [&_button]:focus-visible:!outline-none [&_button]:focus-visible:!shadow-none">
      <section className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-label-13 font-medium">
                  {activeSession?.title ?? t("agent_new_session")}
                </div>
                <div className="truncate text-label-12 text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {selectedModel && <ModelIcon model={selectedModel} className="h-3.5 w-3.5" />}
                    <span className="truncate">
                      {t("agent_message_count", { count: chat.messages.length })}
                      {selectedModel ? ` · ${selectedModel.name}` : ` · ${t("agent_no_model_selected")}`}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant={configOpen ? "secondary" : "ghost"}
                onClick={() => setConfigOpen((open) => !open)}
                title={configOpen ? t("agent_hide_config") : t("agent_show_config")}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!isLiveRequestSupported() && (
            <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2 text-label-12 text-warning-foreground/90">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
              {t("agent_browser_mode_warning")}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-4 pt-6">
            <div className="mx-auto flex min-h-full w-full max-w-[1040px] flex-col">
              {chat.loading ? (
                <MessageSkeletons />
              ) : chat.messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="text-label-13 text-muted-foreground">
                    {t("agent_chat_start_hint")}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <AnimatePresence initial={false}>
                    {chat.messages.map((m, i) => (
                      <ChatBubble
                        key={m.id}
                        message={m}
                        typing={m.status === "pending" && !m.content}
                        streaming={sending && i === chat.messages.length - 1}
                        editing={editingMessageId === m.id}
                        editingDraft={editingDraft}
                        onEditDraftChange={setEditingDraft}
                        onStartEdit={() => startEditingMessage(m)}
                        onCancelEdit={() => {
                          setEditingMessageId(null);
                          setEditingDraft("");
                        }}
                        onSaveEdit={() => saveEditedMessage(m)}
                        onDelete={() => deleteFromMessage(m)}
                        onRetry={() =>
                          m.role === "assistant"
                            ? retryFromAssistantMessage(m)
                            : retryFromUserMessage(m)
                        }
                        actionsDisabled={sending}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 bg-gradient-to-t from-background via-background to-background/75 px-4 pb-4 pt-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,audio/*,video/*,.txt,.md,.json,.csv,.log"
              multiple
              className="hidden"
              onChange={pickFiles}
            />
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-auto w-full max-w-[760px] overflow-hidden"
                >
                  <div className="mb-2 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-label-13 text-destructive">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[16px] border border-input bg-card shadow-[0_14px_42px_rgba(0,0,0,0.11),0_3px_10px_rgba(0,0,0,0.06)] transition-shadow duration-150 ease-geist">
              <Textarea
                className="h-[48px] min-h-0 max-h-28 resize-none border-0 bg-transparent px-4 py-3 text-copy-14 shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:shadow-none"
                placeholder={t("agent_textarea_placeholder")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border px-2.5 py-1">
                  {attachments.map((a) => (
                    <AttachmentPill
                      key={a.id}
                      attachment={a}
                      onRemove={() =>
                        setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                      }
                    />
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5 px-2.5 py-1.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={!settings}
                    title={t("agent_add_attachment")}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  {settings && (
                    <Badge
                      variant="outline"
                      className="h-7 shrink-0 gap-1.5 rounded-md px-2 text-label-12"
                      title={t("agent_current_sandbox")}
                    >
                      <ShieldIcon className="h-3.5 w-3.5" />
                      {SANDBOX_MODES.find((m) => m.value === settings.sandboxMode)
                        ?.label ?? "Sandbox"}
                    </Badge>
                  )}
                  <div className="w-[184px] shrink-0">
                    <ComposerModelCascade
                      options={options}
                      currentConn={currentConn}
                      selectedModel={selectedModel}
                      modelsLoading={modelsLoading}
                      disabled={!settings || options.length === 0}
                      modelsForOption={modelsForOption}
                      onRefresh={(connKey) => fetchModels(connKey)}
                      onSelect={(connKey, modelId) =>
                        updateSettings({ connKey, modelId })
                      }
                    />
                  </div>
                  <ComposerToolMenu
                    icon={Boxes}
                    label="Skills"
                    empty={t("agent_no_skills")}
                    items={skills.items}
                    activeIds={settings?.enabledSkillIds ?? []}
                    onChange={(enabledSkillIds) => updateSettings({ enabledSkillIds })}
                  />
                  <ComposerToolMenu
                    icon={Server}
                    label="MCP"
                    empty={t("agent_no_mcp")}
                    items={mcp.items}
                    activeIds={settings?.enabledMcpServerIds ?? []}
                    onChange={(enabledMcpServerIds) =>
                      updateSettings({ enabledMcpServerIds })
                    }
                  />
                </div>
                {sending ? (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full"
                    onClick={stop}
                    title={t("agent_stop")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="accent"
                    className="h-8 w-8 rounded-full shadow-geist-md"
                    onClick={send}
                    disabled={!selectedModel || (!input.trim() && attachments.length === 0)}
                    title={t("agent_send")}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        {configOpen && (
          <div className="hidden h-full w-[300px] shrink-0 border-l border-border lg:flex">
            <ConfigRail
              settings={settings}
              isVolc={isVolc}
              usableKeys={usableKeys}
              toolCalls={chat.toolCalls}
              onSettings={updateSettings}
              onClose={() => setConfigOpen(false)}
            />
          </div>
        )}
    </div>
  );
}

function summarizeToolCalls(count: number): string {
  return count > 0 ? i18n.t("pages:agent_tool_calls_summary", { count }) : "";
}

function MessageSkeletons() {
  return (
    <div className="grid gap-5">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={cn("flex gap-3", item === 1 && "flex-row-reverse")}
        >
          <div className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-secondary" />
          <div
            className={cn(
              "grid max-w-[78%] gap-2 rounded-md bg-secondary/70 p-3",
              item === 1 ? "w-[42%]" : "w-[62%]"
            )}
          >
            <div className="h-3 w-2/3 animate-pulse rounded-sm bg-muted" />
            <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded-sm bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigRail({
  settings,
  isVolc,
  usableKeys,
  toolCalls,
  onSettings,
  onClose,
}: {
  settings: ChatSessionSettings | null;
  isVolc: boolean;
  usableKeys: { name: string; key?: string; arkId?: number }[];
  toolCalls: ReturnType<typeof useChatStore.getState>["toolCalls"];
  onSettings: (
    patch: Partial<Omit<ChatSessionSettings, "sessionId" | "updatedAt">>
  ) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("pages");
  if (!settings) {
    return (
      <aside className="flex h-full w-full items-center justify-center bg-card-elevated p-5 text-label-13 text-muted-foreground">
        {t("agent_loading_settings")}
      </aside>
    );
  }
  return (
    <aside className="flex h-full w-full min-h-0 flex-col overflow-y-auto bg-card-elevated p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
          {t("agent_config_title")}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} title={t("agent_hide_config")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <RailSection icon={Settings2} title={t("agent_request_section")}>
        <div className="rounded-sm border border-border bg-secondary/50 p-3 text-label-12 text-muted-foreground">
          {t("agent_conn_model_hint")}
        </div>
        {isVolc && (
          <>
            <div className="grid gap-1.5">
              <Label>Ark API Key</Label>
              <Select
                value={settings.keyIdx}
                onValueChange={(keyIdx) => onSettings({ keyIdx })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("agent_no_key")} />
                </SelectTrigger>
                <SelectContent>
                  {usableKeys.map((k, i) => (
                    <SelectItem key={k.arkId ?? i} value={String(i)}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("agent_wire_format")}</Label>
              <Select
                value={settings.wireFormat}
                onValueChange={(v) => onSettings({ wireFormat: v as WireFormat })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WIRE_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={SlidersIcon} title={t("agent_params_section")}>
        <div className="grid gap-1.5">
          <Label>System Prompt</Label>
          <Textarea
            className="min-h-[72px]"
            value={settings.system}
            onChange={(e) => onSettings({ system: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Temperature</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={settings.temperature}
              onChange={(e) => onSettings({ temperature: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Max Tokens</Label>
            <Input
              type="number"
              min="1"
              value={settings.maxTokens}
              onChange={(e) => onSettings({ maxTokens: e.target.value })}
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-sm bg-secondary/60 px-3 py-2">
          <Label className="cursor-pointer">{t("agent_streaming")}</Label>
          <Switch
            checked={settings.streaming}
            onCheckedChange={(streaming) => onSettings({ streaming })}
          />
        </div>
      </RailSection>

      <RailSection icon={ShieldIcon} title={t("agent_sandbox_section")}>
        <Select
          value={settings.sandboxMode}
          onValueChange={(sandboxMode) =>
            onSettings({ sandboxMode: sandboxMode as SandboxMode })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SANDBOX_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="rounded-sm border border-border p-3 text-label-12 text-muted-foreground">
          {t("agent_sandbox_hint")}
        </div>
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={Database} title={t("agent_tool_records")}>
        {toolCalls.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border p-3 text-label-12 text-muted-foreground">
            {t("agent_no_tool_calls")}
          </div>
        ) : (
          <div className="grid gap-2">
            {toolCalls.slice(0, 5).map((call) => (
              <div key={call.id} className="rounded-sm bg-secondary/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-label-12 font-medium">
                    {call.title}
                  </span>
                  <Badge
                    variant={call.status === "success" ? "success" : "warning"}
                    className="rounded-sm"
                  >
                    {call.status}
                  </Badge>
                </div>
                {call.resultText && (
                  <div className="mt-1 line-clamp-2 text-label-12 text-muted-foreground">
                    {call.resultText}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </RailSection>
    </aside>
  );
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function ComposerModelCascade({
  options,
  currentConn,
  selectedModel,
  modelsLoading,
  disabled,
  modelsForOption,
  onRefresh,
  onSelect,
}: {
  options: ConnOption[];
  currentConn: ConnOption | null;
  selectedModel: ModelInfo | null;
  modelsLoading: boolean;
  disabled: boolean;
  modelsForOption: (option: ConnOption) => ModelInfo[];
  onRefresh: (connKey: string) => void;
  onSelect: (connKey: string, modelId: string) => void;
}) {
  const { t } = useTranslation("pages");
  const refreshConn = currentConn ?? options[0] ?? null;
  const title =
    currentConn && selectedModel
      ? `${currentConn.name} / ${selectedModel.name}`
      : currentConn
        ? `${currentConn.name} / ${t("agent_select_model_first_short")}`
        : t("agent_select_model");

  return (
    <div className="flex h-7 min-w-0 items-center gap-1 rounded-md border border-border bg-background">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-[26px] w-0 min-w-0 flex-1 justify-start gap-1.5 rounded-[5px] px-2 text-foreground hover:bg-secondary"
            disabled={disabled}
            title={selectedModel ? getModelFeatureTitle(selectedModel) : title}
          >
            {selectedModel ? (
              <ModelIcon model={selectedModel} className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-left text-label-13">
              {title}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>{t("agent_model_config")}</DropdownMenuLabel>
          {options.map((option) => {
            const optionModels = modelsForOption(option);
            const isActiveConn = currentConn?.key === option.key;
            return (
              <DropdownMenuSub key={option.key}>
                <DropdownMenuSubTrigger>
                  <ProviderIconLabel
                    provider={option.provider}
                    className="min-w-0 flex-1"
                    title={option.name}
                  >
                    <span className="min-w-0 truncate">{option.name}</span>
                  </ProviderIconLabel>
                  {isActiveConn && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 w-80 overflow-y-auto">
                  {optionModels.length === 0 ? (
                    <DropdownMenuItem disabled>{t("agent_refresh_models_hint")}</DropdownMenuItem>
                  ) : (
                    optionModels.map((model) => {
                      const active =
                        isActiveConn && selectedModel?.id === model.id;
                      return (
                        <DropdownMenuItem
                          key={model.id}
                          title={getModelFeatureTitle(model)}
                          onSelect={() => onSelect(option.key, model.id)}
                        >
                          <ModelIconLabel model={model} className="min-w-0 flex-1">
                            <span className="min-w-0 truncate">{model.name}</span>
                          </ModelIconLabel>
                          {active && <Check className="h-4 w-4 text-accent" />}
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon"
        variant="ghost"
        className="h-[26px] w-[26px] shrink-0 rounded-[5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        disabled={disabled || modelsLoading || !refreshConn}
        title={refreshConn ? t("agent_refresh_conn", { name: refreshConn.name }) : t("agent_refresh_models")}
        onClick={() => {
          if (refreshConn) onRefresh(refreshConn.key);
        }}
      >
        {modelsLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCcw className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

function ComposerToolMenu<T extends { id: string; name: string; description?: string; enabled?: boolean }>({
  icon: Icon,
  label,
  empty,
  items,
  activeIds,
  onChange,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  empty: string;
  items: T[];
  activeIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const available = items.filter((i) => i.enabled !== false);
  const activeCount = available.filter((item) => activeIds.includes(item.id)).length;

  if (available.length === 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 px-2" title={empty}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem disabled>{empty}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={activeCount > 0 ? "secondary" : "ghost"}
          className="h-7 px-2"
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
          {activeCount > 0 && (
            <Badge variant="accent" className="-mr-1 rounded-sm px-1.5 py-0">
              {activeCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        {available.map((item) => {
          const active = activeIds.includes(item.id);
          return (
            <DropdownMenuCheckboxItem
              key={item.id}
              checked={active}
              onCheckedChange={() => onChange(toggleId(activeIds, item.id))}
              onSelect={(event) => event.preventDefault()}
            >
              <div className="min-w-0">
                <div className="truncate text-label-13 font-medium">
                  {item.name}
                </div>
                {item.description && (
                  <div className="line-clamp-1 text-label-12 text-muted-foreground">
                    {item.description}
                  </div>
                )}
              </div>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function RailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

function AttachmentPill({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const { t } = useTranslation("pages");
  const isImage = attachment.kind === "image";
  const isVideo = attachment.kind === "video";
  const isAudio = attachment.kind === "audio";
  const imageSrc = attachmentSrc(attachment);
  return (
    <div className="flex max-w-full items-center gap-2 rounded-sm border border-border bg-secondary/60 px-2 py-1.5">
      {isImage && imageSrc ? (
        <img
          src={imageSrc}
          alt={attachment.name}
          className="h-8 w-8 rounded-sm object-cover"
        />
      ) : isVideo ? (
        <FileVideo className="h-4 w-4 text-muted-foreground" />
      ) : isAudio ? (
        <FileAudio className="h-4 w-4 text-muted-foreground" />
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <div className="truncate text-label-12 font-medium">
          {attachment.name}
        </div>
        <div className="text-label-12 text-muted-foreground">
          {attachment.size > 0
            ? `${Math.ceil(attachment.size / 1024)} KB`
            : attachment.kind === "video"
              ? t("agent_attachment_video")
              : attachment.kind === "image"
                ? t("agent_attachment_image")
                : t("agent_attachment")}
        </div>
      </div>
      {onRemove && (
        <Button size="icon-sm" variant="ghost" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  typing,
  streaming,
  editing,
  editingDraft,
  actionsDisabled,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onRetry,
}: {
  message: PersistedChatMessage;
  typing?: boolean;
  streaming?: boolean;
  editing?: boolean;
  editingDraft: string;
  actionsDisabled?: boolean;
  onEditDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("pages");
  const reduce = useReducedMotion();
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const canRetry = message.role === "user" || message.role === "assistant";
  const generatedImages = !isUser
    ? message.attachments.filter(
        (attachment) => attachment.kind === "image" && attachmentSrc(attachment)
      )
    : [];
  const generatedVideos = !isUser
    ? message.attachments.filter(
        (attachment) => attachment.kind === "video" && attachmentSrc(attachment)
      )
    : [];
  const pillAttachments =
    generatedImages.length > 0 || generatedVideos.length > 0
      ? message.attachments.filter(
          (attachment) =>
            !generatedImages.includes(attachment) &&
            !generatedVideos.includes(attachment)
        )
      : message.attachments;
  const visibleContent =
    message.error && message.content.trim() === message.error.trim()
      ? ""
      : message.content;

  useEffect(() => {
    if (!editing) return;
    const textarea = editTextareaRef.current;
    if (!textarea) return;

    const frame = requestAnimationFrame(() => {
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      textarea.scrollTop = textarea.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [editing, message.id]);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group flex gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          isUser
            ? "bg-accent text-accent-foreground"
            : isTool
              ? "bg-success text-success-foreground"
              : "bg-secondary text-muted-foreground"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : isTool ? (
          <Play className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>
      <div className={cn("flex max-w-[90%] flex-col gap-1.5", isUser && "items-end")}>
        <div
          className={cn(
            "text-copy-14",
            editing
              ? "rounded-[14px] border border-input bg-card p-2 text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
              : "rounded-md px-3.5 py-2.5 shadow-geist-sm",
            !editing &&
              (isUser
                ? "rounded-tr-sm bg-accent text-accent-foreground"
                : "rounded-tl-sm bg-secondary text-foreground")
          )}
        >
          {generatedImages.length > 0 && (
            <div className="mb-3 grid gap-2">
              {generatedImages.map((attachment) => (
                <img
                  key={attachment.id}
                  src={attachmentSrc(attachment)}
                  alt={attachment.name}
                  className="max-h-80 w-full rounded-sm border border-border bg-background object-contain"
                />
              ))}
            </div>
          )}
          {generatedVideos.length > 0 && (
            <div className="mb-3 grid gap-2">
              {generatedVideos.map((attachment) => (
                <video
                  key={attachment.id}
                  src={attachmentSrc(attachment)}
                  controls
                  className="max-h-80 w-full rounded-sm border border-border bg-background"
                />
              ))}
            </div>
          )}
          {pillAttachments.length > 0 && (
            <div className="mb-2 grid gap-2">
              {pillAttachments.map((a) => (
                <AttachmentPill key={a.id} attachment={a} />
              ))}
            </div>
          )}
          {editing ? (
            <div className="grid w-[min(42rem,70vw)] max-w-full gap-2">
              <Textarea
                ref={editTextareaRef}
                className="min-h-[96px] resize-y border-0 bg-transparent px-2 py-2 text-copy-14 text-foreground shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:shadow-none"
                value={editingDraft}
                onChange={(e) => onEditDraftChange(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-1.5 border-t border-border/70 pt-1.5">
                <Button size="sm" variant="ghost" className="h-7 px-2.5" onClick={onCancelEdit}>
                  <X className="h-3.5 w-3.5" />
                  {t("agent_cancel")}
                </Button>
                <Button size="sm" variant="primary" className="h-7 px-2.5" onClick={onSaveEdit}>
                  <Check className="h-3.5 w-3.5" />
                  {t("agent_save_retry")}
                </Button>
              </div>
            </div>
          ) : typing ? (
            <div className="grid min-w-48 gap-2">
              <div className="flex items-center gap-2 text-label-13 text-muted-foreground">
                <TypingDots />
                <span>{t("agent_generating")}</span>
              </div>
              <div className="h-2 w-36 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-accent/50" />
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleContent && (
                <div className="whitespace-pre-wrap break-words">
                  {visibleContent}
                  {streaming && message.status === "pending" && (
                    <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] animate-pulse bg-current align-middle" />
                  )}
                </div>
              )}
              {message.error && (
                <div className="whitespace-pre-wrap break-words rounded-sm border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-label-12 text-destructive">
                  {message.error}
                </div>
              )}
            </div>
          )}
        </div>
        {!editing && (
          <div
            className={cn(
              "flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
              isUser && "flex-row-reverse"
            )}
          >
            {message.role === "user" && (
              <Button
                size="icon-sm"
                variant="ghost"
                title={t("agent_edit_message")}
                disabled={actionsDisabled}
                onClick={onStartEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canRetry && (
              <Button
                size="icon-sm"
                variant="ghost"
                title={t("agent_retry")}
                disabled={actionsDisabled}
                onClick={onRetry}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              title={t("agent_delete_from_here")}
              disabled={actionsDisabled}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SlidersIcon({ className }: { className?: string }) {
  return <Eraser className={className} />;
}

function ShieldIcon({ className }: { className?: string }) {
  return <Settings2 className={className} />;
}
