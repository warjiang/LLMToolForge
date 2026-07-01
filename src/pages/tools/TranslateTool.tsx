import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  Clipboard,
  Copy,
  Languages,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAdapter } from "@/lib/providers";
import {
  buildTranslateMessages,
  buildTranslateModelOptions,
  TARGET_TRANSLATE_LANGUAGES,
  TRANSLATE_LANGUAGES,
  TRANSLATE_STYLES,
  type TargetTranslateLanguage,
  type TranslateLanguage,
  type TranslateStyle,
} from "@/lib/translateTool";
import {
  useApiKeyStore,
  useGatewayStore,
  useVolcCredentialStore,
} from "@/store";

export function TranslateTool() {
  const { t } = useTranslation("pages");
  const tc = useTranslation("common").t;
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [modelKey, setModelKey] = useState("");
  const [sourceLanguage, setSourceLanguage] =
    useState<TranslateLanguage>("auto");
  const [targetLanguage, setTargetLanguage] =
    useState<TargetTranslateLanguage>("zh");
  const [style, setStyle] = useState<TranslateStyle>("natural");

  const volc = useVolcCredentialStore();
  const gateways = useGatewayStore();
  const apiKeys = useApiKeyStore();

  useEffect(() => {
    void useVolcCredentialStore.getState().load();
    void useGatewayStore.getState().load();
    void useApiKeyStore.getState().load();
  }, []);

  const modelOptions = useMemo(
    () => buildTranslateModelOptions(volc.items, gateways.items, apiKeys.items),
    [volc.items, gateways.items, apiKeys.items]
  );

  useEffect(() => {
    if (modelOptions.length === 0) {
      setModelKey("");
      return;
    }
    if (!modelOptions.some((option) => option.key === modelKey)) {
      setModelKey(modelOptions[0].key);
    }
  }, [modelOptions, modelKey]);

  const selectedModel = modelOptions.find((option) => option.key === modelKey);
  const canTranslate = input.trim().length > 0 && !!selectedModel && !loading;

  const translate = async () => {
    const text = input.trim();
    if (!text) return;
    if (!selectedModel) {
      setError(t("tool_translate_no_model"));
      setOutput("");
      return;
    }

    const adapter = getAdapter(selectedModel.provider);
    if (!adapter) {
      setError(t("tool_translate_no_adapter", { provider: selectedModel.provider }));
      setOutput("");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await adapter.chat(
        {
          model: selectedModel.model.id,
          messages: buildTranslateMessages({
            input: text,
            sourceLanguage,
            targetLanguage,
            style,
          }),
          params: {
            temperature: 0.2,
          },
          wireFormat: selectedModel.wireFormat,
        },
        selectedModel.credential
      );
      const translated = res.content.trim();
      if (!translated) {
        setError(t("tool_translate_empty_result"));
        setOutput("");
        return;
      }
      setOutput(translated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("tool_translate_failed"));
      setOutput("");
    } finally {
      setLoading(false);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) setInput(text);
    } catch {
      /* clipboard read may be blocked */
    }
  };

  const copyOutput = async () => {
    if (!output) return;
    await navigator.clipboard?.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto lg:overflow-hidden">
      <div className="flex w-full shrink-0 flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label>{t("tool_translate_model")}</Label>
          <Select
            value={modelKey}
            onValueChange={setModelKey}
            disabled={modelOptions.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("tool_translate_model_placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TranslateSelect
          label={t("tool_translate_source")}
          value={sourceLanguage}
          onValueChange={(value) => setSourceLanguage(value as TranslateLanguage)}
          options={TRANSLATE_LANGUAGES}
        />
        <TranslateSelect
          label={t("tool_translate_target")}
          value={targetLanguage}
          onValueChange={(value) =>
            setTargetLanguage(value as TargetTranslateLanguage)
          }
          options={TARGET_TRANSLATE_LANGUAGES}
        />
        <TranslateSelect
          label={t("tool_translate_style")}
          value={style}
          onValueChange={(value) => setStyle(value as TranslateStyle)}
          options={TRANSLATE_STYLES}
        />

        <Button onClick={translate} disabled={!canTranslate}>
          <Languages className="h-3.5 w-3.5" />
          {loading ? t("tool_translate_running") : t("tool_translate_action")}
        </Button>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:flex-1 lg:grid-cols-2">
        <div className="flex min-h-[320px] flex-col gap-1.5 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between">
            <Label>{t("tool_translate_input")}</Label>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={paste} title={tc("paste")}>
                <Clipboard className="h-3.5 w-3.5" />
                {tc("paste")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInput("")}
                title={tc("clear")}
                disabled={!input}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tc("clear")}
              </Button>
            </div>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("tool_translate_placeholder")}
            spellCheck={false}
            className="min-h-[320px] flex-1 resize-y font-mono text-copy-13 leading-relaxed lg:min-h-0"
          />
        </div>

        <div className="flex min-h-[320px] flex-col gap-1.5 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between">
            <Label>{t("tool_translate_output")}</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => output && setInput(output)}
                title={tc("fill_back")}
                disabled={!output}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {tc("fill_back")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyOutput}
                disabled={!output}
                title={tc("copy")}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? tc("copied") : tc("copy")}
              </Button>
            </div>
          </div>
          <Textarea
            value={error ? "" : output}
            readOnly
            spellCheck={false}
            placeholder={tc("result_placeholder")}
            className="min-h-[320px] flex-1 resize-y bg-background-secondary text-copy-13 leading-relaxed lg:min-h-0"
          />
          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

interface TranslateSelectProps<T extends string> {
  label: string;
  value: T;
  onValueChange: (value: string) => void;
  options: { value: T; labelKey: string }[];
}

function TranslateSelect<T extends string>({
  label,
  value,
  onValueChange,
  options,
}: TranslateSelectProps<T>) {
  const { t } = useTranslation("pages");
  return (
    <div className="min-w-[132px] space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
