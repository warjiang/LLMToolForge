import type { ComponentType, CSSProperties, ReactNode } from "react";
import AlibabaIconColor from "@lobehub/icons/es/Alibaba/components/Color";
import AnthropicIconMono from "@lobehub/icons/es/Anthropic/components/Mono";
import BaichuanIconColor from "@lobehub/icons/es/Baichuan/components/Color";
import ChatGLMIconColor from "@lobehub/icons/es/ChatGLM/components/Color";
import ClaudeIconColor from "@lobehub/icons/es/Claude/components/Color";
import DeepSeekIconColor from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoIconColor from "@lobehub/icons/es/Doubao/components/Color";
import GeminiIconColor from "@lobehub/icons/es/Gemini/components/Color";
import GrokIconMono from "@lobehub/icons/es/Grok/components/Mono";
import GroqIconMono from "@lobehub/icons/es/Groq/components/Mono";
import HunyuanIconColor from "@lobehub/icons/es/Hunyuan/components/Color";
import KlingIconColor from "@lobehub/icons/es/Kling/components/Color";
import LongCatIconColor from "@lobehub/icons/es/LongCat/components/Color";
import MetaIconColor from "@lobehub/icons/es/Meta/components/Color";
import MinimaxIconColor from "@lobehub/icons/es/Minimax/components/Color";
import MistralIconColor from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIconMono from "@lobehub/icons/es/Moonshot/components/Mono";
import NewApiIconColor from "@lobehub/icons/es/NewAPI/components/Color";
import OllamaIconMono from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAIIconMono from "@lobehub/icons/es/OpenAI/components/Mono";
import PerplexityIconColor from "@lobehub/icons/es/Perplexity/components/Color";
import QwenIconColor from "@lobehub/icons/es/Qwen/components/Color";
import SparkIconColor from "@lobehub/icons/es/Spark/components/Color";
import StepfunIconColor from "@lobehub/icons/es/Stepfun/components/Color";
import VolcengineIconColor from "@lobehub/icons/es/Volcengine/components/Color";
import WenxinIconColor from "@lobehub/icons/es/Wenxin/components/Color";
import XiaomiMiMoIconMono from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import { Boxes, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/lib/providers/types";

type IconKey =
  | "alibaba"
  | "anthropic"
  | "baichuan"
  | "claude"
  | "deepseek"
  | "dmxapi"
  | "doubao"
  | "ernie"
  | "gemini"
  | "generic"
  | "glm"
  | "groq"
  | "grok"
  | "hunyuan"
  | "kimi"
  | "kling"
  | "litellm"
  | "llama"
  | "longcat"
  | "manual"
  | "mimo"
  | "minimax"
  | "mistral"
  | "new-api"
  | "ollama"
  | "openai"
  | "perplexity"
  | "qwen"
  | "spark"
  | "stepfun"
  | "volcengine";

interface IconProps {
  className?: string;
  title?: string;
}

function normalize(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[\s_./:]+/g, "-");
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function isErnie(value: string): boolean {
  return includesAny(value, ["ernie", "wenxin", "文心", "yiyan", "baidu", "百度"]);
}

function isStepfun(value: string): boolean {
  return (
    value === "step" ||
    includesAny(value, ["stepfun", "step-", "step1", "阶跃"])
  );
}

function isSpark(value: string): boolean {
  return (
    value === "spar" ||
    includesAny(value, [
      "spark",
      "spar-",
      "iflytek",
      "xfyun",
      "xunfei",
      "讯飞",
      "星火",
    ])
  );
}

function isKling(value: string): boolean {
  return includesAny(value, ["kling", "klingai", "kuaishou", "kwai", "快手", "可灵"]);
}

function isPerplexity(value: string): boolean {
  return includesAny(value, ["perplexity", "pplx", "sonar"]);
}

function isAlibaba(value: string): boolean {
  return includesAny(value, ["happyhorse", "alibaba", "aliyun", "dashscope", "阿里"]);
}

function isHunyuan(value: string): boolean {
  return includesAny(value, ["hunyuan", "混元", "tencent-hunyuan", "腾讯混元"]);
}

function isBaichuan(value: string): boolean {
  return includesAny(value, ["baichuan", "百川"]);
}

function providerIconKey(provider?: string | null): IconKey {
  const value = normalize(provider);
  if (isPerplexity(value)) return "perplexity";
  if (isAlibaba(value)) return "alibaba";
  if (isHunyuan(value)) return "hunyuan";
  if (isBaichuan(value)) return "baichuan";
  if (isSpark(value)) return "spark";
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
  if (
    value.includes("zhipu") ||
    value.includes("chatglm") ||
    value.includes("glm") ||
    value.includes("z-ai") ||
    value === "zai"
  ) {
    return "glm";
  }
  if (value.includes("mistral")) return "mistral";
  if (value.includes("longcat")) return "longcat";
  if (value.includes("xiaomi-mimo") || value.includes("mimo")) return "mimo";
  if (value.includes("minimax") || value.includes("abab")) return "minimax";
  if (value.includes("moonshot") || value.includes("kimi")) return "kimi";
  if (isErnie(value)) return "ernie";
  if (isStepfun(value)) return "stepfun";
  if (isKling(value)) return "kling";
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
  if (isPerplexity(value)) return "perplexity";
  if (isHunyuan(value)) return "hunyuan";
  if (isBaichuan(value)) return "baichuan";
  if (
    value.includes("chatglm") ||
    value.includes("zhipu") ||
    value.includes("glm-") ||
    value.includes("glm4") ||
    value.includes("glm5") ||
    value.includes("z-ai") ||
    value.includes("zai")
  ) {
    return "glm";
  }
  if (value.includes("qwen") || value.includes("qwq") || value.includes("tongyi")) {
    return "qwen";
  }
  if (isAlibaba(value)) return "alibaba";
  if (
    value.includes("doubao") ||
    value.includes("seedream") ||
    value.includes("seedance") ||
    value.includes("volc")
  ) {
    return "doubao";
  }
  if (
    value.includes("moonshot") ||
    value.includes("kimi") ||
    value.includes("k2-instruct") ||
    value.includes("kimi-k2")
  ) {
    return "kimi";
  }
  if (value.includes("mistral") || value.includes("mixtral") || value.includes("codestral")) {
    return "mistral";
  }
  if (value.includes("longcat")) return "longcat";
  if (
    value.includes("xiaomi-mimo") ||
    value.includes("mimo-") ||
    value.includes("/mimo") ||
    value.includes("-mimo")
  ) {
    return "mimo";
  }
  if (value.includes("minimax") || value.includes("abab") || value.includes("hailuo")) {
    return "minimax";
  }
  if (isErnie(value)) return "ernie";
  if (isStepfun(value)) return "stepfun";
  if (isSpark(value)) return "spark";
  if (isKling(value)) return "kling";
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

function GlmIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="GLM" bg="#3859ff" />;
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
  return <TextIcon className={className} letters="MS" bg="#111827" />;
}

function MinimaxIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="MM" bg="#2563eb" />;
}

function AlibabaIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="AL" bg="#ff6a00" />;
}

function PerplexityIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="PX" bg="#0f766e" />;
}

function HunyuanIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="HY" bg="#2563eb" />;
}

function BaichuanIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="BC" bg="#111827" />;
}

function ErnieIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="EN" bg="#2563eb" />;
}

function StepfunIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="ST" bg="#111827" />;
}

function SparkIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="SP" bg="#6d28d9" />;
}

function KlingIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="KL" bg="#111827" />;
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

function LongCatIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="LC" bg="#f97316" />;
}

function MimoIcon({ className }: IconProps) {
  return <TextIcon className={className} letters="MI" bg="#111111" />;
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
  alibaba: AlibabaIconColor,
  anthropic: AnthropicIconMono,
  baichuan: BaichuanIconColor,
  claude: ClaudeIconColor,
  deepseek: DeepSeekIconColor,
  doubao: DoubaoIconColor,
  ernie: WenxinIconColor,
  gemini: GeminiIconColor,
  glm: ChatGLMIconColor,
  groq: GroqIconMono,
  grok: GrokIconMono,
  hunyuan: HunyuanIconColor,
  kimi: MoonshotIconMono,
  kling: KlingIconColor,
  llama: MetaIconColor,
  longcat: LongCatIconColor,
  mimo: XiaomiMiMoIconMono,
  minimax: MinimaxIconColor,
  mistral: MistralIconColor,
  "new-api": NewApiIconColor,
  ollama: OllamaIconMono,
  openai: OpenAIIconMono,
  perplexity: PerplexityIconColor,
  qwen: QwenIconColor,
  spark: SparkIconColor,
  stepfun: StepfunIconColor,
  volcengine: VolcengineIconColor,
};

const LOCAL_ICONS: Record<IconKey, ComponentType<IconProps>> = {
  alibaba: AlibabaIcon,
  anthropic: AnthropicIcon,
  baichuan: BaichuanIcon,
  claude: AnthropicIcon,
  deepseek: DeepSeekIcon,
  dmxapi: DmxIcon,
  doubao: DoubaoIcon,
  ernie: ErnieIcon,
  gemini: GeminiIcon,
  generic: GenericIcon,
  glm: GlmIcon,
  groq: GroqIcon,
  grok: GrokIcon,
  hunyuan: HunyuanIcon,
  kimi: KimiIcon,
  kling: KlingIcon,
  litellm: LiteLLMIcon,
  llama: LlamaIcon,
  longcat: LongCatIcon,
  manual: ManualIcon,
  mimo: MimoIcon,
  minimax: MinimaxIcon,
  mistral: MistralIcon,
  "new-api": NewApiIcon,
  ollama: OllamaIcon,
  openai: OpenAIIcon,
  perplexity: PerplexityIcon,
  qwen: QwenIcon,
  spark: SparkIcon,
  stepfun: StepfunIcon,
  volcengine: VolcengineIcon,
};
