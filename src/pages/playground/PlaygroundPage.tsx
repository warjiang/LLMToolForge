import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
  MessageSquarePlus,
  Pencil,
  Plus,
  Play,
  RefreshCw,
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
import { Card } from "@/components/ui/card";
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
import { cn, formatDate, isTauri, uid } from "@/lib/utils";
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
  type Skill,
  type McpServer,
} from "@/types";

interface ConnOption {
  key: string;
  name: string;
  kind: "volc" | "gateway" | "manual";
  provider: string;
}

interface SandboxRunResponse {
  stdout: string;
  stderr: string;
  exitCode?: number;
  timedOut: boolean;
  durationMs: number;
  sandboxBackend: string;
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
  return PROVIDER_METAS.find((p) => p.id === provider)?.label ?? provider;
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
  const lines = ["视频生成任务轮询中。", `Task ID: ${taskId}`];
  if (status) lines.push(`状态：${status}`);
  if (attempt != null) lines.push(`查询次数：${attempt}`);
  return lines.join("\n");
}

export function PlaygroundPage() {
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
  const [runningSkillId, setRunningSkillId] = useState<string | null>(null);
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
  const selectedModel =
    models.find((m) => m.id === settings?.modelId) ?? null;
  const currentConn = options.find((o) => o.key === connKey) ?? null;
  const activeSkills = skills.items.filter((s) =>
    settings?.enabledSkillIds.includes(s.id)
  );
  const activeMcp = mcp.items.filter((s) =>
    settings?.enabledMcpServerIds.includes(s.id)
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

  const fetchModels = async () => {
    setError(null);
    setModelsLoading(true);
    try {
      let list: ModelInfo[] = [];
      if (volcCred) {
        list = await listEndpoints({
          accessKey: volcCred.accessKey,
          secretKey: volcCred.secretKey,
          region: volcCred.region,
          project: volcCred.project,
        });
        await volc.edit(volcCred.id, { models: list });
      } else if (gwConn) {
        const adapter = getAdapter(gwConn.provider);
        if (!adapter) throw new Error(`未找到适配器: ${gwConn.provider}`);
        list = await adapter.listModels({
          baseUrl: gwConn.baseUrl,
          apiKey: gwConn.apiKey,
        });
        await gateway.edit(gwConn.id, { models: list });
      } else if (keyConn) {
        if (!keyConn.baseUrl) throw new Error("该 Key 未配置 Base URL，无法拉取模型");
        const adapter = getAdapter("manual")!;
        list = await adapter.listModels({
          baseUrl: keyConn.baseUrl,
          apiKey: keyConn.key,
        });
        const mergedIds = [
          ...new Set([...(keyConn.models ?? []), ...list.map((m) => m.id)]),
        ];
        await apiKeys.edit(keyConn.id, { models: mergedIds });
      }
      setModels(list);
      if (list.length > 0) updateSettings({ modelId: list[0].id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉取模型失败");
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
      setError(e instanceof Error ? e.message : "读取附件失败");
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
      if (!key) throw new Error("没有可用的 Ark API Key，请先在模型接入页拉取");
      return { apiKey: key, region: cred?.region };
    }
    if (targetConnKey.startsWith("gw:")) {
      const conn = gateway.items.find((c) => `gw:${c.id}` === targetConnKey);
      return conn ? { baseUrl: conn.baseUrl, apiKey: conn.apiKey } : null;
    }
    if (targetConnKey.startsWith("key:")) {
      const conn = apiKeys.items.find((c) => `key:${c.id}` === targetConnKey);
      if (!conn?.baseUrl)
        throw new Error("该 Key 未配置 Base URL，无法在 Playground 中调用");
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
    if (!volcCred && !gwConn && !keyConn) return "请先选择连接";
    if (!settings?.modelId) return "请先拉取并选择模型";
    if (!selectedModel) return "请先选择模型";
    if (!provider) return "无法识别 provider";
    if (!content && inputAttachments.length === 0) return "请输入消息或添加附件";
    if (isImageGenerationModel(selectedModel) && !content) {
      return "图像生成模型需要输入 prompt";
    }
    if (isVideoGenerationModel(selectedModel) && !content) {
      return "视频生成模型需要输入 prompt";
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
        throw new Error(`${providerLabel(adapterProvider)} 暂不支持查询视频任务`);
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
            content: `已生成视频。\nTask ID: ${taskId}`,
            status: "complete",
            raw: result.raw,
            error: "",
          });
          return;
        }
        if (VIDEO_FAILED_STATUSES.has(status)) {
          await chat.updateMessage(message.id, {
            content: `视频生成任务结束。\nTask ID: ${taskId}\n状态：${status}`,
            status: "error",
            error: `视频生成失败：${status}`,
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
        content: `视频生成任务仍在运行。\nTask ID: ${taskId}`,
        status: "complete",
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "查询视频任务失败";
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
      if (message.status === "error" || message.content.startsWith("已生成视频")) {
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
    const msg = e instanceof Error ? e.message : "请求失败";
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
    if (!cred) throw new Error("无法创建请求凭证");
    const controller = new AbortController();
    abortRef.current = controller;
    const tools = toolDefinitions();
    const imageGenerationModel = isImageGenerationModel(selectedModel);
    const videoGenerationModel = isVideoGenerationModel(selectedModel);

    if (videoGenerationModel) {
      if (!adapter.videoGeneration) {
        throw new Error(`${providerLabel(provider)} 暂不支持视频生成接口`);
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
      const statusText = result.status ? `\n状态：${result.status}` : "";
      const taskText = result.taskId ? `\nTask ID: ${result.taskId}` : "";
      const videoAssistant = await chat.addMessage({
        role: "assistant",
        content:
          result.videos.length > 0
            ? "已生成视频。"
            : `视频生成任务已提交。${taskText}${statusText}`,
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
        throw new Error(`${providerLabel(provider)} 暂不支持图像生成接口`);
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
            ? `已生成 ${generatedAttachments.length} 张图片。`
            : "已生成图片。",
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
            resultText:
              "模型已发起工具调用；Playground 已记录该调用，Skill 可通过右侧手动执行。",
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
    if (!userMsg) return setError("未找到可重试的用户消息");
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
      setError(e instanceof Error ? e.message : "删除消息失败");
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
      setError("编辑后的消息不能为空");
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

  const runSkill = async (skill: Skill) => {
    if (!settings || !chat.activeSessionId || runningSkillId) return;
    setRunningSkillId(skill.id);
    setError(null);
    const startedAt = new Date().toISOString();
    const commandText =
      skill.content?.trim() ||
      `printf '%s\\n' ${JSON.stringify(skill.description || skill.name)}`;
    try {
      const res = isTauri()
        ? await invoke<SandboxRunResponse>("run_sandboxed_command", {
            req: {
              command: "/bin/sh",
              args: ["-lc", commandText],
              cwd: undefined,
              env: {},
              sandboxMode: settings.sandboxMode,
              timeoutMs: 30_000,
            },
          })
        : ({
            stdout: "浏览器模式不支持沙箱执行，请在桌面应用中运行。",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            durationMs: 0,
            sandboxBackend: "browser",
          } satisfies SandboxRunResponse);
      const completedAt = new Date().toISOString();
      const status = res.timedOut || (res.exitCode ?? 0) !== 0 ? "error" : "success";
      const output = res.stdout || res.stderr || "(no output)";
      const toolMessage = await chat.addMessage({
        role: "tool",
        content: output,
        parts: [
          {
            id: uid("part"),
            kind: "tool_result",
            text: output,
            sortOrder: 0,
          },
        ],
      });
      const tool = await chat.recordToolCall({
        sessionId: chat.activeSessionId,
        messageId: toolMessage.id,
        source: "skill",
        toolName: safeToolName("skill", skill.name || skill.id),
        title: skill.name,
        argumentsJson: JSON.stringify({ command: commandText }),
        resultText: res.stdout || res.stderr,
        status,
        startedAt,
        completedAt,
        durationMs: res.durationMs,
        error: status === "error" ? res.stderr || "Skill 执行失败" : undefined,
      });
      await chat.recordSandboxRun({
        toolCallId: tool.id,
        sessionId: chat.activeSessionId,
        command: "/bin/sh",
        args: ["-lc", commandText],
        envKeys: [],
        sandboxMode: settings.sandboxMode,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        status,
        startedAt,
        completedAt,
        durationMs: res.durationMs,
        error: res.timedOut ? "执行超时" : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skill 执行失败");
    } finally {
      setRunningSkillId(null);
    }
  };

  if (loaded && options.length === 0) {
    return (
      <div>
        <EmptyState
          icon={Bot}
          title="还没有可用的连接"
          description="请先在「模型接入」页添加凭证、网关连接或自定义 API Key。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6.5rem)] min-h-[620px] flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-heading-20">Playground</h1>
          <p className="mt-0.5 truncate text-label-12 text-muted-foreground">
            会话、模型、多模态和工具运行集中在同一个工作台。
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 gap-1.5 rounded-md">
          <Database className="h-3.5 w-3.5" />
          SQLite
        </Badge>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3",
          configOpen
            ? "xl:grid-cols-[238px_minmax(0,1fr)_300px]"
            : "xl:grid-cols-[238px_minmax(0,1fr)]"
        )}
      >
        <SessionRail />

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-label-13 font-medium">
                  {activeSession?.title ?? "新会话"}
                </div>
                <div className="truncate text-label-12 text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {selectedModel && <ModelIcon model={selectedModel} className="h-3.5 w-3.5" />}
                    <span className="truncate">
                      {chat.messages.length} 条消息
                      {selectedModel ? ` · ${selectedModel.name}` : " · 未选择模型"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => chat.newSession()}
                title="新建会话"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                variant={configOpen ? "secondary" : "ghost"}
                onClick={() => setConfigOpen((open) => !open)}
                title={configOpen ? "隐藏配置" : "显示配置"}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!isLiveRequestSupported() && (
            <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2 text-label-12 text-warning-foreground/90">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
              浏览器模式下模型请求、SQLite 和沙箱能力有限，请在桌面应用中测试完整链路。
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-5">
            {chat.loading ? (
              <MessageSkeletons />
            ) : chat.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="text-label-13 text-muted-foreground">
                  发送一条消息开始持久化会话
                </div>
              </div>
            ) : (
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
            )}
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mx-5 overflow-hidden"
              >
                <div className="mb-2 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-label-13 text-destructive">
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {attachments.length > 0 && (
            <div className="mx-5 mb-2 flex flex-wrap gap-2">
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

          <div className="border-t border-border bg-background-secondary/70 p-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,audio/*,video/*,.txt,.md,.json,.csv,.log"
              multiple
              className="hidden"
              onChange={pickFiles}
            />
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="min-w-[180px] flex-1 sm:flex-none">
                <Select
                  value={settings?.connKey ?? ""}
                  onValueChange={(connKey) => updateSettings({ connKey })}
                  disabled={!settings || options.length === 0}
                >
                  <SelectTrigger className="h-8 bg-background">
                    <SelectValue placeholder="选择连接" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.key} value={o.key}>
                        <ProviderIconLabel provider={o.provider}>
                          <span className="min-w-0 truncate">{o.name}</span>
                        </ProviderIconLabel>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[200px] flex-[1.2]">
                <Select
                  value={settings?.modelId ?? ""}
                  onValueChange={(modelId) => updateSettings({ modelId })}
                  disabled={!settings || models.length === 0}
                >
                  <SelectTrigger
                    className="h-8 bg-background"
                    title={getModelFeatureTitle(selectedModel)}
                  >
                    <SelectValue placeholder="先拉取模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <ModelIconLabel model={m} className="max-w-full" title={getModelFeatureTitle(m)}>
                          <span className="truncate">{m.name}</span>
                        </ModelIconLabel>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={fetchModels}
                disabled={modelsLoading || !currentConn}
                title="拉取模型"
              >
                {modelsLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                拉取
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Button
                size="icon"
                variant="secondary"
                disabled={!settings}
                title="添加图片或文件"
                onClick={() => fileRef.current?.click()}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Textarea
                className="min-h-[44px] flex-1 resize-none bg-background"
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              {sending ? (
                <Button size="icon" variant="secondary" onClick={stop} title="停止">
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="accent"
                  onClick={send}
                  disabled={!selectedModel || (!input.trim() && attachments.length === 0)}
                  title="发送"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>

        {configOpen && (
          <ConfigRail
            settings={settings}
            isVolc={isVolc}
            usableKeys={usableKeys}
            skills={skills.items}
            mcpServers={mcp.items}
            runningSkillId={runningSkillId}
            toolCalls={chat.toolCalls}
            onSettings={updateSettings}
            onRunSkill={runSkill}
            onClose={() => setConfigOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function summarizeToolCalls(count: number): string {
  return count > 0 ? `模型发起了 ${count} 个工具调用，已写入工具记录。` : "";
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

function SessionRail() {
  const chat = useChatStore();
  return (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div className="text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
          Sessions
        </div>
        <Button size="icon-sm" variant="ghost" onClick={() => chat.newSession()}>
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {chat.sessions.map((session) => (
          <button
            key={session.id}
            className={cn(
              "group mb-1 grid w-full gap-1 rounded-sm px-3 py-2 text-left transition-colors hover:bg-secondary",
              chat.activeSessionId === session.id && "bg-secondary"
            )}
            onClick={() => chat.selectSession(session.id)}
          >
            <span className="truncate text-label-13 font-medium">
              {session.title}
            </span>
            <span className="text-label-12 text-muted-foreground">
              {formatDate(session.updatedAt)}
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <Button
          className="w-full"
          variant="ghost"
          size="sm"
          disabled={!chat.activeSessionId || chat.sessions.length <= 1}
          onClick={() => chat.activeSessionId && chat.deleteSession(chat.activeSessionId)}
        >
          <Trash2 className="h-4 w-4" />
          删除当前会话
        </Button>
      </div>
    </Card>
  );
}

function ConfigRail({
  settings,
  isVolc,
  usableKeys,
  skills,
  mcpServers,
  runningSkillId,
  toolCalls,
  onSettings,
  onRunSkill,
  onClose,
}: {
  settings: ChatSessionSettings | null;
  isVolc: boolean;
  usableKeys: { name: string; key?: string; arkId?: number }[];
  skills: Skill[];
  mcpServers: McpServer[];
  runningSkillId: string | null;
  toolCalls: ReturnType<typeof useChatStore.getState>["toolCalls"];
  onSettings: (
    patch: Partial<Omit<ChatSessionSettings, "sessionId" | "updatedAt">>
  ) => void;
  onRunSkill: (skill: Skill) => void;
  onClose: () => void;
}) {
  if (!settings) {
    return (
      <Card className="flex items-center justify-center p-5 text-label-13 text-muted-foreground">
        加载会话设置…
      </Card>
    );
  }
  return (
    <Card className="flex min-h-0 flex-col overflow-y-auto bg-card-elevated p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
          配置
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} title="隐藏配置">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <RailSection icon={Settings2} title="请求">
        <div className="rounded-sm border border-border bg-secondary/50 p-3 text-label-12 text-muted-foreground">
          连接与模型已移入输入栏，常用切换不再占用侧栏。
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
                  <SelectValue placeholder="无可用 Key" />
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
              <Label>请求格式</Label>
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

      <RailSection icon={SlidersIcon} title="参数">
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
          <Label className="cursor-pointer">流式输出</Label>
          <Switch
            checked={settings.streaming}
            onCheckedChange={(streaming) => onSettings({ streaming })}
          />
        </div>
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={Boxes} title="Skills">
        <ToolToggleList
          empty="还没有 Skill"
          items={skills}
          activeIds={settings.enabledSkillIds}
          onChange={(enabledSkillIds) => onSettings({ enabledSkillIds })}
          renderAction={(skill) =>
            settings.enabledSkillIds.includes(skill.id) ? (
              <Button
                size="icon-sm"
                variant="ghost"
                title="沙箱运行"
                onClick={() => onRunSkill(skill)}
                disabled={!!runningSkillId}
              >
                {runningSkillId === skill.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            ) : null
          }
        />
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={Server} title="MCP">
        <ToolToggleList
          empty="还没有 MCP Server"
          items={mcpServers}
          activeIds={settings.enabledMcpServerIds}
          onChange={(enabledMcpServerIds) => onSettings({ enabledMcpServerIds })}
        />
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={ShieldIcon} title="沙箱">
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
          Skill 脚本通过 Tauri 命令执行；macOS 会优先使用 Seatbelt 兼容沙箱。
        </div>
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={Database} title="工具记录">
        {toolCalls.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border p-3 text-label-12 text-muted-foreground">
            暂无工具调用
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
    </Card>
  );
}

function ToolToggleList<T extends { id: string; name: string; description?: string; enabled?: boolean }>({
  empty,
  items,
  activeIds,
  onChange,
  renderAction,
}: {
  empty: string;
  items: T[];
  activeIds: string[];
  onChange: (ids: string[]) => void;
  renderAction?: (item: T) => React.ReactNode;
}) {
  const available = items.filter((i) => i.enabled !== false);
  if (available.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border p-3 text-label-12 text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {available.map((item) => {
        const active = activeIds.includes(item.id);
        return (
          <div
            key={item.id}
            className="grid gap-2 rounded-sm border border-border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
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
              <div className="flex items-center gap-1">
                {renderAction?.(item)}
                <Switch
                  checked={active}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...activeIds, item.id]
                        : activeIds.filter((id) => id !== item.id)
                    )
                  }
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
              ? "生成视频"
              : attachment.kind === "image"
                ? "生成图片"
                : "附件"}
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
  const reduce = useReducedMotion();
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
      <div className={cn("flex max-w-[82%] flex-col gap-1.5", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-md px-3.5 py-2.5 text-copy-14 shadow-geist-sm",
            isUser
              ? "rounded-tr-sm bg-accent text-accent-foreground"
              : "rounded-tl-sm bg-secondary text-foreground"
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
            <div className="grid min-w-[min(34rem,70vw)] gap-2">
              <Textarea
                className="min-h-[92px] resize-y bg-background text-foreground"
                value={editingDraft}
                onChange={(e) => onEditDraftChange(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  <X className="h-3.5 w-3.5" />
                  取消
                </Button>
                <Button size="sm" variant="accent" onClick={onSaveEdit}>
                  <Check className="h-3.5 w-3.5" />
                  保存并重试
                </Button>
              </div>
            </div>
          ) : typing ? (
            <div className="grid min-w-48 gap-2">
              <div className="flex items-center gap-2 text-label-13 text-muted-foreground">
                <TypingDots />
                <span>正在生成回复</span>
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
                title="编辑消息"
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
                title="重试"
                disabled={actionsDisabled}
                onClick={onRetry}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              title="删除此处及后续消息"
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
