import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentType, ReactNode, TouchEvent, WheelEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/config";
import {
  ArrowDown,
  Bot,
  Boxes,
  Bug,
  Check,
  ChevronRight,
  CircleAlert,
  Compass,
  Database,
  Eraser,
  FileArchive,
  FileCode,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  Code2,
  Lightbulb,
  ListChecks,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Server,
  Settings2,
  Shield,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { MarkdownMessage } from "@/components/agent/MarkdownMessage";
import { Reveal } from "@/components/common/Reveal";
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
  useAgentDefStore,
} from "@/store";
import { useDebugStore } from "@/store/debug";
import { useUnifiedStore } from "@/store/unified";
import {
  createAgentRuntime,
  prewarmMcpServers,
  GatewayUnavailableError,
  ModelUnavailableError,
  type AgentRuntime,
  type AgentRuntimeCallbacks,
} from "@/lib/agent";
import { resolveSessionWorkspace } from "@/lib/agent/workspace";
import { AgentsManagerDialog } from "./agents/AgentsManagerDialog";
import { cn, formatTime, isTauri, uid } from "@/lib/utils";
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
  ToolCallRecord,
} from "@/types/chat";
import {
  AGENT_INTERNAL_TOOL_IDS,
  PROVIDER_METAS,
  type VolcCredential,
  type GatewayConnection,
  type ApiKey,
  type AgentDefinition,
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
  { value: "workspace-write", label: "Execution write" },
  { value: "danger-full-access", label: "Full access" },
];

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_MAX_ATTEMPTS = 120;
const STREAM_CONTENT_FLUSH_MS = 50;
const SCROLL_BOTTOM_THRESHOLD_PX = 96;
const SCROLL_OVERFLOW_THRESHOLD_PX = 8;
const VIDEO_FAILED_STATUSES = new Set(["failed", "expired", "cancelled"]);
const DIRECT_AGENT_VALUE = "__direct__";
const ADHOC_AGENT_ID = "__adhoc__";
// Direct-chat / custom-agent picker is hidden from the composer for now.
const SHOW_AGENT_PICKER = false;

/**
 * Build an in-memory `AgentDefinition` from the current chat session settings.
 * Used to give the "direct chat" mode real tool execution via the Pi runtime
 * without forcing the user to create a named agent. With no workspace selected,
 * internal tools use the chat execution root; empty means the backend's
 * managed temporary sandbox directory.
 */
function buildAdHocAgentDef(
  settings: ChatSessionSettings,
  unifiedModelId: string
): AgentDefinition {
  const now = new Date().toISOString();
  return {
    id: ADHOC_AGENT_ID,
    createdAt: now,
    updatedAt: now,
    name: "",
    description: "",
    systemPrompt: settings.system ?? "",
    modelId: unifiedModelId,
    enabledInternalTools: [...AGENT_INTERNAL_TOOL_IDS],
    enabledSkillIds: settings.enabledSkillIds,
    enabledMcpServerIds: settings.enabledMcpServerIds,
    sandboxMode: settings.sandboxMode,
    workspacePath: settings.workspacePath,
    temperature: Number(settings.temperature) || 0,
    maxTokens: Number(settings.maxTokens) || 4096,
  };
}

/** Stable signature so a cached runtime is reused until its config changes. */
function agentRuntimeSignature(def: AgentDefinition, workspacePath: string): string {
  return [
    def.id,
    def.modelId,
    def.systemPrompt,
    def.enabledInternalTools.join(","),
    def.enabledSkillIds.join(","),
    def.enabledMcpServerIds.join(","),
    def.sandboxMode,
    workspacePath,
    def.temperature,
    def.maxTokens,
  ].join("|");
}

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

interface SaveChatAttachmentResponse {
  path: string;
}

async function saveAttachmentToExecutionRoot(
  attachment: ChatAttachment,
  workspaceRoot: string
): Promise<ChatAttachment> {
  if (!isTauri() || !attachment.dataUrl || attachment.path) return attachment;
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<SaveChatAttachmentResponse>("save_chat_attachment", {
    req: {
      workspaceRoot,
      attachmentId: attachment.id,
      fileName: attachment.name,
      dataUrl: attachment.dataUrl,
    },
  });
  return { ...attachment, path: res.path };
}

function attachmentPathContext(attachments: ChatAttachment[]): string {
  const localFiles = attachments.filter((attachment) => attachment.path);
  if (localFiles.length === 0) return "";
  return [
    "",
    "",
    "[Uploaded files saved in the execution directory]",
    ...localFiles.map(
      (attachment) =>
        `- ${attachment.name} (${attachment.mime || "unknown"}): ${attachment.path}`
    ),
  ].join("\n");
}

function promptWithAttachmentPaths(
  content: string,
  attachments: ChatAttachment[]
): string {
  const context = attachmentPathContext(attachments);
  return context ? `${content}${context}`.trim() : content;
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
  const agentDefs = useAgentDefStore();
  const debug = useDebugStore((s) => s.debug);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentsManagerOpen, setAgentsManagerOpen] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const userScrollLockRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);
  const lastScrollSessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const agentRuntimeRef = useRef<AgentRuntime | null>(null);
  const agentRuntimeMetaRef = useRef<{
    signature: string;
    sessionId: string;
  } | null>(null);
  const agentTurnRef = useRef<{
    assistantId: string | null;
    toolAnchorId: string | null;
    acc: string;
    lastFlush: number;
    toolRecords: Map<string, string>;
    sessionId: string;
  } | null>(null);
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
    useAgentDefStore.getState().load();
    void useUnifiedStore.getState().init();
  }, []);

  const selectedAgent = useMemo(
    () =>
      selectedAgentId
        ? (agentDefs.items.find((a) => a.id === selectedAgentId) ?? null)
        : null,
    [selectedAgentId, agentDefs.items],
  );

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
  const toolCallsByMessage = useMemo(() => {
    const map = new Map<string, ToolCallRecord[]>();
    for (const call of chat.toolCalls) {
      if (!call.messageId) continue;
      const list = map.get(call.messageId);
      if (list) list.push(call);
      else map.set(call.messageId, [call]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    }
    return map;
  }, [chat.toolCalls]);
  const turns = useMemo(() => {
    const list: { id: string; index: number; question: string }[] = [];
    let n = 0;
    for (const m of chat.messages) {
      if (m.role === "user") {
        n += 1;
        list.push({
          id: m.id,
          index: n,
          question: m.content.trim() || t("agent_turn_empty"),
        });
      }
    }
    return list;
  }, [chat.messages, t]);
  useEffect(() => {
    if (turns.length === 0) {
      setActiveTurnId(null);
      return;
    }
    setActiveTurnId((prev) =>
      prev && turns.some((turn) => turn.id === prev)
        ? prev
        : turns[turns.length - 1].id
    );
  }, [turns]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || turns.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-turn-id");
            if (id) setActiveTurnId(id);
          }
        }
      },
      { root, rootMargin: "0px 0px -78% 0px", threshold: 0 }
    );
    for (const turn of turns) {
      const el = document.getElementById(`turn-anchor-${turn.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [turns]);
  const scrollToTurn = (id: string) => {
    const el = document.getElementById(`turn-anchor-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveTurnId(id);
  };

  const isNearScrollBottom = (root: HTMLDivElement) =>
    root.scrollHeight - root.scrollTop - root.clientHeight <
    SCROLL_BOTTOM_THRESHOLD_PX;

  const hasScrollableContent = (root: HTMLDivElement) =>
    root.clientHeight > 0 &&
    root.scrollHeight - root.clientHeight > SCROLL_OVERFLOW_THRESHOLD_PX;

  const setScrollToBottomVisible = (visible: boolean) => {
    setShowScrollToBottom((current) =>
      current === visible ? current : visible
    );
  };

  const syncScrollToBottomButton = (root = scrollRef.current) => {
    if (!root) {
      setScrollToBottomVisible(false);
      return;
    }
    const visible =
      chat.messages.length > 0 &&
      hasScrollableContent(root) &&
      !isNearScrollBottom(root) &&
      !stickToBottomRef.current;
    setScrollToBottomVisible(visible);
  };

  const cancelPendingAutoScroll = () => {
    if (pendingAutoScrollFrameRef.current == null) return;
    cancelAnimationFrame(pendingAutoScrollFrameRef.current);
    pendingAutoScrollFrameRef.current = null;
  };

  const lockScrollFollowForUser = () => {
    const root = scrollRef.current;
    if (!root) return;
    cancelPendingAutoScroll();
    userScrollLockRef.current = true;
    stickToBottomRef.current = false;
    syncScrollToBottomButton(root);
  };

  const updateScrollFollowState = () => {
    const root = scrollRef.current;
    if (!root) return;
    const atBottom = isNearScrollBottom(root);
    const scrollingUp = root.scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = root.scrollTop;

    if (scrollingUp && !atBottom) {
      lockScrollFollowForUser();
      return;
    }

    if (atBottom) {
      userScrollLockRef.current = false;
      stickToBottomRef.current = true;
    } else if (userScrollLockRef.current) {
      stickToBottomRef.current = false;
    } else {
      stickToBottomRef.current = false;
    }
    syncScrollToBottomButton(root);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const root = scrollRef.current;
    if (!root) return;
    cancelPendingAutoScroll();
    userScrollLockRef.current = false;
    root.scrollTo({ top: root.scrollHeight, behavior });
    lastScrollTopRef.current = root.scrollHeight;
    stickToBottomRef.current = true;
    setScrollToBottomVisible(false);
  };

  const handleMessageWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) lockScrollFollowForUser();
  };

  const handleMessageTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleMessageTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const prevY = touchYRef.current;
    const nextY = event.touches[0]?.clientY ?? null;
    if (prevY != null && nextY != null && nextY > prevY) {
      lockScrollFollowForUser();
    }
    touchYRef.current = nextY;
  };

  const handleMessageTouchEnd = () => {
    touchYRef.current = null;
  };
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

  // Warm enabled MCP servers in the background so a healthy server (e.g. a
  // remote HTTP one) is ready instantly when the user sends, and a slow/broken
  // one does its connect attempt off the critical path instead of freezing the
  // first agent turn.
  const activeMcpKey = activeMcp
    .map((s) => `${s.id}:${s.transport}:${s.command ?? ""}:${(s.args ?? []).join(",")}:${s.url ?? ""}`)
    .join("|");
  useEffect(() => {
    if (activeMcp.length > 0) prewarmMcpServers(activeMcp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMcpKey]);

  useEffect(() => {
    setModels(storedModels);
    if (!settings) return;
    if (!storedModels.some((m) => m.id === settings.modelId)) {
      useChatStore.getState().saveSettings({ modelId: storedModels[0]?.id ?? "" });
    }
  }, [storedModels, settings?.modelId]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    if (chat.messages.length === 0) {
      cancelPendingAutoScroll();
      userScrollLockRef.current = false;
      stickToBottomRef.current = true;
      lastScrollTopRef.current = 0;
      setScrollToBottomVisible(false);
      return;
    }

    const sessionChanged = lastScrollSessionRef.current !== chat.activeSessionId;
    if (sessionChanged) {
      lastScrollSessionRef.current = chat.activeSessionId;
      cancelPendingAutoScroll();
      userScrollLockRef.current = false;
      stickToBottomRef.current = true;
    }

    if (stickToBottomRef.current && !userScrollLockRef.current) {
      cancelPendingAutoScroll();
      pendingAutoScrollFrameRef.current = requestAnimationFrame(() => {
        pendingAutoScrollFrameRef.current = null;
        if (stickToBottomRef.current && !userScrollLockRef.current) {
          scrollToBottom("auto");
        } else {
          syncScrollToBottomButton(root);
        }
      });
    } else {
      syncScrollToBottomButton(root);
    }
  }, [chat.activeSessionId, chat.messages]);

  useEffect(() => () => cancelPendingAutoScroll(), []);

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

  const addAttachmentFiles = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      const next = await Promise.all(files.map((f) => chat.fileToAttachment(f)));
      setAttachments((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("agent_read_attachment_failed"));
    }
  };

  const saveAttachmentsForExecution = async (
    inputAttachments: ChatAttachment[]
  ): Promise<ChatAttachment[]> => {
    const workspaceRoot = await resolveSessionWorkspace(
      settings?.sessionId ?? "",
      settings?.workspacePath ?? ""
    );
    return Promise.all(
      inputAttachments.map((attachment) =>
        saveAttachmentToExecutionRoot(attachment, workspaceRoot)
      )
    );
  };

  const {
    getRootProps,
    getInputProps,
    isDragActive: attachmentDragActive,
    open: openAttachmentPicker,
  } = useDropzone({
    disabled: !settings,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDrop: (acceptedFiles) => {
      if (!settings) return;
      void addAttachmentFiles(acceptedFiles);
    },
  });

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
            const attachment = m.attachments.find((a) => a.id === part.attachmentId);
            const pathText = attachment?.path ? `\nLocal path: ${attachment.path}` : "";
            parts.push({
              type: "text",
              text: `[Attached file: ${part.name ?? "file"} (${part.mime ?? "unknown"})${pathText}]`,
            });
          }
          if (part.kind === "audio" || part.kind === "video") {
            const attachment = m.attachments.find((a) => a.id === part.attachmentId);
            const pathText = attachment?.path ? `\nLocal path: ${attachment.path}` : "";
            parts.push({
              type: "text",
              text: `[Attached ${part.kind}: ${part.name ?? part.kind} (${part.mime ?? "unknown"})${pathText}]`,
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
    if (e instanceof GatewayUnavailableError) {
      return setError(e.message || t("agent_gateway_unavailable"));
    }
    if (e instanceof ModelUnavailableError) {
      return setError(e.message || t("agent_model_unavailable", { message: "" }));
    }
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
      let reasoningAcc = "";
      let reasoningStart = 0;
      let reasoningEnd = 0;
      let lastFlush = 0;
      for await (const chunk of adapter.chatStream(req, cred)) {
        if (chunk.reasoningDelta) {
          if (!reasoningStart) reasoningStart = Date.now();
          reasoningAcc += chunk.reasoningDelta;
          reasoningEnd = Date.now();
        }
        acc += chunk.delta;
        const now = Date.now();
        if (now - lastFlush >= STREAM_CONTENT_FLUSH_MS) {
          lastFlush = now;
          await chat.updateMessage(assistant.id, {
            content: acc,
            reasoning: reasoningAcc || undefined,
          });
        }
      }
      const reasoningMs =
        reasoningStart && reasoningEnd > reasoningStart
          ? reasoningEnd - reasoningStart
          : undefined;
      await chat.updateMessage(assistant.id, {
        content: acc,
        status: "complete",
        reasoning: reasoningAcc || undefined,
        reasoningMs,
      });
    } else {
      const res = await adapter.chat(req, cred);
      await chat.updateMessage(assistant.id, {
        content: res.content || summarizeToolCalls(res.toolCalls?.length ?? 0),
        status: "complete",
        usage: res.usage,
        raw: res.raw,
        reasoning: res.reasoning,
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

  const runAgentTurn = async (
    content: string,
    sessionId: string,
    def: AgentDefinition,
    inputAttachments: ChatAttachment[] = [],
  ) => {
    agentTurnRef.current = {
      assistantId: null,
      toolAnchorId: null,
      acc: "",
      lastFlush: 0,
      toolRecords: new Map(),
      sessionId,
    };

    const initialAssistant = await chat.addMessage({
      role: "assistant",
      content: "",
      status: "pending",
      provider: "unified",
      modelId: def.modelId,
    });
    agentTurnRef.current.assistantId = initialAssistant.id;
    agentTurnRef.current.toolAnchorId = initialAssistant.id;

    const callbacks: AgentRuntimeCallbacks = {
      onAssistantStart: async () => {
        const st = agentTurnRef.current;
        if (!st) return;
        if (st.assistantId) {
          st.toolAnchorId = st.toolAnchorId ?? st.assistantId;
          st.acc = "";
          st.lastFlush = 0;
          return;
        }
        const msg = await chat.addMessage({
          role: "assistant",
          content: "",
          status: "pending",
          provider: "unified",
          modelId: def.modelId,
        });
        st.assistantId = msg.id;
        st.toolAnchorId = msg.id;
        st.acc = "";
        st.lastFlush = 0;
      },
      onAssistantDelta: async (textContent) => {
        const st = agentTurnRef.current;
        if (!st || !st.assistantId) return;
        st.acc = textContent;
        const now = Date.now();
        if (now - st.lastFlush >= STREAM_CONTENT_FLUSH_MS) {
          st.lastFlush = now;
          await chat.updateMessage(st.assistantId, { content: textContent });
        }
      },
      onAssistantEnd: async (textContent) => {
        const st = agentTurnRef.current;
        if (!st || !st.assistantId) return;
        await chat.updateMessage(st.assistantId, {
          content: textContent,
          status: "complete",
        });
        st.assistantId = null;
      },
      onToolStart: async ({ toolCallId, toolName, args }) => {
        const st = agentTurnRef.current;
        if (!st) return;
        const rec = await chat.recordToolCall({
          sessionId: st.sessionId,
          messageId: st.toolAnchorId ?? st.assistantId ?? undefined,
          source: toolName.startsWith("mcp__") ? "mcp" : "skill",
          toolName,
          title: toolName,
          argumentsJson: JSON.stringify(args ?? {}),
          status: "running",
          startedAt: new Date().toISOString(),
        });
        st.toolRecords.set(toolCallId, rec.id);
      },
      onToolEnd: async ({ toolCallId, resultText, resultJson, isError }) => {
        const st = agentTurnRef.current;
        if (!st) return;
        const recId = st.toolRecords.get(toolCallId);
        if (!recId) return;
        const startedRec = chat.toolCalls.find((c) => c.id === recId);
        const completedAt = new Date().toISOString();
        const durationMs = startedRec
          ? Date.parse(completedAt) - Date.parse(startedRec.startedAt)
          : undefined;
        await chat.updateToolCall(recId, {
          status: isError ? "error" : "success",
          resultText,
          resultJson,
          completedAt,
          durationMs,
          error: isError ? resultText : undefined,
        });
        st.toolRecords.delete(toolCallId);
      },
      onError: async (message) => {
        const st = agentTurnRef.current;
        if (st?.assistantId) {
          await chat.updateMessage(st.assistantId, {
            status: "error",
            error: message,
          });
          st.assistantId = null;
        }
        setError(message);
      },
    };

    let runtime = agentRuntimeRef.current;
    const meta = agentRuntimeMetaRef.current;
    const workspacePath = await resolveSessionWorkspace(
      sessionId,
      settings?.workspacePath ?? ""
    );
    const signature = agentRuntimeSignature(def, workspacePath);
    const needNew =
      !runtime ||
      meta?.signature !== signature ||
      meta?.sessionId !== sessionId;
    if (needNew) {
      runtime?.abort();
      runtime = await createAgentRuntime(def, callbacks, { workspacePath });
      agentRuntimeRef.current = runtime;
      agentRuntimeMetaRef.current = { signature, sessionId };
      const notices: string[] = [];
      if (runtime.mcpErrors.length > 0) {
        notices.push(
          t("agent_mcp_errors", {
            servers: runtime.mcpErrors.map((e) => e.server).join(", "),
          }),
        );
      }
      if (runtime.mcpPending.length > 0) {
        notices.push(
          t("agent_mcp_pending", {
            servers: runtime.mcpPending.join(", "),
          }),
        );
      }
      if (notices.length > 0) setError(notices.join("\n"));
    }
    await runtime!.prompt(promptWithAttachmentPaths(content, inputAttachments));
    await runtime!.waitForIdle();
  };

  /**
   * Resolve which agent definition (if any) should handle this turn. Returns a
   * named agent, an ad-hoc agent synthesized from the composer's enabled
   * skills/MCP, or null to fall back to the direct (non-tool) chat path.
   */
  const resolveTurnAgent = (): AgentDefinition | null => {
    if (selectedAgent) return selectedAgent;
    if (!settings?.connKey) return null;
    const wantsTools =
      AGENT_INTERNAL_TOOL_IDS.length > 0 ||
      activeSkills.length > 0 ||
      activeMcp.length > 0;
    if (!wantsTools) return null;
    if (
      selectedModel &&
      (isImageGenerationModel(selectedModel) ||
        isVideoGenerationModel(selectedModel))
    ) {
      return null;
    }
    const unified = useUnifiedStore.getState();
    const disabled = new Set(unified.config.disabledModelIds);
    const exposed = unified.models.find(
      (m) =>
        m.connId === settings.connKey &&
        m.realModel === settings.modelId &&
        !disabled.has(m.id),
    );
    if (!exposed) {
      setError(t("agent_tools_need_gateway"));
      return null;
    }
    return buildAdHocAgentDef(settings, exposed.id);
  };

  const send = async () => {
    if (sending || !settings) return;
    const content = input.trim();
    const validationError = validateGenerationInput(content, attachments);
    if (validationError) return setError(validationError);

    setError(null);
    setSending(true);

    try {
      const pendingAttachments = await saveAttachmentsForExecution(attachments);
      const parts = partsFromInput(content, pendingAttachments);
      const turnAgent = resolveTurnAgent();
      setInput("");
      setAttachments([]);
      const userMsg = await chat.addMessage({
        role: "user",
        content,
        parts,
        attachments: pendingAttachments,
      });
      if (turnAgent) {
        await runAgentTurn(content, userMsg.sessionId, turnAgent, pendingAttachments);
      } else {
        await generateAssistantForUser({
          userMsg,
          history: [...chat.messages, userMsg],
          prompt: content,
          inputAttachments: pendingAttachments,
        });
      }
    } catch (e) {
      await handleGenerationError(e);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    agentRuntimeRef.current?.abort();
  };

  /**
   * Drop the cached Pi runtime so the next agent turn rebuilds from the current
   * chat history. Call after any action that rewrites the message list (edit,
   * delete, retry) to avoid the runtime's internal history diverging from the
   * persisted conversation.
   */
  const resetAgentRuntime = () => {
    agentRuntimeRef.current?.abort();
    agentRuntimeRef.current = null;
    agentRuntimeMetaRef.current = null;
  };

  const retryFromUserMessage = async (message: PersistedChatMessage) => {
    if (sending || !settings) return;
    const prompt = message.content.trim();
    const validationError = validateGenerationInput(prompt, message.attachments);
    if (validationError) return setError(validationError);
    abortRef.current?.abort();
    resetAgentRuntime();
    setError(null);
    setEditingMessageId(null);
    setSending(true);
    try {
      await chat.deleteMessagesFrom(message.sessionId, message.id, false);
      const currentMessages = useChatStore.getState().messages;
      const userMsg = currentMessages.find((m) => m.id === message.id) ?? message;
      const savedAttachments = await saveAttachmentsForExecution(userMsg.attachments);
      const userMsgWithAttachments = { ...userMsg, attachments: savedAttachments };
      const history = currentMessages.map((m) =>
        m.id === userMsg.id ? userMsgWithAttachments : m
      );
      const turnAgent = resolveTurnAgent();
      if (turnAgent) {
        await runAgentTurn(prompt, userMsg.sessionId, turnAgent, savedAttachments);
      } else {
        await generateAssistantForUser({
          userMsg: userMsgWithAttachments,
          history,
          prompt,
          inputAttachments: savedAttachments,
        });
      }
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
    resetAgentRuntime();
    setError(null);
    setEditingMessageId(null);
    setSending(true);
    try {
      await chat.deleteMessagesFrom(message.sessionId, message.id, true);
      const currentMessages = useChatStore.getState().messages;
      const latestUser = currentMessages.find((m) => m.id === userMsg.id) ?? userMsg;
      const savedAttachments = await saveAttachmentsForExecution(latestUser.attachments);
      const latestUserWithAttachments = { ...latestUser, attachments: savedAttachments };
      const history = currentMessages.map((m) =>
        m.id === latestUser.id ? latestUserWithAttachments : m
      );
      const turnAgent = resolveTurnAgent();
      if (turnAgent) {
        await runAgentTurn(prompt, latestUser.sessionId, turnAgent, savedAttachments);
      } else {
        await generateAssistantForUser({
          userMsg: latestUserWithAttachments,
          history,
          prompt,
          inputAttachments: savedAttachments,
        });
      }
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
    resetAgentRuntime();
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
    if (sending) return;

    // Debug-only: edit an agent reply in place. No re-run, no truncation of
    // the conversation after it. Gated by the global debug switch.
    if (message.role === "assistant") {
      if (!debug) {
        setEditingMessageId(null);
        setEditingDraft("");
        return;
      }
      const content = editingDraft.trim();
      if (!content) {
        setError(t("agent_edit_empty"));
        return;
      }
      setError(null);
      try {
        await chat.replaceMessageContent(
          message.id,
          content,
          editedPartsForMessage(message, content)
        );
        setEditingMessageId(null);
        setEditingDraft("");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("agent_request_failed"));
      }
      return;
    }

    if (message.role !== "user") return;
    const prompt = editingDraft.trim();
    if (!prompt && message.attachments.length === 0) {
      setError(t("agent_edit_empty"));
      return;
    }
    const validationError = validateGenerationInput(prompt, message.attachments);
    if (validationError) return setError(validationError);
    abortRef.current?.abort();
    resetAgentRuntime();
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
      const savedAttachments = await saveAttachmentsForExecution(userMsg.attachments);
      const userMsgWithAttachments = { ...userMsg, attachments: savedAttachments };
      const history = currentMessages.map((m) =>
        m.id === userMsg.id ? userMsgWithAttachments : m
      );
      const turnAgent = resolveTurnAgent();
      if (turnAgent) {
        await runAgentTurn(prompt, userMsg.sessionId, turnAgent, savedAttachments);
      } else {
        await generateAssistantForUser({
          userMsg: userMsgWithAttachments,
          history,
          prompt,
          inputAttachments: savedAttachments,
        });
      }
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
            <div className="min-w-0">
              {titleEditing ? (
                <Input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (activeSession) chat.renameSession(activeSession.id, titleDraft);
                    setTitleEditing(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (activeSession) chat.renameSession(activeSession.id, titleDraft);
                      setTitleEditing(false);
                    }
                    if (e.key === "Escape") setTitleEditing(false);
                  }}
                  className="h-7 w-[min(22rem,50vw)] text-heading-14"
                />
              ) : (
                <button
                  type="button"
                  disabled={!activeSession}
                  onClick={() => {
                    if (!activeSession) return;
                    setTitleDraft(activeSession.title);
                    setTitleEditing(true);
                  }}
                  title={activeSession ? t("rename_session", { ns: "common" }) : undefined}
                  className="block max-w-full truncate rounded-sm text-left text-heading-14 text-foreground transition-colors hover:text-foreground/70 disabled:cursor-default disabled:hover:text-foreground"
                >
                  {activeSession?.title ?? t("agent_new_session")}
                </button>
              )}
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

          <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={updateScrollFollowState}
            onWheel={handleMessageWheel}
            onTouchStart={handleMessageTouchStart}
            onTouchMove={handleMessageTouchMove}
            onTouchEnd={handleMessageTouchEnd}
            onTouchCancel={handleMessageTouchEnd}
            className="flex-1 overflow-y-auto px-4 pb-4 pt-6"
          >
            <div className="mx-auto flex min-h-full w-full max-w-[1040px] flex-col">
              {chat.loading ? (
                <MessageSkeletons />
              ) : chat.messages.length === 0 ? (
                <WelcomeScreen
                  selectedModel={selectedModel}
                  selectedAgent={selectedAgent}
                  onPickStarter={(text) => setInput(text)}
                />
              ) : (
                <div className="space-y-5">
                  {chat.messages.map((m, i) => {
                    const editingThisMessage = editingMessageId === m.id;
                    return (
                      <ChatBubble
                        key={m.id}
                        turnId={m.role === "user" ? m.id : undefined}
                        message={m}
                        toolCalls={toolCallsByMessage.get(m.id)}
                        typing={m.status === "pending" && !m.content}
                        streaming={sending && i === chat.messages.length - 1}
                        editing={editingThisMessage}
                        debug={debug}
                        editingDraft={editingThisMessage ? editingDraft : ""}
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
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <AnimatePresence>
            {showScrollToBottom && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => scrollToBottom("smooth")}
                title={t("agent_scroll_to_bottom")}
                className="absolute bottom-4 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)] transition-colors hover:text-foreground"
              >
                <ArrowDown className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>
          {turns.length > 1 && (
            <TurnRail
              turns={turns}
              activeId={activeTurnId}
              onSelect={scrollToTurn}
            />
          )}
          </div>

          <div className="shrink-0 bg-gradient-to-t from-background via-background to-background/75 px-4 pb-4 pt-2">
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
            <div
              {...getRootProps({
                className: cn(
                  "relative mx-auto w-full max-w-[800px] overflow-hidden rounded-lg border border-input bg-card shadow-[0_14px_42px_rgba(0,0,0,0.11),0_3px_10px_rgba(0,0,0,0.06)] transition-[border-color,background-color,box-shadow] duration-150 ease-geist focus-within:border-muted-foreground/40",
                  attachmentDragActive &&
                    "border-accent/70 bg-accent/5 shadow-[0_16px_48px_rgba(0,0,0,0.14),0_0_0_3px_hsl(var(--accent)/0.14)]"
                ),
              })}
            >
              <input {...getInputProps()} />
              {attachmentDragActive && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border border-dashed border-accent/70 bg-background/75 text-label-13 font-medium text-accent backdrop-blur-[1px]">
                  {t("agent_drop_files")}
                </div>
              )}
              {attachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-3 pb-1.5 pt-3">
                  {attachments.map((a) => (
                    <AttachmentPreviewCard
                      key={a.id}
                      attachment={a}
                      onRemove={() =>
                        setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                      }
                    />
                  ))}
                  <button
                    type="button"
                    disabled={!settings}
                    title={t("agent_add_attachment")}
                    onClick={openAttachmentPicker}
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-background/40 text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              )}
              <Textarea
                className={cn(
                  "h-[52px] min-h-0 max-h-32 resize-none border-0 bg-transparent px-4 py-3.5 text-copy-14 shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:shadow-none",
                  attachments.length > 0 && "pt-2.5"
                )}
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
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-2 pb-2 pt-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!settings}
                  title={t("agent_add_attachment")}
                  onClick={openAttachmentPicker}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>

                <div className="w-[176px] shrink-0">
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

                {settings && (
                  <SandboxModeSelect
                    value={settings.sandboxMode}
                    onChange={(sandboxMode) => updateSettings({ sandboxMode })}
                    triggerClassName="h-7 w-[140px] shrink-0 gap-1.5 rounded-md px-2 text-label-12 font-normal text-muted-foreground"
                    title={t("agent_current_sandbox")}
                    showIcon
                  />
                )}

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

                {SHOW_AGENT_PICKER && (
                  <>
                    <Select
                      value={selectedAgentId ?? DIRECT_AGENT_VALUE}
                      onValueChange={(v) =>
                        setSelectedAgentId(v === DIRECT_AGENT_VALUE ? null : v)
                      }
                    >
                      <SelectTrigger className="h-7 w-[138px] gap-1.5 text-label-12">
                        <Bot className="h-3.5 w-3.5 shrink-0" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DIRECT_AGENT_VALUE}>
                          {t("agent_mode_direct")}
                        </SelectItem>
                        {agentDefs.items.map((def) => (
                          <SelectItem key={def.id} value={def.id}>
                            {def.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title={t("agents_manage_title")}
                      onClick={() => setAgentsManagerOpen(true)}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </>
                )}

                <div className="ml-auto pl-1">
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
                      disabled={
                        (!selectedModel && !selectedAgent) ||
                        (!input.trim() && attachments.length === 0)
                      }
                      title={t("agent_send")}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
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

        <AgentsManagerDialog
          open={agentsManagerOpen}
          onOpenChange={setAgentsManagerOpen}
        />
    </div>
  );
}

function summarizeToolCalls(count: number): string {
  return count > 0 ? i18n.t("pages:agent_tool_calls_summary", { count }) : "";
}

const STARTER_PROMPTS: {
  id: string;
  icon: ComponentType<{ className?: string }>;
  titleKey: string;
  textKey: string;
}[] = [
  {
    id: "tools",
    icon: Compass,
    titleKey: "agent_starter_tools_title",
    textKey: "agent_starter_tools_text",
  },
  {
    id: "code",
    icon: Code2,
    titleKey: "agent_starter_code_title",
    textKey: "agent_starter_code_text",
  },
  {
    id: "explain",
    icon: Lightbulb,
    titleKey: "agent_starter_explain_title",
    textKey: "agent_starter_explain_text",
  },
  {
    id: "plan",
    icon: ListChecks,
    titleKey: "agent_starter_plan_title",
    textKey: "agent_starter_plan_text",
  },
];

function WelcomeScreen({
  selectedModel,
  selectedAgent,
  onPickStarter,
}: {
  selectedModel: ModelInfo | null;
  selectedAgent: AgentDefinition | null;
  onPickStarter: (text: string) => void;
}) {
  const { t } = useTranslation("pages");
  const reduce = useReducedMotion();
  const contextLabel = selectedAgent
    ? selectedAgent.name
    : selectedModel
      ? selectedModel.name
      : null;

  return (
    <div className="flex min-h-full flex-col items-center justify-center py-10">
      <div className="w-full max-w-[680px]">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent-subtle text-accent ring-1 ring-inset ring-border">
            <SquareTerminal className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-heading-24 text-foreground">
            {t("agent_welcome_greeting")}
          </h2>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-copy-14 text-muted-foreground">
            {contextLabel ? (
              <>
                {selectedAgent ? (
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                ) : selectedModel ? (
                  <ModelIcon model={selectedModel} className="h-3.5 w-3.5 shrink-0" />
                ) : null}
                <span className="truncate">
                  {t("agent_welcome_ready", { model: contextLabel })}
                </span>
              </>
            ) : (
              <span>{t("agent_welcome_pick_model")}</span>
            )}
          </p>
        </motion.div>

        <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {STARTER_PROMPTS.map((starter, i) => {
            const Icon = starter.icon;
            const text = t(starter.textKey);
            return (
              <Reveal key={starter.id} index={i + 1}>
                <button
                  type="button"
                  onClick={() => onPickStarter(text)}
                  className="group flex h-full w-full items-start gap-3 rounded-md border border-border bg-card p-3.5 text-left transition-all duration-200 ease-geist hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-geist-md"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground transition-colors group-hover:bg-accent-subtle group-hover:text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-13 font-medium text-foreground">
                      {t(starter.titleKey)}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-label-12 text-muted-foreground">
                      {text}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </Reveal>
            );
          })}
        </div>
      </div>
    </div>
  );
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
              "grid max-w-[78%] gap-2 rounded-md px-3.5 py-3",
              item === 1
                ? "w-[42%] bg-accent/10"
                : "w-[62%] border border-border bg-card",
              item === 1 ? "rounded-tr-sm" : "rounded-tl-sm"
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
  const debug = useDebugStore((s) => s.debug);
  const setDebug = useDebugStore((s) => s.setDebug);
  if (!settings) {
    return (
      <aside className="flex h-full w-full items-center justify-center bg-card-elevated p-5 text-label-13 text-muted-foreground">
        {t("agent_loading_settings")}
      </aside>
    );
  }
  return (
    <aside className="flex h-full w-full min-h-0 flex-col bg-card-elevated">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b border-border bg-card-elevated px-4">
        <div className="text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
          {t("agent_config_title")}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} title={t("agent_hide_config")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <RailSection icon={Settings2} title={t("agent_request_section")}>
        <div className="rounded-md border border-border bg-secondary/50 p-3 text-label-12 text-muted-foreground">
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
        <div className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2">
          <Label className="cursor-pointer">{t("agent_streaming")}</Label>
          <Switch
            checked={settings.streaming}
            onCheckedChange={(streaming) => onSettings({ streaming })}
          />
        </div>
      </RailSection>

      <RailSection icon={FolderOpen} title={t("agents_workspace_label")}>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-chat-workspace">
            {t("agents_workspace_label")}
          </Label>
          <Input
            id="agent-chat-workspace"
            placeholder={t("agents_workspace_placeholder")}
            value={settings.workspacePath}
            onChange={(e) => onSettings({ workspacePath: e.target.value })}
          />
        </div>
        <div className="rounded-md border border-border p-3 text-label-12 text-muted-foreground">
          {t("agents_workspace_hint")}
        </div>
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={ShieldIcon} title={t("agent_sandbox_section")}>
        <SandboxModeSelect
          value={settings.sandboxMode}
          onChange={(sandboxMode) => onSettings({ sandboxMode })}
        />
        <div className="rounded-md border border-border p-3 text-label-12 text-muted-foreground">
          {t("agent_sandbox_hint")}
        </div>
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={Bug} title={t("agent_debug_section")}>
        <div className="flex items-center justify-between gap-3 rounded-md bg-secondary/60 px-3 py-2">
          <Label className="cursor-pointer" htmlFor="agent-debug-edit">
            {t("agent_debug_edit_agent")}
          </Label>
          <Switch
            id="agent-debug-edit"
            checked={debug}
            onCheckedChange={(value) => setDebug(value)}
          />
        </div>
        <div className="rounded-md border border-border p-3 text-label-12 text-muted-foreground">
          {t("agent_debug_edit_agent_hint")}
        </div>
      </RailSection>

      <Separator className="my-4" />

      <RailSection icon={Database} title={t("agent_tool_records")}>
        {toolCalls.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-3 text-label-12 text-muted-foreground">
            {t("agent_no_tool_calls")}
          </div>
        ) : (
          <div className="grid gap-2">
            {toolCalls.slice(0, 5).map((call) => (
              <div key={call.id} className="rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-label-12 font-medium">
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
                  <div className="mt-1.5 line-clamp-2 text-label-12 text-muted-foreground">
                    {call.resultText}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </RailSection>
      </div>
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
              <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
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

function SandboxModeSelect({
  value,
  onChange,
  triggerClassName,
  title,
  showIcon = false,
}: {
  value: SandboxMode;
  onChange: (value: SandboxMode) => void;
  triggerClassName?: string;
  title?: string;
  showIcon?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(sandboxMode) => onChange(sandboxMode as SandboxMode)}
    >
      <SelectTrigger className={triggerClassName} title={title}>
        {showIcon && <ShieldIcon className="h-3.5 w-3.5 shrink-0" />}
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
  );
}

function formatAttachmentSize(size: number) {
  if (size <= 0) return "";
  if (size < 1024) return `${size}B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 2 : value >= 10 ? 2 : 1;
  const formatted = value
    .toFixed(precision)
    .replace(/\.0$/, "")
    .replace(/(\.\d)0$/, "$1")
    .replace(/\.00$/, "");
  return `${formatted}${units[unitIndex]}`;
}

function attachmentFallbackLabel(
  attachment: ChatAttachment,
  t: (key: string) => string
) {
  if (attachment.kind === "video") return t("agent_attachment_video");
  if (attachment.kind === "image") return t("agent_attachment_image");
  return t("agent_attachment");
}

function attachmentExtension(name: string) {
  const [, ext = ""] = /\.([^.]+)$/.exec(name.toLowerCase()) ?? [];
  return ext;
}

function attachmentVisual(attachment: ChatAttachment): {
  Icon: ComponentType<{ className?: string }>;
  frameClassName: string;
  iconClassName: string;
} {
  const ext = attachmentExtension(attachment.name);
  const mime = attachment.mime.toLowerCase();
  if (
    attachment.kind === "image" ||
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)
  ) {
    return {
      Icon: FileImage,
      frameClassName: "bg-sky-500",
      iconClassName: "text-white",
    };
  }
  if (attachment.kind === "video") {
    return {
      Icon: FileVideo,
      frameClassName: "bg-violet-500",
      iconClassName: "text-white",
    };
  }
  if (attachment.kind === "audio") {
    return {
      Icon: FileAudio,
      frameClassName: "bg-amber-500",
      iconClassName: "text-white",
    };
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    ["csv", "xls", "xlsx", "numbers"].includes(ext)
  ) {
    return {
      Icon: FileSpreadsheet,
      frameClassName: "bg-emerald-500",
      iconClassName: "text-white",
    };
  }
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    ["json", "jsonl", "ts", "tsx", "js", "jsx", "html", "css", "xml"].includes(ext)
  ) {
    return {
      Icon: FileCode,
      frameClassName: "bg-indigo-500",
      iconClassName: "text-white",
    };
  }
  if (["zip", "gz", "tar", "rar", "7z"].includes(ext)) {
    return {
      Icon: FileArchive,
      frameClassName: "bg-stone-500",
      iconClassName: "text-white",
    };
  }
  return {
    Icon: FileText,
    frameClassName: "bg-muted",
    iconClassName: "text-muted-foreground",
  };
}

function AttachmentPreviewCard({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const { t } = useTranslation("pages");
  const isImage = attachment.kind === "image";
  const imageSrc = attachmentSrc(attachment);
  const sizeLabel =
    formatAttachmentSize(attachment.size) || attachmentFallbackLabel(attachment, t);
  const visual = attachmentVisual(attachment);
  const Icon = visual.Icon;
  return (
    <div className="flex h-[52px] w-full max-w-[280px] items-center gap-2.5 rounded-md border border-border bg-background px-2.5 shadow-[0_1px_1px_rgba(0,0,0,0.03)] sm:w-[280px]">
      {isImage && imageSrc ? (
        <img
          src={imageSrc}
          alt={attachment.name}
          className="h-8 w-8 shrink-0 rounded-sm object-cover"
        />
      ) : (
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
            visual.frameClassName
          )}
        >
          <Icon className={cn("h-4 w-4", visual.iconClassName)} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-label-13 font-semibold text-foreground">
          {attachment.name}
        </div>
        <div className="truncate text-label-12 text-muted-foreground">
          {sizeLabel}
        </div>
      </div>
      {onRemove && (
        <Button
          size="icon-sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  turnId,
  toolCalls,
  typing,
  streaming,
  editing,
  debug,
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
  turnId?: string;
  toolCalls?: ToolCallRecord[];
  typing?: boolean;
  streaming?: boolean;
  editing?: boolean;
  debug?: boolean;
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
  const canEdit = message.role === "user" || message.role === "assistant";
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
  const hasToolCalls = !isUser && !!toolCalls && toolCalls.length > 0;
  const hasMessageBubble =
    editing ||
    generatedImages.length > 0 ||
    generatedVideos.length > 0 ||
    pillAttachments.length > 0 ||
    !!visibleContent ||
    !!message.error ||
    (!isUser && !!message.reasoning);
  const actionOnly = hasToolCalls && !hasMessageBubble && !typing;

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
      id={turnId ? `turn-anchor-${turnId}` : undefined}
      data-turn-id={turnId}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group flex w-full scroll-mt-6", isUser && "justify-end")}
    >
      <div className={cn("flex max-w-[90%] flex-col gap-1.5", isUser && "items-end")}>
        {hasMessageBubble && (
          <div
            className={cn(
              "text-copy-14",
              editing
                ? "rounded-lg border border-input bg-card p-2 text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
                : "rounded-md px-3.5 py-2.5",
              !editing &&
                (isUser
                  ? "rounded-tr-sm bg-muted text-foreground"
                  : isTool
                    ? "rounded-tl-sm border border-border bg-secondary text-foreground"
                    : "rounded-tl-sm border border-border bg-card text-foreground shadow-geist-sm")
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
                  <AttachmentPreviewCard key={a.id} attachment={a} />
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
                    {isUser ? t("agent_save_retry") : t("agent_save")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                {!isUser && message.reasoning && (
                  <ReasoningTrace
                    reasoning={message.reasoning}
                    reasoningMs={message.reasoningMs}
                    streaming={streaming && message.status === "pending"}
                  />
                )}
                {visibleContent &&
                  (isUser ? (
                    <div className="whitespace-pre-wrap break-words">
                      {visibleContent}
                    </div>
                  ) : (
                    <MarkdownMessage
                      content={visibleContent}
                      streaming={streaming && message.status === "pending"}
                    />
                  ))}
                {message.error && (
                  <div className="whitespace-pre-wrap break-words rounded-sm border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-label-12 text-destructive">
                    {message.error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {!isUser && typing && !hasToolCalls && <AssistantWorkingStatus />}
        {hasToolCalls && (
          <ToolCallTrace toolCalls={toolCalls} />
        )}
        {!editing && !actionOnly && (
          <div
            className={cn(
              "flex items-center gap-1",
              isUser && "flex-row-reverse"
            )}
          >
            {!typing && (
              <span className="shrink-0 select-none px-0.5 text-label-12 tabular-nums text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                {formatTime(message.createdAt)}
              </span>
            )}
            {debug && (
              <div
                className={cn(
                  "flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
                  isUser && "flex-row-reverse"
                )}
              >
                {canEdit && (
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
        )}
      </div>
    </motion.div>
  );
}

function prettyJson(input: string): string {
  if (!input) return "";
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

function parseToolName(raw: string): { name: string; server?: string } {
  if (!raw) return { name: raw };
  const mcp = raw.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) {
    const server = mcp[1].replace(/^mcp-server-/, "");
    return { name: mcp[2], server };
  }
  return { name: raw };
}

function AssistantWorkingStatus() {
  const { t } = useTranslation("pages");
  const reduce = useReducedMotion();

  return (
    <div
      className="flex w-fit items-center gap-2 rounded-sm border border-border bg-secondary/40 px-2.5 py-1.5 text-label-12 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Bot className="h-3.5 w-3.5 shrink-0" />
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        {reduce ? (
          <span className="block h-full w-1/3 rounded-full bg-muted-foreground/55" />
        ) : (
          <motion.span
            className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-foreground/60"
            animate={{ x: ["-120%", "320%"] }}
            transition={{
              duration: 1.15,
              repeat: Infinity,
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        )}
      </span>
      <span>{t("agent_execution_starting")}</span>
    </div>
  );
}

function ReasoningTrace({
  reasoning,
  reasoningMs,
  streaming,
}: {
  reasoning: string;
  reasoningMs?: number;
  streaming?: boolean;
}) {
  const { t } = useTranslation("pages");
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? !!streaming;
  const seconds =
    typeof reasoningMs === "number" && reasoningMs > 0
      ? Math.max(1, Math.round(reasoningMs / 1000))
      : null;
  const label =
    seconds != null
      ? t("agent_thought_for", { seconds })
      : streaming
        ? t("agent_thinking")
        : t("agent_thought");
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        className="flex items-center gap-1.5 text-label-12 font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Lightbulb className="h-3.5 w-3.5" />
        <span>{label}</span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap break-words border-l border-border pl-3 text-copy-13 italic leading-relaxed text-muted-foreground">
          {reasoning}
        </div>
      )}
    </div>
  );
}

function ToolCallTrace({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  const { t } = useTranslation("pages");
  const label =
    toolCalls.length > 1
      ? t("agent_parallel_actions_label")
      : t("agent_actions_label");
  return (
    <div className="w-full border-l border-dashed border-border pl-3">
      <div className="grid gap-1">
        {toolCalls.map((call, index) => (
          <ToolCallCard
            key={call.id}
            call={call}
            label={index === 0 ? label : undefined}
            count={
              index === 0 && toolCalls.length > 1
                ? toolCalls.length
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function TurnRail({
  turns,
  activeId,
  onSelect,
}: {
  turns: { id: string; index: number; question: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("pages");
  const [hover, setHover] = useState<{ id: string; top: number; right: number } | null>(
    null
  );
  const hovered = hover ? turns.find((turn) => turn.id === hover.id) : undefined;
  return (
    <div className="pointer-events-none absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 md:block">
      <div className="pointer-events-auto flex max-h-[72vh] flex-col items-end gap-2 overflow-y-auto py-1 pr-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {turns.map((turn) => {
          const active = turn.id === activeId;
          return (
            <button
              key={turn.id}
              type="button"
              onClick={() => onSelect(turn.id)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHover({
                  id: turn.id,
                  top: rect.top + rect.height / 2,
                  right: window.innerWidth - rect.left + 8,
                });
              }}
              onMouseLeave={() =>
                setHover((prev) => (prev?.id === turn.id ? null : prev))
              }
              className="group/turn relative flex h-2.5 items-center justify-end"
              aria-label={t("agent_turn_label", { count: turn.index })}
            >
              <span
                className={cn(
                  "block rounded-full transition-all duration-200 ease-out",
                  active
                    ? "h-[3px] w-4 bg-foreground"
                    : "h-[2px] w-2.5 bg-muted-foreground group-hover/turn:w-3.5 group-hover/turn:bg-foreground"
                )}
              />
            </button>
          );
        })}
      </div>
      {hover &&
        hovered &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100] flex w-max max-w-[18rem] -translate-y-1/2 items-start gap-2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-label-12 text-popover-foreground shadow-geist-md"
            style={{ top: hover.top, right: hover.right }}
          >
            <span className="shrink-0 rounded-sm bg-secondary px-1 py-px tabular-nums text-muted-foreground">
              {hovered.index}
            </span>
            <span className="line-clamp-2 text-foreground">{hovered.question}</span>
          </div>,
          document.body
        )}
    </div>
  );
}

function ToolCallCard({
  call,
  label,
  count,
}: {
  call: ToolCallRecord;
  label?: string;
  count?: number;
}) {
  const { t } = useTranslation("pages");
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const isRunning = call.status === "running";
  const isError = call.status === "error";
  const argsText = prettyJson(call.argumentsJson);
  const hasArgs = argsText && argsText !== "{}";
  const parsed = parseToolName(call.toolName || call.title);
  const resultText =
    call.resultText ??
    (call.resultJson !== undefined
      ? JSON.stringify(call.resultJson, null, 2)
      : "");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-sm border border-border/70 bg-card",
        isRunning && "border-accent/25 bg-background"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left transition-colors hover:bg-secondary/60"
      >
        {isRunning && !reduce && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
            animate={{ x: ["-120%", "420%"] }}
            transition={{
              duration: 1.25,
              repeat: Infinity,
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        )}
        {label && (
          <span className="flex shrink-0 items-center gap-1.5 text-label-12 font-medium text-muted-foreground">
            <Wrench className="h-3 w-3" />
            <span>{label}</span>
            {typeof count === "number" && (
              <span className="tabular-nums text-muted-foreground/70">
                · {count}
              </span>
            )}
          </span>
        )}
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
        ) : isError ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-mono text-label-12 font-medium text-foreground">
            {parsed.name}
          </span>
          {parsed.server && (
            <span className="hidden shrink-0 items-center gap-1 rounded-sm bg-secondary px-1.5 py-px font-mono text-label-12 text-muted-foreground sm:inline-flex">
              <Server className="h-3 w-3" />
              {parsed.server}
            </span>
          )}
        </span>
        <span className="shrink-0 text-label-12 tabular-nums text-muted-foreground">
          {formatTime(call.startedAt)}
        </span>
        <Badge
          variant={
            isRunning ? "outline" : isError ? "destructive" : "success"
          }
          className="rounded-sm"
        >
          {isRunning
            ? t("agent_tool_status_running")
            : isError
              ? t("agent_tool_status_error")
              : t("agent_tool_status_success")}
        </Badge>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border/70 px-2.5 py-2">
          {hasArgs && (
            <div className="grid gap-1">
              <div className="text-label-12 font-medium text-muted-foreground">
                {t("agent_tool_arguments")}
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-secondary/60 p-2 font-mono text-label-12 text-foreground">
                {argsText}
              </pre>
            </div>
          )}
          {resultText ? (
            <div className="grid gap-1">
              <div className="text-label-12 font-medium text-muted-foreground">
                {t("agent_tool_result")}
              </div>
              <pre
                className={cn(
                  "max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm p-2 font-mono text-label-12",
                  isError
                    ? "bg-destructive/10 text-destructive"
                    : "bg-secondary/60 text-foreground"
                )}
              >
                {resultText}
              </pre>
            </div>
          ) : (
            !isRunning && (
              <div className="text-label-12 text-muted-foreground">
                {t("agent_tool_no_result")}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function SlidersIcon({ className }: { className?: string }) {
  return <Eraser className={className} />;
}

function ShieldIcon({ className }: { className?: string }) {
  return <Shield className={className} />;
}
