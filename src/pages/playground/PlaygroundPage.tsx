import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Bot,
  Eraser,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { TypingDots } from "@/components/common/Reveal";
import { ModelFeatureBadges } from "@/components/common/ModelFeatureBadges";
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
import { useVolcCredentialStore, useGatewayStore, useApiKeyStore } from "@/store";
import { cn } from "@/lib/utils";
import { isLiveRequestSupported } from "@/lib/http";
import { getAdapter } from "@/lib/providers";
import type {
  ChatMessage,
  ContentPart,
  ModelInfo,
  ProviderCredential,
  WireFormat,
} from "@/lib/providers/types";
import { listEndpoints } from "@/lib/providers/volcengine";
import {
  PROVIDER_METAS,
  type VolcCredential,
  type GatewayConnection,
  type ApiKey,
} from "@/types";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

/** A selectable connection, unifying volcengine credentials, gateways and manual keys. */
interface ConnOption {
  /** Composite key: "volc:<id>", "gw:<id>" or "key:<id>". */
  key: string;
  name: string;
  kind: "volc" | "gateway" | "manual";
  provider: string;
}

function providerLabel(provider: string): string {
  return PROVIDER_METAS.find((p) => p.id === provider)?.label ?? provider;
}

const WIRE_FORMATS: { value: WireFormat; label: string }[] = [
  { value: "openai-chat", label: "OpenAI Chat (/chat/completions)" },
  { value: "openai-responses", label: "Responses API (/responses)" },
];

export function PlaygroundPage() {
  const volc = useVolcCredentialStore();
  const gateway = useGatewayStore();
  const apiKeys = useApiKeyStore();
  const [connKey, setConnKey] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelId, setModelId] = useState<string>("");
  const [keyIdx, setKeyIdx] = useState<string>("0");
  const [wireFormat, setWireFormat] = useState<WireFormat>("openai-chat");
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [streaming, setStreaming] = useState(true);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loaded = volc.loaded && gateway.loaded && apiKeys.loaded;

  useEffect(() => {
    if (!volc.loaded) volc.load();
    if (!gateway.loaded) gateway.load();
    if (!apiKeys.loaded) apiKeys.load();
  }, [volc, gateway, apiKeys]);

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
    if (!options.some((o) => o.key === connKey)) {
      setConnKey(options[0]?.key ?? null);
    }
  }, [options, connKey]);

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
  const selectedModel = models.find((m) => m.id === modelId) ?? null;

  /** Models configured on a manual API key, mapped to ModelInfo. */
  const manualModels = useMemo<ModelInfo[]>(
    () =>
      (keyConn?.models ?? []).map((id) => ({
        id,
        name: id,
        provider: "manual",
      })),
    [keyConn]
  );

  /** Last persisted models for the selected connection, reused across restarts. */
  const storedModels = useMemo<ModelInfo[]>(() => {
    if (volcCred) return volcCred.models ?? [];
    if (gwConn) return gwConn.models ?? [];
    if (keyConn) return manualModels;
    return [];
  }, [volcCred, gwConn, keyConn, manualModels]);

  useEffect(() => {
    if (isVolc) setWireFormat("openai-chat");
    setModels(storedModels);
    setModelId((prev) =>
      storedModels.some((m) => m.id === prev)
        ? prev
        : storedModels[0]?.id ?? ""
    );
  }, [connKey, isVolc, storedModels]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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
      } else {
        return;
      }
      setModels(list);
      if (list.length > 0) setModelId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setModelsLoading(false);
    }
  };

  const pickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const buildApiMessages = (history: UiMessage[]): ChatMessage[] => {
    const msgs: ChatMessage[] = [];
    if (system.trim()) msgs.push({ role: "system", content: system.trim() });
    for (const m of history) {
      if (m.role === "user" && m.image) {
        const parts: ContentPart[] = [];
        if (m.content) parts.push({ type: "text", text: m.content });
        parts.push({ type: "image", url: m.image });
        msgs.push({ role: "user", content: parts });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }
    return msgs;
  };

  const send = async () => {
    if (sending) return;
    if (!volcCred && !gwConn && !keyConn) return setError("请先选择连接");
    if (!modelId) return setError("请先拉取并选择模型");
    if (!provider) return setError("无法识别 provider");

    let cred: ProviderCredential;
    if (volcCred) {
      const key = usableKeys[Number(keyIdx)]?.key;
      if (!key) return setError("没有可用的 Ark API Key，请先在模型接入页拉取");
      cred = { apiKey: key, region: volcCred.region };
    } else if (gwConn) {
      cred = { baseUrl: gwConn.baseUrl, apiKey: gwConn.apiKey };
    } else if (keyConn) {
      if (!keyConn.baseUrl)
        return setError("该 Key 未配置 Base URL，无法在 Playground 中调用");
      cred = { baseUrl: keyConn.baseUrl, apiKey: keyConn.key };
    } else {
      return;
    }
    if (!input.trim() && !image) return;

    setError(null);
    const userMsg: UiMessage = {
      role: "user",
      content: input.trim(),
      image: image ?? undefined,
    };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setImage(null);
    setSending(true);

    const adapter = getAdapter(provider)!;
    const controller = new AbortController();
    abortRef.current = controller;
    const req = {
      model: modelId,
      messages: buildApiMessages(history),
      params: {
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
      },
      wireFormat: isVolc ? wireFormat : "openai-chat",
      signal: controller.signal,
    };

    const setAssistant = (text: string) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: text };
        return next;
      });

    try {
      if (streaming && adapter.chatStream) {
        let acc = "";
        for await (const chunk of adapter.chatStream(req, cred)) {
          acc += chunk.delta;
          setAssistant(acc);
        }
      } else {
        const res = await adapter.chat(req, cred);
        setAssistant(res.content);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "请求失败";
      setError(msg);
      setMessages((prev) => {
        const next = [...prev];
        if (next[next.length - 1]?.content === "") next.pop();
        return next;
      });
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const currentConn = options.find((o) => o.key === connKey) ?? null;
  const lastMsg = messages[messages.length - 1];
  const awaitingFirstToken =
    sending && lastMsg?.role === "assistant" && lastMsg.content === "";

  if (loaded && options.length === 0) {
    return (
      <div>
        <PageHeader title="Playground" description="选择模型进行对话测试。" />
        <EmptyState
          icon={Bot}
          title="还没有可用的连接"
          description="请先在「模型接入」页添加凭证（火山引擎）、网关连接（New API / LiteLLM）或自定义 API Key。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      <PageHeader title="Playground" description="选择已开通的模型进行对话测试。" />

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* Config rail */}
        <Card className="flex flex-col gap-5 overflow-y-auto bg-card-elevated p-5">
          <RailSection title="连接">
            <div className="grid gap-1.5">
              <Label>连接</Label>
              <Select value={connKey ?? ""} onValueChange={setConnKey}>
                <SelectTrigger>
                  <SelectValue placeholder="选择连接" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.name}
                      <span className="ml-1.5 text-muted-foreground">
                        · {providerLabel(o.provider)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>模型</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={fetchModels}
                  disabled={modelsLoading || (!volcCred && !gwConn && !keyConn)}
                >
                  {modelsLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  拉取
                </Button>
              </div>
              <Select
                value={modelId}
                onValueChange={setModelId}
                disabled={models.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="先拉取模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel && <ModelFeatureBadges model={selectedModel} />}
            </div>

            {isVolc && (
              <div className="grid gap-1.5">
                <Label>Ark API Key</Label>
                <Select value={keyIdx} onValueChange={setKeyIdx}>
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
            )}

            {isVolc && (
              <div className="grid gap-1.5">
                <Label>请求格式</Label>
                <Select
                  value={wireFormat}
                  onValueChange={(v) => setWireFormat(v as WireFormat)}
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
            )}
          </RailSection>

          <Separator />

          <RailSection title="参数">
            <div className="grid gap-1.5">
              <Label htmlFor="pg-system">System Prompt</Label>
              <Textarea
                id="pg-system"
                className="min-h-[64px]"
                placeholder="可选，设定助手的角色与风格"
                value={system}
                onChange={(e) => setSystem(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pg-temp">Temperature</Label>
                <Input
                  id="pg-temp"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pg-max">Max Tokens</Label>
                <Input
                  id="pg-max"
                  type="number"
                  min="1"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-sm bg-secondary/60 px-3 py-2">
              <Label htmlFor="pg-stream" className="cursor-pointer">
                流式输出
              </Label>
              <Switch
                id="pg-stream"
                checked={streaming}
                onCheckedChange={setStreaming}
              />
            </div>
          </RailSection>
        </Card>

        {/* Conversation */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-label-13 font-medium">
                  {selectedModel?.name ?? "未选择模型"}
                </div>
                <div className="truncate text-label-12 text-muted-foreground">
                  {currentConn
                    ? `${currentConn.name} · ${providerLabel(currentConn.provider)}`
                    : "未选择连接"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <span className="hidden text-label-12 text-muted-foreground sm:inline">
                  {messages.length} 条消息
                </span>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setMessages([])}
                disabled={messages.length === 0}
                title="清空对话"
              >
                <Eraser className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!isLiveRequestSupported() && (
            <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2 text-label-12 text-warning-foreground/90">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
              浏览器模式下请求会因跨域被拦截，请在桌面应用中测试。
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="text-label-13 text-muted-foreground">
                  发送一条消息开始对话
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <ChatBubble
                    key={i}
                    message={m}
                    typing={awaitingFirstToken && i === messages.length - 1}
                    streaming={
                      sending &&
                      i === messages.length - 1 &&
                      m.role === "assistant" &&
                      m.content !== ""
                    }
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

          {image && (
            <div className="mx-5 mb-2 flex items-center gap-2">
              <img
                src={image}
                alt="附件"
                className="h-12 w-12 rounded-sm object-cover ring-1 ring-border"
              />
              <Button size="sm" variant="ghost" onClick={() => setImage(null)}>
                <X className="h-3.5 w-3.5" />
                移除图片
              </Button>
            </div>
          )}

          <div className="flex items-end gap-2 border-t border-border bg-background-secondary/60 p-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={pickImage}
            />
            <Button
              size="icon"
              variant="secondary"
              disabled={!selectedModel}
              title={
                !selectedModel
                  ? "请先拉取并选择模型"
                  : selectedModel.supportsVision
                    ? "添加图片"
                    : "该模型未标记支持图片，仍可尝试发送"
              }
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Textarea
              className="min-h-[44px] flex-1 resize-none"
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
                disabled={!selectedModel || (!input.trim() && !image)}
                title="发送"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function RailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4">
      <div className="text-label-12 font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function ChatBubble({
  message,
  typing,
  streaming,
}: {
  message: UiMessage;
  typing?: boolean;
  streaming?: boolean;
}) {
  const reduce = useReducedMotion();
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          isUser
            ? "bg-accent text-accent-foreground"
            : "bg-secondary text-muted-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-md px-3.5 py-2.5 text-copy-14 shadow-geist-sm",
          isUser
            ? "rounded-tr-sm bg-accent text-accent-foreground"
            : "rounded-tl-sm bg-secondary text-foreground"
        )}
      >
        {message.image && (
          <img
            src={message.image}
            alt="附件"
            className="mb-2 max-h-48 rounded-sm object-contain"
          />
        )}
        {typing ? (
          <TypingDots />
        ) : (
          <span className="whitespace-pre-wrap break-words">
            {message.content}
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] animate-pulse bg-current align-middle" />
            )}
          </span>
        )}
      </div>
    </motion.div>
  );
}
