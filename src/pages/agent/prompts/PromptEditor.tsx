import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PromptValidationErrors } from "@/lib/prompt";
import type { PromptTemplate } from "@/types";

export interface PromptDraft {
  name: string;
  description: string;
  content: string;
  tags: string;
  sourceUrl: string;
  favorite: boolean;
}

export const EMPTY_PROMPT_DRAFT: PromptDraft = {
  name: "",
  description: "",
  content: "",
  tags: "",
  sourceUrl: "",
  favorite: false,
};

export function promptToDraft(prompt: PromptTemplate): PromptDraft {
  return {
    name: prompt.name,
    description: prompt.description,
    content: prompt.content,
    tags: prompt.tags.join(", "),
    sourceUrl: prompt.sourceUrl ?? "",
    favorite: prompt.favorite,
  };
}

interface PromptEditorProps {
  draft: PromptDraft;
  errors: PromptValidationErrors;
  disabled?: boolean;
  onChange: (draft: PromptDraft) => void;
}

export function PromptEditor({
  draft,
  errors,
  disabled = false,
  onChange,
}: PromptEditorProps) {
  const { t } = useTranslation("pages");
  const id = useId();
  const update = <K extends keyof PromptDraft>(
    field: K,
    value: PromptDraft[K]
  ) => onChange({ ...draft, [field]: value });

  const validationMessage = (
    field: keyof PromptValidationErrors
  ): string | undefined => {
    const error = errors[field];
    if (!error) return undefined;
    if (field === "name") return t("prompt_validation_name_required");
    if (field === "content") return t("prompt_validation_content_required");
    return t("prompt_validation_source_url");
  };

  const field = (
    name: keyof PromptValidationErrors,
    control: React.ReactNode
  ) => {
    const message = validationMessage(name);
    return (
      <>
        {control}
        {message && (
          <p
            id={`${id}-${name}-error`}
            className="text-label-12 text-destructive"
          >
            {message}
          </p>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-name`} className="text-label-13 font-medium">
          {t("prompt_name_label")}
        </label>
        {field(
          "name",
          <Input
            id={`${id}-name`}
            value={draft.name}
            disabled={disabled}
            aria-invalid={!!errors.name}
            aria-describedby={
              errors.name ? `${id}-name-error` : undefined
            }
            onChange={(event) => update("name", event.target.value)}
          />
        )}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`${id}-description`}
          className="text-label-13 font-medium"
        >
          {t("prompt_description_label")}
        </label>
        <Input
          id={`${id}-description`}
          value={draft.description}
          disabled={disabled}
          onChange={(event) => update("description", event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-content`} className="text-label-13 font-medium">
          {t("prompt_content_label")}
        </label>
        {field(
          "content",
          <Textarea
            id={`${id}-content`}
            value={draft.content}
            disabled={disabled}
            className="min-h-48 resize-y whitespace-pre-wrap font-mono"
            aria-invalid={!!errors.content}
            aria-describedby={
              errors.content ? `${id}-content-error` : undefined
            }
            onChange={(event) => update("content", event.target.value)}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-tags`} className="text-label-13 font-medium">
            {t("prompt_tags_label")}
          </label>
          <Input
            id={`${id}-tags`}
            value={draft.tags}
            disabled={disabled}
            placeholder={t("prompt_tags_placeholder")}
            onChange={(event) => update("tags", event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`${id}-source-url`}
            className="text-label-13 font-medium"
          >
            {t("prompt_source_url_label")}
          </label>
          {field(
            "sourceUrl",
            <Input
              id={`${id}-source-url`}
              type="url"
              value={draft.sourceUrl}
              disabled={disabled}
              placeholder={t("prompt_source_url_placeholder")}
              aria-invalid={!!errors.sourceUrl}
              aria-describedby={
                errors.sourceUrl ? `${id}-sourceUrl-error` : undefined
              }
              onChange={(event) => update("sourceUrl", event.target.value)}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor={`${id}-favorite`} className="text-label-13 font-medium">
          {t("prompt_favorite_label")}
        </label>
        <Switch
          id={`${id}-favorite`}
          checked={draft.favorite}
          disabled={disabled}
          aria-label={t("prompt_favorite_label")}
          onCheckedChange={(checked) => update("favorite", checked)}
        />
      </div>
    </div>
  );
}
