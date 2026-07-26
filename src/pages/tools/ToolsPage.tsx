import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Braces,
  Code2,
  FileText,
  Hash,
  KeyRound,
  Languages,
  Link2,
  NotebookText,
  RotateCcw,
  Sparkles,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { UrlTool } from "./UrlTool";
import { JsonTool } from "./JsonTool";
import { EscapeTool } from "./EscapeTool";
import { UnicodeTool } from "./UnicodeTool";
import { Base64Tool } from "./Base64Tool";
import { HashTool } from "./HashTool";
import { MarkdownTool } from "./MarkdownTool";
import { TranslateTool } from "./TranslateTool";
import { TextEditorTool } from "./TextEditorTool";
import { CreativityTool } from "./creativity/CreativityTool";

export const TOOL_TAB_ORDER = [
  "url",
  "json",
  "markdown",
  "text-editor",
  "base64",
  "hash",
  "escape",
  "unicode",
  "creativity",
  "translate",
] as const;

export type ToolTabValue = (typeof TOOL_TAB_ORDER)[number];

const TOOL_TAB_VALUES = new Set<string>(TOOL_TAB_ORDER);
const TOOL_TAB_ORDER_KEY = "llmtoolforge.tools.tabOrder";

export function normalizeToolTabOrder(order: readonly string[]): ToolTabValue[] {
  const normalized: ToolTabValue[] = [];

  for (const value of order) {
    if (!TOOL_TAB_VALUES.has(value)) continue;
    if (normalized.includes(value as ToolTabValue)) continue;
    normalized.push(value as ToolTabValue);
  }

  for (const value of TOOL_TAB_ORDER) {
    if (!normalized.includes(value)) normalized.push(value);
  }

  return normalized;
}

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadToolTabOrder(): ToolTabValue[] {
  const store = storage();
  if (!store) return [...TOOL_TAB_ORDER];

  try {
    const raw = store.getItem(TOOL_TAB_ORDER_KEY);
    if (!raw) return [...TOOL_TAB_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...TOOL_TAB_ORDER];
    return normalizeToolTabOrder(
      parsed.filter((value): value is string => typeof value === "string")
    );
  } catch {
    return [...TOOL_TAB_ORDER];
  }
}

export function saveToolTabOrder(order: readonly string[]): ToolTabValue[] {
  const normalized = normalizeToolTabOrder(order);
  storage()?.setItem(TOOL_TAB_ORDER_KEY, JSON.stringify(normalized));
  return normalized;
}

export function resetToolTabOrder(): ToolTabValue[] {
  storage()?.removeItem(TOOL_TAB_ORDER_KEY);
  return [...TOOL_TAB_ORDER];
}

export function reorderToolTabOrder(
  order: readonly string[],
  activeValue: string,
  overValue: string | null | undefined
): ToolTabValue[] {
  if (!overValue || activeValue === overValue) return normalizeToolTabOrder(order);

  const normalized = normalizeToolTabOrder(order);
  const activeIndex = normalized.indexOf(activeValue as ToolTabValue);
  const overIndex = normalized.indexOf(overValue as ToolTabValue);
  if (activeIndex < 0 || overIndex < 0) return normalized;

  const next = [...normalized];
  const [active] = next.splice(activeIndex, 1);
  if (!active) return normalized;
  next.splice(overIndex, 0, active);
  return next;
}

function SortableToolTab({
  value,
  label,
  icon: Icon,
}: {
  value: ToolTabValue;
  label: string;
  icon: ComponentType<{ className?: string }>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: value });
  const {
    role: _sortableRole,
    tabIndex: _sortableTabIndex,
    ...sortableAttributes
  } = attributes;

  return (
    <TabsTrigger
      ref={setNodeRef}
      value={value}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(isDragging && "z-20 opacity-60")}
      {...sortableAttributes}
      {...listeners}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </TabsTrigger>
  );
}

export function ToolsPage() {
  const { t } = useTranslation("pages");
  const [tabOrder, setTabOrder] = useState<ToolTabValue[]>(() => loadToolTabOrder());
  const [activeTab, setActiveTab] = useState<ToolTabValue>(() => loadToolTabOrder()[0] ?? "url");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const tabs = useMemo<{
    value: ToolTabValue;
    label: string;
    icon: ComponentType<{ className?: string }>;
    Comp: ComponentType;
  }[]>(
    () => [
      { value: "url", label: t("url_codec"), icon: Link2, Comp: UrlTool },
      { value: "json", label: t("json_viewer"), icon: Braces, Comp: JsonTool },
      { value: "markdown", label: t("markdown_tool"), icon: FileText, Comp: MarkdownTool },
      {
        value: "text-editor",
        label: t("text_editor_tool"),
        icon: NotebookText,
        Comp: TextEditorTool,
      },
      { value: "base64", label: t("base64_tool"), icon: KeyRound, Comp: Base64Tool },
      { value: "hash", label: t("hash_tool"), icon: Hash, Comp: HashTool },
      { value: "escape", label: t("escape_tool"), icon: Code2, Comp: EscapeTool },
      { value: "unicode", label: t("unicode_tool"), icon: Type, Comp: UnicodeTool },
      {
        value: "creativity",
        label: t("creativity_tool"),
        icon: Sparkles,
        Comp: CreativityTool,
      },
      { value: "translate", label: t("translate_tool"), icon: Languages, Comp: TranslateTool },
    ],
    [t]
  );
  const tabsByValue = useMemo(
    () => new Map(tabs.map((tab) => [tab.value, tab])),
    [tabs]
  );
  const orderedTabs = tabOrder
    .map((value) => tabsByValue.get(value))
    .filter((tab): tab is (typeof tabs)[number] => Boolean(tab));

  const handleDragEnd = (event: DragEndEvent) => {
    const next = reorderToolTabOrder(
      tabOrder,
      String(event.active.id),
      event.over?.id == null ? null : String(event.over.id)
    );
    setTabOrder(next);
    saveToolTabOrder(next);
  };

  const handleResetOrder = () => {
    const next = resetToolTabOrder();
    setTabOrder(next);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={t("tools_title")}
        description={t("tools_description")}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (TOOL_TAB_VALUES.has(value)) setActiveTab(value as ToolTabValue);
        }}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div
            data-testid="tools-tab-scroller"
            className="min-w-0 flex-1 overflow-x-auto pb-1"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={tabOrder}
                strategy={horizontalListSortingStrategy}
              >
                <TabsList className="w-max flex-nowrap">
                  {orderedTabs.map(({ value, label, icon }) => (
                    <SortableToolTab
                      key={value}
                      value={value}
                      label={label}
                      icon={icon}
                    />
                  ))}
                </TabsList>
              </SortableContext>
            </DndContext>
          </div>

          <button
            type="button"
            onClick={handleResetOrder}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-label-13 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("tools_reset_order")}
            title={t("tools_reset_order")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("tools_reset_order_short")}</span>
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {tabs.map(({ value, Comp }) => (
            <TabsContent key={value} value={value} className="h-full overflow-hidden">
              <div className="h-full overflow-hidden">
                <Comp />
              </div>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
