import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Eraser,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  User,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
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
import { useVolcCredentialStore } from "@/store";
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

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

const WIRE_FORMATS: { value: WireFormat; label: string }[] = [
  { value: "openai-chat", label: "OpenAI Chat (/chat/completions)" },
  { value: "openai-responses", label: "Responses API (/responses)" },
];

export function PlaygroundPage() {
  const { items, loaded, load } = useVolcCredentialStore();
  const [credId, setCredId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useEffect(() => {
    if (!credId && items.length > 0) setCredId(items[0].id);
  }, [items, credId]);

  const credential = items.find((c) => c.id === credId) ?? null;
  const usableKeys = useMemo(
    () => (credential?.apiKeys ?? []).filter((k) => k.key),
    [credential]
  );
  const selectedModel = models.find((m) => m.id === modelId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const fetchModels = async () => {
    if (!credential) return;
    setError(null);
    setModelsLoading(true);
    try {
      const list = await listEndpoints({
        accessKey: credential.accessKey,
        secretKey: credential.secretKey,
        region: credential.region,
        project: credential.project,
      });
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
    if (!credential) return setError("请先选择凭证");
    if (!modelId) return setError("请先拉取并选择模型");
    const key = usableKeys[Number(keyIdx)]?.key;
    if (!key) return setError("没有可用的 Ark API Key，请先在 Providers 页拉取");
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

    const adapter = getAdapter("volcengine")!;
    const cred: ProviderCredential = { apiKey: key, region: credential.region };
    const controller = new AbortController();
    abortRef.current = controller;
    const req = {
      model: modelId,
      messages: buildApiMessages(history),
      params: {
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
      },
      wireFormat,
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

  if (loaded && items.length === 0) {
    return (
      <div>
        <PageHeader title="Playground" description="选择模型进行对话测试。" />
        <EmptyState
          icon={Bot}
          title="还没有可用的凭证"
          description="请先在 Volcengine 页添加 AK/SK 并拉取 API Key。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader title="Playground" description="选择已开通的模型进行对话测试。" />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* Config panel */}
        <Card className="flex flex-col gap-4 overflow-y-auto p-4">
          <div className="grid gap-1.5">
            <Label>凭证</Label>
            <Select value={credId ?? ""} onValueChange={setCredId}>
              <SelectTrigger>
                <SelectValue placeholder="选择凭证" />
              </SelectTrigger>
              <SelectContent>
                {items.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
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
                disabled={modelsLoading || !credential}
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

          <div className="flex items-center justify-between">
            <Label htmlFor="pg-stream">流式输出</Label>
            <Switch
              id="pg-stream"
              checked={streaming}
              onCheckedChange={setStreaming}
            />
          </div>
        </Card>

        {/* Chat panel */}
        <Card className="flex min-h-0 flex-col">
          {!isLiveRequestSupported() && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-label-12 text-amber-900">
              浏览器模式下请求会因跨域被拦截，请在桌面应用中测试。
            </div>
          )}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-label-13 text-muted-foreground">
                发送一条消息开始对话
              </div>
            ) : (
              messages.map((m, i) => <ChatBubble key={i} message={m} />)
            )}
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-label-13 text-destructive">
              {error}
            </div>
          )}

          {image && (
            <div className="mx-5 mb-2 flex items-center gap-2">
              <img
                src={image}
                alt="附件"
                className="h-12 w-12 rounded-sm object-cover"
              />
              <Button size="sm" variant="ghost" onClick={() => setImage(null)}>
                <X className="h-3.5 w-3.5" />
                移除图片
              </Button>
            </div>
          )}

          <div className="flex items-end gap-2 border-t border-border p-3">
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
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setMessages([])}
              title="清空对话"
            >
              <Eraser className="h-4 w-4" />
            </Button>
            {sending ? (
              <Button size="icon" variant="secondary" onClick={stop} title="停止">
                <X className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="icon" onClick={send} title="发送">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-md px-3.5 py-2.5 text-copy-14",
          isUser ? "bg-accent text-accent-foreground" : "bg-secondary"
        )}
      >
        {message.image && (
          <img
            src={message.image}
            alt="附件"
            className="mb-2 max-h-48 rounded-sm object-contain"
          />
        )}
        <span className="whitespace-pre-wrap break-words">
          {message.content || (isUser ? "" : "…")}
        </span>
      </div>
    </div>
  );
}
