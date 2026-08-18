import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  normalizePromptInput,
  type PromptValidationErrors,
} from "@/lib/prompt";
import { usePromptStore } from "@/store";
import type { PromptTemplate } from "@/types";
import {
  EMPTY_PROMPT_DRAFT,
  PromptEditor,
  promptToDraft,
  type PromptDraft,
} from "./PromptEditor";
import { filterPrompts } from "./promptList";

interface PromptManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EditorMode = "create" | "edit" | null;

export function PromptManagerDialog({
  open,
  onOpenChange,
}: PromptManagerDialogProps) {
  const { t } = useTranslation("pages");
  const { items, loaded, loading, error, load, add, edit, remove } =
    usePromptStore();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [errors, setErrors] = useState<PromptValidationErrors>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PromptTemplate | null>(null);

  const filteredItems = useMemo(
    () => filterPrompts(items, query),
    [items, query]
  );

  useEffect(() => {
    if (open && !loaded) void load();
  }, [load, loaded, open]);

  useEffect(() => {
    if (!open || mode === "create") return;
    const selected = items.find((item) => item.id === selectedId);
    if (selected) {
      if (mode === null) {
        setMode("edit");
        setDraft(promptToDraft(selected));
      }
      return;
    }

    const first = filterPrompts(items, "")[0];
    if (first) {
      setSelectedId(first.id);
      setMode("edit");
      setDraft(promptToDraft(first));
    } else {
      setSelectedId(null);
      setMode(null);
    }
    setErrors({});
  }, [items, mode, open, selectedId]);

  const startCreate = () => {
    setSelectedId(null);
    setMode("create");
    setDraft({ ...EMPTY_PROMPT_DRAFT });
    setErrors({});
    setActionError(null);
  };

  const selectPrompt = (prompt: PromptTemplate) => {
    setSelectedId(prompt.id);
    setMode("edit");
    setDraft(promptToDraft(prompt));
    setErrors({});
    setActionError(null);
  };

  const save = async () => {
    const result = normalizePromptInput({
      name: draft.name,
      description: draft.description,
      content: draft.content,
      tags: draft.tags.split(","),
      sourceUrl: draft.sourceUrl,
      favorite: draft.favorite,
    });
    setErrors(result.errors);
    if (!result.isValid) return;

    setSaving(true);
    setActionError(null);
    try {
      if (mode === "edit" && selectedId) {
        await edit(selectedId, result.value);
        setDraft({
          ...draft,
          name: result.value.name,
          description: result.value.description,
          content: result.value.content,
          tags: result.value.tags.join(", "),
          sourceUrl: result.value.sourceUrl ?? "",
        });
      } else {
        const previousIds = new Set(items.map((item) => item.id));
        await add(result.value);
        const created = usePromptStore
          .getState()
          .items.find((item) => !previousIds.has(item.id));
        if (created) selectPrompt(created);
      }
    } catch {
      setActionError(t("prompt_save_error"));
    } finally {
      setSaving(false);
    }
  };

  const toggleFavorite = async (prompt: PromptTemplate) => {
    setActionError(null);
    try {
      await edit(prompt.id, { favorite: !prompt.favorite });
      if (selectedId === prompt.id) {
        setDraft((current) => ({
          ...current,
          favorite: !prompt.favorite,
        }));
      }
    } catch {
      setActionError(t("prompt_save_error"));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    setActionError(null);
    try {
      await remove(id);
      if (selectedId === id) {
        const next = filterPrompts(usePromptStore.getState().items, "")[0];
        if (next) selectPrompt(next);
        else {
          setSelectedId(null);
          setMode(null);
        }
      }
    } catch {
      setActionError(t("prompt_delete_error"));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(82vh,760px)] w-[calc(100vw-32px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{t("prompt_manager_title")}</DialogTitle>
            <DialogDescription>{t("prompt_manager_description")}</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border">
              <div className="space-y-3 border-b border-border p-3">
                <Button className="w-full" onClick={startCreate}>
                  <Plus />
                  {t("prompt_new")}
                </Button>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    className="pl-9"
                    aria-label={t("prompt_search")}
                    placeholder={t("prompt_search")}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {loading ? (
                  <p className="px-3 py-8 text-center text-label-13 text-muted-foreground">
                    {t("prompt_loading")}
                  </p>
                ) : items.length === 0 ? (
                  <div className="space-y-3 px-3 py-8 text-center">
                    <p className="text-label-13 text-muted-foreground">
                      {t("prompt_empty")}
                    </p>
                    <Button size="sm" variant="secondary" onClick={startCreate}>
                      <Plus />
                      {t("prompt_create_first")}
                    </Button>
                  </div>
                ) : filteredItems.length === 0 ? (
                  <p className="px-3 py-8 text-center text-label-13 text-muted-foreground">
                    {t("prompt_no_results")}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredItems.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={`flex min-w-0 items-center rounded-sm ${
                          selectedId === prompt.id
                            ? "bg-secondary"
                            : "hover:bg-secondary/60"
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 px-3 py-2 text-left"
                          onClick={() => selectPrompt(prompt)}
                        >
                          <span className="block truncate text-label-13 font-medium">
                            {prompt.name}
                          </span>
                          {prompt.description && (
                            <span className="block truncate text-label-12 text-muted-foreground">
                              {prompt.description}
                            </span>
                          )}
                        </button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className={
                            prompt.favorite
                              ? "text-amber-700 hover:text-amber-700"
                              : undefined
                          }
                          title={t(
                            prompt.favorite
                              ? "prompt_unfavorite_action"
                              : "prompt_favorite_action",
                            { name: prompt.name }
                          )}
                          aria-label={t(
                            prompt.favorite
                              ? "prompt_unfavorite_action"
                              : "prompt_favorite_action",
                            { name: prompt.name }
                          )}
                          onClick={() => void toggleFavorite(prompt)}
                        >
                          <Star
                            className={prompt.favorite ? "fill-current" : ""}
                          />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="mr-1 hover:bg-destructive/10 hover:text-destructive"
                          title={t("prompt_delete_action", {
                            name: prompt.name,
                          })}
                          aria-label={t("prompt_delete_action", {
                            name: prompt.name,
                          })}
                          onClick={() => setDeleting(prompt)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto px-6 py-5">
              {(actionError || error) && (
                <div
                  role="alert"
                  className="mb-4 rounded-sm bg-destructive/10 px-3 py-2 text-label-13 text-destructive"
                >
                  {actionError ?? t("prompt_load_error")}
                </div>
              )}

              {mode ? (
                <div className="mx-auto max-w-2xl space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-heading-16">
                      {mode === "create"
                        ? t("prompt_create_title")
                        : t("prompt_edit_title")}
                    </h3>
                    {mode === "edit" && draft.favorite && (
                      <Badge variant="warning">
                        {t("prompt_favorite_label")}
                      </Badge>
                    )}
                  </div>
                  <PromptEditor
                    draft={draft}
                    errors={errors}
                    disabled={saving}
                    onChange={(next) => {
                      setDraft(next);
                      setErrors({});
                      setActionError(null);
                    }}
                  />
                  <div className="flex justify-end">
                    <Button disabled={saving} onClick={() => void save()}>
                      {t("prompt_save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-label-13 text-muted-foreground">
                  {t("prompt_select_or_create")}
                </div>
              )}
            </main>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("prompt_delete_title")}
        description={t("prompt_delete_confirm", {
          name: deleting?.name ?? "",
        })}
        confirmLabel={t("delete", { ns: "common" })}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
