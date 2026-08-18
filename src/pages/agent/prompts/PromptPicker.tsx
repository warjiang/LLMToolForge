import { useMemo, useRef, useState } from "react";
import { BookOpen, Search, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { usePromptRecentStore } from "@/store";
import type { PromptTemplate } from "@/types";
import { buildPromptSections, filterPrompts } from "./promptList";

interface PromptPickerProps {
  prompts: readonly PromptTemplate[];
  loading?: boolean;
  error?: string | null;
  onApply: (prompt: PromptTemplate) => void;
  onManage: () => void;
}

interface PickerSection {
  key: "favorites" | "recent" | "remaining" | "results";
  label: string;
  prompts: PromptTemplate[];
}

export function PromptPicker({
  prompts,
  loading = false,
  error = null,
  onApply,
  onManage,
}: PromptPickerProps) {
  const { t } = useTranslation("pages");
  const recentPromptIds = usePromptRecentStore((state) => state.recentPromptIds);
  const recordRecent = usePromptRecentStore((state) => state.recordRecent);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const sections = useMemo<PickerSection[]>(() => {
    if (query.trim()) {
      return [
        {
          key: "results",
          label: t("prompt_all"),
          prompts: filterPrompts(prompts, query),
        },
      ];
    }

    const projected = buildPromptSections(prompts, recentPromptIds);
    return [
      {
        key: "favorites",
        label: t("prompt_favorites"),
        prompts: projected.favorites,
      },
      {
        key: "recent",
        label: t("prompt_recent"),
        prompts: projected.recent,
      },
      {
        key: "remaining",
        label: t("prompt_all"),
        prompts: projected.remaining,
      },
    ].filter((section) => section.prompts.length > 0) as PickerSection[];
  }, [prompts, query, recentPromptIds, t]);

  const visiblePrompts = sections.flatMap((section) => section.prompts);

  const setPickerOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setActiveIndex(0);
    }
  };

  const apply = (prompt: PromptTemplate) => {
    onApply(prompt);
    recordRecent(prompt.id);
    setOpen(false);
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (visiblePrompts.length > 0) {
        setActiveIndex((current) => (current + 1) % visiblePrompts.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (visiblePrompts.length > 0) {
        setActiveIndex(
          (current) =>
            (current - 1 + visiblePrompts.length) % visiblePrompts.length
        );
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = visiblePrompts[activeIndex];
      if (active) apply(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
    event.stopPropagation();
  };

  let rowIndex = 0;

  return (
    <DropdownMenu open={open} onOpenChange={setPickerOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("prompt_picker_trigger")}
          title={t("prompt_picker_trigger")}
        >
          <BookOpen />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80 overflow-hidden p-0"
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            searchRef.current?.focus();
          }
        }}
      >
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              className="h-8 pl-8"
              aria-label={t("prompt_search")}
              placeholder={t("prompt_search")}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {loading ? (
            <p className="px-3 py-8 text-center text-label-13 text-muted-foreground">
              {t("prompt_loading")}
            </p>
          ) : error ? (
            <p
              role="alert"
              className="px-3 py-8 text-center text-label-13 text-destructive"
            >
              {t("prompt_load_error")}
            </p>
          ) : visiblePrompts.length === 0 ? (
            <p className="px-3 py-8 text-center text-label-13 text-muted-foreground">
              {prompts.length === 0
                ? t("prompt_empty")
                : t("prompt_no_results")}
            </p>
          ) : (
            sections.map((section) => (
              <div
                key={section.key}
                role="group"
                aria-label={section.label}
              >
                <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                {section.prompts.map((prompt) => {
                  const index = rowIndex++;
                  return (
                    <PromptPickerRow
                      key={prompt.id}
                      prompt={prompt}
                      active={index === activeIndex}
                      onPointerMove={() => setActiveIndex(index)}
                      onSelect={() => apply(prompt)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>

        <DropdownMenuSeparator className="m-0" />
        <div className="p-1">
          <DropdownMenuItem
            onSelect={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Settings2 />
            {t("prompt_manage")}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PromptPickerRowProps {
  prompt: PromptTemplate;
  active: boolean;
  onPointerMove: () => void;
  onSelect: () => void;
}

function PromptPickerRow({
  prompt,
  active,
  onPointerMove,
  onSelect,
}: PromptPickerRowProps) {
  return (
    <DropdownMenuItem
      data-testid="prompt-picker-row"
      data-prompt-id={prompt.id}
      className={`items-start px-2 py-2 ${active ? "bg-secondary" : ""}`}
      onPointerMove={onPointerMove}
      onSelect={onSelect}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-label-13 font-medium">{prompt.name}</p>
        {prompt.description && (
          <p className="line-clamp-2 whitespace-normal text-label-12 text-muted-foreground">
            {prompt.description}
          </p>
        )}
        {prompt.tags.length > 0 && (
          <div className="flex min-w-0 gap-1 pt-1">
            {prompt.tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="max-w-28 truncate px-1.5 py-0"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </DropdownMenuItem>
  );
}
