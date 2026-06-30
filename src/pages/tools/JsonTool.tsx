import { useMemo, useState, useRef, useEffect } from "react";
import {
  AlignLeft,
  Check,
  Clipboard,
  Copy,
  Minimize2,
  Trash2,
  Maximize2,
  Minimize,
  ArrowUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { jsonFormat, jsonMinify, parseJson } from "@/lib/tools";
import { useSidebarStore } from "@/store/sidebar";
import { JsonTree } from "./JsonTree";
import { ValuePreviewPanel } from "./ValuePreviewPanel";

const SAMPLE =
  '{"name":"demo","payload":"{\\"nested\\":\\"{\\\\\\"deep\\\\\\":true}\\",\\"count\\":3}","tags":"[\\"a\\",\\"b\\"]"}';

export function JsonTool() {
  const { t } = useTranslation("pages");
  const tc = useTranslation("common").t;
  const collapsed = useSidebarStore((s) => s.collapsed);
  const [input, setInput] = useState("");
  const [preserveEscape, setPreserveEscape] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedValue, setSelectedValue] = useState<unknown>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 侧边栏宽度
  const SIDEBAR_EXPANDED = 240;
  const SIDEBAR_COLLAPSED = 64;
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const parsed = useMemo(
    () => parseJson(input, { preserveEscape }),
    [input, preserveEscape]
  );

  const format = () => {
    const r = jsonFormat(input, { indent: 2, preserveEscape });
    if (r.ok && r.value) setInput(r.value);
  };

  const minify = () => {
    const r = jsonMinify(input, { preserveEscape });
    if (r.ok && r.value) setInput(r.value);
  };

  const copy = async () => {
    const r = jsonFormat(input, { indent: 2, preserveEscape });
    if (!r.ok || !r.value) return;
    await navigator.clipboard?.writeText(r.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) setInput(text);
    } catch {
      /* clipboard read may be blocked */
    }
  };

  // 处理拖动分隔符
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(280, startWidth - delta);
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // 监听 Esc 键，退出全屏
  useEffect(() => {
    if (!isFullscreen) return;

    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => document.removeEventListener("keydown", handleEscKey);
  }, [isFullscreen]);

  return (
    <div ref={containerRef} className={`flex flex-col bg-background h-full ${isFullscreen ? '' : ''}`} style={isFullscreen ? { position: 'fixed', top: '30px', left: `${sidebarWidth}px`, right: 0, bottom: 0, zIndex: 50 } : {}}>
      {isFullscreen && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
          <h2 className="text-sm font-semibold">JSON 预览</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullscreen(false)}
            title="退出全屏"
          >
            <Minimize className="h-4 w-4" />
          </Button>
        </div>
      )}
      
      {!isFullscreen && (
        <>
          {/* 输入区域 */}
          <div className="border-b border-border">
            {/* 输入区域标题栏 */}
            <div className="flex items-center justify-between px-4 py-2">
              <Label className="font-semibold">{t("tool_json_input")}</Label>
              <div className="flex items-center gap-2">
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
                <div className="h-4 w-px bg-border" />
                <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
                  {t("tool_fill_sample")}
                </Button>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <Switch
                    id="json-preserve"
                    checked={preserveEscape}
                    onCheckedChange={setPreserveEscape}
                  />
                  <Label htmlFor="json-preserve" className="cursor-pointer font-normal text-xs">
                    {t("tool_json_preserve_escape")}
                  </Label>
                </div>
              </div>
            </div>

            {/* 输入区域内容 */}
            <div className="border-t border-border px-4 py-3 space-y-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("tool_json_placeholder")}
                spellCheck={false}
                className="max-h-40 resize-y font-mono text-copy-13 leading-relaxed"
              />
              {/* 工具栏 */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={format}
                  title={t("tool_json_format")}
                  disabled={!parsed.ok || parsed.value === undefined}
                >
                  <AlignLeft className="h-3.5 w-3.5" />
                  {t("tool_json_format")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={minify}
                  title={t("tool_json_minify")}
                  disabled={!parsed.ok || parsed.value === undefined}
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  {t("tool_json_minify")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copy}
                  title={tc("copy")}
                  disabled={!parsed.ok || parsed.value === undefined}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* JSON 树形展示 + 详情预览 - 仅当有 input 时显示 */}
      {input.trim() && (
        <div className="flex flex-1 min-h-0 overflow-hidden flex-col">
          {/* JSON 树形区顶部工具栏 - 仅在非全屏时显示 */}
          {!isFullscreen && (
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
              <div className="text-xs font-medium text-muted-foreground">JSON 预览</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFullscreen(true)}
                title="全屏预览"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* 主展示区 */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* 左侧：JSON 树形展示 */}
            <div className="flex-1 min-h-0 overflow-auto rounded-none border-r border-border bg-background-secondary">
            {parsed.ok && parsed.value ? (
              <div className="font-mono text-sm p-4">
                <JsonTree value={parsed.value} defaultOpen={true} onSelectValue={setSelectedValue} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <div className="text-center max-w-sm space-y-4">
                  <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center">
                      <svg
                        className="w-8 h-8 text-muted-foreground/60"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">
                      {t("tool_json_input")}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      在上方粘贴或输入 JSON 数据，即可在此查看结构化树形展示
                    </p>
                  </div>
                  {!parsed.ok && parsed.error ? (
                    <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                      <p className="text-xs text-destructive">{parsed.error}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* 拖动分隔符 - 仅在有效 JSON 和选中值时显示 */}
          {parsed.ok && parsed.value && selectedValue && (
            <>
              <div
                ref={dividerRef}
                onMouseDown={handleMouseDown}
                className="w-1 cursor-col-resize bg-border hover:bg-primary/50 transition-colors"
              />

              {/* 右侧：详情预览面板 */}
              <div style={{ width: `${rightPanelWidth}px` }} className="min-h-0 overflow-hidden bg-background-secondary border-l border-border flex flex-col">
                <ValuePreviewPanel value={selectedValue} onClose={() => setSelectedValue(null)} />
              </div>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
