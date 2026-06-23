import type { ComponentType, CSSProperties, ReactNode } from "react";
import AnthropicIconMono from "@lobehub/icons/es/Anthropic/components/Mono";
import ClaudeIconColor from "@lobehub/icons/es/Claude/components/Color";
import DeepSeekIconColor from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoIconColor from "@lobehub/icons/es/Doubao/components/Color";
import GeminiIconColor from "@lobehub/icons/es/Gemini/components/Color";
import GrokIconMono from "@lobehub/icons/es/Grok/components/Mono";
import GroqIconMono from "@lobehub/icons/es/Groq/components/Mono";
import KimiIconColor from "@lobehub/icons/es/Kimi/components/Color";
import MetaIconColor from "@lobehub/icons/es/Meta/components/Color";
import MistralIconColor from "@lobehub/icons/es/Mistral/components/Color";
import NewApiIconColor from "@lobehub/icons/es/NewAPI/components/Color";
import OllamaIconMono from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAIIconMono from "@lobehub/icons/es/OpenAI/components/Mono";
import QwenIconColor from "@lobehub/icons/es/Qwen/components/Color";
import VolcengineIconColor from "@lobehub/icons/es/Volcengine/components/Color";
import { Boxes, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/lib/providers/types";

type IconKey =
  | "anthropic"
  | "claude"
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
  if (value.includes("claude")) return "claude";
  if (value.includes("anthropic")) return "anthropic";
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
  title,
}: {
  provider?: string | null;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} title={title}>
      <ProviderIcon provider={provider} className="h-4 w-4 shrink-0" />
      {children}
    </span>
  );
}

export function ModelIconLabel({
  model,
  children,
  className,
  title,
}: {
  model?: ModelInfo | string | null;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} title={title}>
      <ModelIcon model={model} className="h-4 w-4 shrink-0" />
      {children}
    </span>
  );
}

function IconByKey({ iconKey, className }: { iconKey: IconKey; className?: string }) {
  const LobeIcon = LOBE_ICONS[iconKey];
  if (LobeIcon) {
    return <LobeIconRenderer Icon={LobeIcon} className={className} />;
  }

  const Icon = LOCAL_ICONS[iconKey] ?? GenericIcon;
  return <Icon className={cn("h-4 w-4 shrink-0", className)} />;
}

type LobeIconComponent = ComponentType<{
  className?: string;
  color?: string;
  size?: number | string;
  style?: CSSProperties;
}>;

function LobeIconRenderer({
  Icon,
  className,
}: {
  Icon: LobeIconComponent;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden",
        className
      )}
    >
      <Icon className="h-full w-full" size="100%" />
    </span>
  );
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
    <span
      aria-label="LiteLLM"
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center text-[14px] leading-none",
        className
      )}
      role="img"
    >
      🚅
    </span>
  );
}

function DmxIcon({ className }: IconProps) {
  return (
    <span
      aria-label="DMX"
      className={cn("inline-flex h-4 shrink-0 items-center overflow-hidden", className)}
      role="img"
      style={{ width: 48 }}
    >
      <img
        alt=""
        aria-hidden="true"
        className="block h-[9px] w-[48px] object-contain dark:hidden"
        src="/icons/dmx-logo-dark.png"
      />
      <img
        alt=""
        aria-hidden="true"
        className="hidden h-[9px] w-[48px] object-contain dark:block"
        src="/icons/dmx-logo-white.png"
      />
    </span>
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

const LOBE_ICONS: Partial<Record<IconKey, LobeIconComponent>> = {
  anthropic: AnthropicIconMono,
  claude: ClaudeIconColor,
  deepseek: DeepSeekIconColor,
  doubao: DoubaoIconColor,
  gemini: GeminiIconColor,
  groq: GroqIconMono,
  grok: GrokIconMono,
  kimi: KimiIconColor,
  llama: MetaIconColor,
  mistral: MistralIconColor,
  "new-api": NewApiIconColor,
  ollama: OllamaIconMono,
  openai: OpenAIIconMono,
  qwen: QwenIconColor,
  volcengine: VolcengineIconColor,
};

const LOCAL_ICONS: Record<IconKey, ComponentType<IconProps>> = {
  anthropic: AnthropicIcon,
  claude: AnthropicIcon,
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
