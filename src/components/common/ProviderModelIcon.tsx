import type { ComponentType, ReactNode } from "react";
import { Boxes, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/lib/providers/types";

type IconKey =
  | "anthropic"
  | "deepseek"
  | "dmxapi"
  | "doubao"
  | "gemini"
  | "generic"
  | "groq"
  | "grok"
  | "kimi"
  | "litellm"
  | "llama"
  | "manual"
  | "mistral"
  | "new-api"
  | "ollama"
  | "openai"
  | "qwen"
  | "volcengine";

interface IconProps {
  className?: string;
  title?: string;
}

function normalize(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[\s_./:]+/g, "-");
}

function providerIconKey(provider?: string | null): IconKey {
  const value = normalize(provider);
  if (value.includes("volc") || value.includes("doubao") || value.includes("ark")) {
    return "volcengine";
  }
  if (value.includes("new-api") || value === "newapi") return "new-api";
  if (value.includes("litellm")) return "litellm";
  if (value.includes("dmx")) return "dmxapi";
  if (value.includes("openai")) return "openai";
  if (value.includes("anthropic") || value.includes("claude")) return "anthropic";
  if (value.includes("google") || value.includes("gemini")) return "gemini";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("mistral")) return "mistral";
  if (value.includes("groq")) return "groq";
  if (value.includes("ollama")) return "ollama";
  if (value.includes("custom") || value.includes("manual")) return "manual";
  return "generic";
}

function modelIconKey(model?: ModelInfo | string | null): IconKey {
  const raw =
    typeof model === "string"
      ? model
      : `${model?.provider ?? ""} ${model?.id ?? ""} ${model?.name ?? ""}`;
  const value = normalize(raw);
  if (value.includes("gpt") || value.includes("openai") || value.includes("o1") || value.includes("o3") || value.includes("o4")) {
    return "openai";
  }
  if (value.includes("claude") || value.includes("anthropic")) return "anthropic";
  if (value.includes("gemini") || value.includes("google")) return "gemini";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("qwen") || value.includes("qwq") || value.includes("tongyi")) {
    return "qwen";
  }
  if (
    value.includes("doubao") ||
    value.includes("seedream") ||
    value.includes("seedance") ||
    value.includes("volc")
  ) {
    return "doubao";
  }
  if (value.includes("moonshot") || value.includes("kimi")) return "kimi";
  if (value.includes("mistral") || value.includes("mixtral") || value.includes("codestral")) {
    return "mistral";
  }
  if (value.includes("llama") || value.includes("meta")) return "llama";
  if (value.includes("grok") || value.includes("xai")) return "grok";
  if (value.includes("groq")) return "groq";
  if (value.includes("ollama")) return "ollama";
  return providerIconKey(typeof model === "string" ? undefined : model?.provider);
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider?: string | null;
  className?: string;
}) {
  return <IconByKey iconKey={providerIconKey(provider)} className={className} />;
}

export function ModelIcon({
  model,
  className,
}: {
  model?: ModelInfo | string | null;
  className?: string;
}) {
  return <IconByKey iconKey={modelIconKey(model)} className={className} />;
}

export function ProviderIconLabel({
  provider,
  children,
  className,
}: {
  provider?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <ProviderIcon provider={provider} className="h-4 w-4 shrink-0" />
      {children}
    </span>
  );
}

export function ModelIconLabel({
  model,
  children,
  className,
}: {
  model?: ModelInfo | string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <ModelIcon model={model} className="h-4 w-4 shrink-0" />
      {children}
    </span>
  );
}

function IconByKey({ iconKey, className }: { iconKey: IconKey; className?: string }) {
  const Icon = ICONS[iconKey] ?? GenericIcon;
  return <Icon className={cn("h-4 w-4 shrink-0", className)} />;
}

function SvgShell({
  className,
  children,
  title,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

function TextIcon({
  className,
  letters,
  bg,
  fg = "white",
}: IconProps & { letters: string; bg: string; fg?: string }) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill={bg} />
      <text
        x="12"
        y="15.3"
        fill={fg}
        fontFamily="Geist Mono, ui-monospace, monospace"
        fontSize={letters.length > 1 ? "7.5" : "10"}
        fontWeight="700"
        textAnchor="middle"
      >
        {letters}
      </text>
    </SvgShell>
  );
}

function OpenAIIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#111827" />
      <g stroke="#fff" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5.2c2.7 0 4.9 2 5.1 4.6" />
        <path d="M17.1 9.8c2.1 1.4 2.6 4.3 1.2 6.4" />
        <path d="M18.2 16.2c-1.3 2.2-4.1 3-6.3 1.9" />
        <path d="M11.9 18.1c-2.6.1-4.8-1.8-5.2-4.3" />
        <path d="M6.7 13.8C4.6 12.3 4.2 9.4 5.7 7.3" />
        <path d="M5.8 7.3c1.4-2.1 4.2-2.8 6.4-1.6" />
        <path d="M8.4 8.6 12 6.6l3.6 2.1v4.2L12 15l-3.6-2.1V8.6Z" />
      </g>
    </SvgShell>
  );
}

function AnthropicIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="A" bg="#d8cec1" fg="#1f1d1a" />;
}

function GeminiIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#e8f0fe" />
      <path d="M12 3.8c.8 4.2 3 6.4 7.2 7.2-4.2.8-6.4 3-7.2 7.2-.8-4.2-3-6.4-7.2-7.2 4.2-.8 6.4-3 7.2-7.2Z" fill="#4285f4" />
      <path d="M17.8 14.8c.4 1.9 1.4 2.9 3.4 3.4-2 .4-3 1.4-3.4 3.4-.4-2-1.4-3-3.4-3.4 2-.5 3-1.5 3.4-3.4Z" fill="#a142f4" />
    </SvgShell>
  );
}

function VolcengineIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#eef2ff" />
      <path d="M4.5 15.6 9.8 5.2h4.4l5.3 10.4-2.2 3.2H6.7l-2.2-3.2Z" fill="#2563eb" />
      <path d="M9.1 14.7 12 8.8l2.9 5.9H9.1Z" fill="#fff" />
    </SvgShell>
  );
}

function LiteLLMIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#effdf3" />
      <path d="M5 16.4V5.2h3.2v8.4h5.1v2.8H5Z" fill="#16a34a" />
      <path d="M12.2 18.8 16 5.2h3l-2.2 7h2.9l-5.6 6.6 1.4-4.2h-3.3Z" fill="#22c55e" />
      <circle cx="18.8" cy="17.6" r="1.4" fill="#14532d" />
    </SvgShell>
  );
}

function DmxIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#eaf4ff" />
      <path d="M4.6 6.2h5.2c3.5 0 5.9 2.3 5.9 5.8s-2.4 5.8-5.9 5.8H4.6V6.2Zm5 8.7c1.7 0 2.8-1.1 2.8-2.9 0-1.8-1.1-2.9-2.8-2.9H7.9v5.8h1.7Z" fill="#1677ff" />
      <path d="M15.4 17.8 18 14l-2.5-3.8h2.9l1.2 2 1.2-2h2.6L21 13.9l2.5 3.9h-2.9l-1.3-2.1-1.4 2.1h-2.5Z" fill="#00a6ff" />
    </SvgShell>
  );
}

function NewApiIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="API" bg="#0f766e" />;
}

function DeepSeekIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="DS" bg="#1d4ed8" />;
}

function QwenIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="Q" bg="#6d28d9" />;
}

function DoubaoIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="DB" bg="#dc2626" />;
}

function KimiIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="K" bg="#111827" />;
}

function MistralIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#fff7ed" />
      <path d="M5 6h3v12H5V6Zm5 0h3v12h-3V6Zm5 0h4v3h-2v3h2v6h-4V6Z" fill="#f97316" />
      <path d="M8 9h2v3H8V9Zm5 3h2v3h-2v-3Z" fill="#111827" />
    </SvgShell>
  );
}

function LlamaIcon({ className }: IconProps) {
  return (
    <SvgShell className={className}>
      <rect width="24" height="24" rx="6" fill="#eff6ff" />
      <path d="M5.3 12c2.2-4.2 5.1-4.3 7.1 0 2-4.3 4.9-4.2 7.1 0-2.2 4.2-5.1 4.3-7.1 0-2 4.3-4.9 4.2-7.1 0Z" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </SvgShell>
  );
}

function GrokIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="x" bg="#111111" />;
}

function GroqIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="GQ" bg="#f97316" />;
}

function OllamaIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="OL" bg="#262626" />;
}

function ManualIcon({ className }: IconProps) {
  return <KeyRound className={cn("text-muted-foreground", className)} />;
}

function GenericIcon({ className }: IconProps) {
  return <Boxes className={cn("text-muted-foreground", className)} />;
}

const ICONS: Record<IconKey, ComponentType<IconProps>> = {
  anthropic: AnthropicIcon,
  deepseek: DeepSeekIcon,
  dmxapi: DmxIcon,
  doubao: DoubaoIcon,
  gemini: GeminiIcon,
  generic: GenericIcon,
  groq: GroqIcon,
  grok: GrokIcon,
  kimi: KimiIcon,
  litellm: LiteLLMIcon,
  llama: LlamaIcon,
  manual: ManualIcon,
  mistral: MistralIcon,
  "new-api": NewApiIcon,
  ollama: OllamaIcon,
  openai: OpenAIIcon,
  qwen: QwenIcon,
  volcengine: VolcengineIcon,
};
