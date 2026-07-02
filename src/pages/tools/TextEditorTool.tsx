import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  FolderOpen,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  findTextMatches,
  getTextStats,
  openLocalTextFile,
} from "@/lib/textEditorTool";

export function TextEditorTool() {
  const { t } = useTranslation("pages");
  const tc = useTranslation("common").t;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [activeMatch, setActiveMatch] = useState(-1);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);

  const matches = useMemo(() => findTextMatches(text, search), [text, search]);
  const stats = useMemo(() => getTextStats(text), [text]);

  useEffect(() => {
    if (matches.length === 0) {
      setActiveMatch(-1);
      return;
    }
    if (activeMatch < 0 || activeMatch >= matches.length) {
      setActiveMatch(0);
    }
  }, [matches.length, activeMatch]);

  const selectMatch = (index: number) => {
    const match = matches[index];
    if (!match) return;
    setActiveMatch(index);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(match.index, match.index + match.length);
    });
  };

  const goToPreviousMatch = () => {
    if (matches.length === 0) return;
    selectMatch((activeMatch - 1 + matches.length) % matches.length);
  };

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    selectMatch((activeMatch + 1) % matches.length);
  };

  const pastePlainText = async () => {
    try {
      const value = await navigator.clipboard?.readText();
      if (value) {
        setText(value);
        setFileName("");
        setError(null);
      }
    } catch {
      setError(t("tool_text_editor_clipboard_failed"));
    }
  };

  const copyText = async () => {
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const openFile = async () => {
    setOpening(true);
    setError(null);
    try {
      const file = await openLocalTextFile();
      if (!file) return;
      setText(file.content);
      setFileName(file.name);
      setSearch("");
      setActiveMatch(-1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("tool_text_editor_open_failed"));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={pastePlainText}>
          <Clipboard className="h-3.5 w-3.5" />
          {t("tool_text_editor_paste_plain")}
        </Button>
        <Button variant="secondary" size="sm" onClick={openFile} disabled={opening}>
          <FolderOpen className="h-3.5 w-3.5" />
          {opening ? t("tool_text_editor_opening") : t("tool_text_editor_open_file")}
        </Button>

        <div className="flex min-w-[260px] flex-1 items-center gap-2 lg:max-w-[560px]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tool_text_editor_search_placeholder")}
              aria-label={t("tool_text_editor_search")}
              className="pl-8"
            />
          </div>
          <span className="min-w-[72px] text-center text-label-13 text-muted-foreground">
            {matches.length > 0
              ? `${activeMatch + 1}/${matches.length}`
              : t("tool_text_editor_no_matches")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPreviousMatch}
            disabled={matches.length === 0}
            title={t("tool_text_editor_previous_match")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextMatch}
            disabled={matches.length === 0}
            title={t("tool_text_editor_next_match")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={copyText} disabled={!text}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? tc("copied") : tc("copy")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText("");
            setFileName("");
            setError(null);
          }}
          disabled={!text}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {tc("clear")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <Label>{fileName || t("tool_text_editor_buffer")}</Label>
          <span className="text-label-13 text-muted-foreground">
            {t("tool_text_editor_stats", {
              characters: stats.characters,
              lines: stats.lines,
            })}
          </span>
        </div>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("tool_text_editor_placeholder")}
          spellCheck={false}
          className="min-h-[420px] flex-1 resize-y font-mono text-copy-13 leading-relaxed lg:min-h-0"
        />
        {error && <p className="text-label-13 text-destructive">{error}</p>}
      </div>
    </div>
  );
}
