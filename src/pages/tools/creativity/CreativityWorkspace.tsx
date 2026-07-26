import { Lightbulb, Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreativityEvaluation,
  CreativityExample,
} from "@/lib/creativity/types";
import type { CreativityState } from "./state";

export function CreativityWorkspace({
  state,
  onGenerate,
  onGenerateExamples,
  onGenerateHint,
  onAnswerChange,
  onEvaluate,
  onRetry,
  saveWarning,
}: {
  state: CreativityState;
  onGenerate: () => void;
  onGenerateExamples: () => void;
  onGenerateHint: () => void;
  onAnswerChange: (answer: string) => void;
  onEvaluate: () => void;
  onRetry: () => void;
  saveWarning: string | null;
}) {
  const { t } = useTranslation("pages");

  if (!state.prompt) {
    return (
      <Card className="flex min-h-[340px] flex-col items-center justify-center p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Lightbulb className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-heading-20">
          {t("creativity_empty_title")}
        </h3>
        <p className="mt-2 max-w-lg text-copy-14 text-muted-foreground">
          {t("creativity_empty_desc")}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-label-12 uppercase tracking-[0.16em] text-muted-foreground">
              {t("creativity_current_prompt")}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {state.prompt.items.map((item, index) => (
                <div key={`${item.text}-${index}`} className="flex items-center gap-3">
                  {index > 0 && (
                    <span className="text-heading-24 text-muted-foreground">
                      +
                    </span>
                  )}
                  <span className="rounded-md border border-border bg-background-secondary px-5 py-3 text-heading-24">
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Button variant="secondary" onClick={onGenerate}>
            <Shuffle className="h-4 w-4" />
            {t("creativity_new_prompt")}
          </Button>
        </div>
      </Card>

      {state.mode === "inspiration" && (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-heading-16">
                {t("creativity_mode_inspiration")}
              </h3>
              <p className="mt-1 text-copy-14 text-muted-foreground">
                {t("creativity_examples_desc")}
              </p>
            </div>
            <Button
              onClick={onGenerateExamples}
              disabled={state.operation !== null}
            >
              {state.operation === "examples"
                ? t("creativity_examples_running")
                : t("creativity_examples_action")}
            </Button>
          </div>
          {state.examples.length > 0 && (
            <ExampleGrid examples={state.examples} />
          )}
          {saveWarning && (
            <p className="mt-3 text-label-13 text-warning">{saveWarning}</p>
          )}
        </Card>
      )}

      {state.mode === "training" && (
        <Card className="p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
            <div className="space-y-3">
              <Label htmlFor="creativity-answer">
                {t("creativity_answer_label")}
              </Label>
              <Textarea
                id="creativity-answer"
                value={state.answer}
                onChange={(event) => onAnswerChange(event.target.value)}
                placeholder={t("creativity_answer_placeholder")}
                className="min-h-[180px] resize-y text-copy-14 leading-relaxed"
              />
              <div className="flex flex-wrap gap-2">
                {state.hints.length < 3 && (
                  <Button
                    variant="secondary"
                    onClick={onGenerateHint}
                    disabled={state.operation !== null}
                  >
                    {state.operation === "hint"
                      ? t("creativity_hint_running")
                      : t("creativity_hint_unlock", {
                          level: state.hints.length + 1,
                        })}
                  </Button>
                )}
                <Button
                  onClick={onEvaluate}
                  disabled={
                    !state.answer.trim() || state.operation !== null
                  }
                >
                  {state.operation === "evaluation"
                    ? t("creativity_evaluating")
                    : t("creativity_evaluate")}
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {state.hints.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-5 text-copy-14 text-muted-foreground">
                  {t("creativity_hint_empty")}
                </div>
              ) : (
                state.hints.map((hint) => (
                  <div
                    key={hint.level}
                    className="rounded-md border border-border bg-background-secondary p-4"
                  >
                    <div className="text-label-12 text-muted-foreground">
                      {t("creativity_hint_level", { level: hint.level })}
                    </div>
                    <p className="mt-2 text-copy-14 leading-relaxed">
                      {hint.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {state.evaluation && (
            <div className="mt-6 border-t border-border pt-6">
              <EvaluationView evaluation={state.evaluation} />
              <div className="mt-5 flex justify-end">
                <Button
                  variant="secondary"
                  onClick={onGenerateExamples}
                  disabled={state.operation !== null}
                >
                  {state.operation === "examples"
                    ? t("creativity_examples_running")
                    : t("creativity_examples_action")}
                </Button>
              </div>
              {state.examples.length > 0 && (
                <ExampleGrid examples={state.examples} />
              )}
            </div>
          )}

          {saveWarning && (
            <p className="mt-3 text-label-13 text-warning">{saveWarning}</p>
          )}
        </Card>
      )}

      {state.error && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-label-13 text-destructive">
          <span>{state.error}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("creativity_retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ExampleGrid({ examples }: { examples: CreativityExample[] }) {
  return (
    <div className="mt-5 grid gap-3 lg:grid-cols-3">
      {examples.map((example) => (
        <div
          key={example.method}
          className="rounded-md border border-border bg-background-secondary p-4"
        >
          <div className="text-label-12 text-muted-foreground">
            {example.method}
          </div>
          <h4 className="mt-2 text-heading-16">{example.title}</h4>
          <p className="mt-2 text-copy-14 leading-relaxed text-muted-foreground">
            {example.content}
          </p>
        </div>
      ))}
    </div>
  );
}

function EvaluationView({
  evaluation,
}: {
  evaluation: CreativityEvaluation;
}) {
  const { t } = useTranslation("pages");
  const dimensions = [
    ["distance", evaluation.dimensions.distance],
    ["coherence", evaluation.dimensions.coherence],
    ["novelty", evaluation.dimensions.novelty],
    ["depth", evaluation.dimensions.depth],
  ] as const;

  return (
    <div className="space-y-4">
      <h3 className="text-heading-20">
        {t("creativity_evaluation_title")}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dimensions.map(([key, dimension]) => (
          <div
            key={key}
            className="rounded-md border border-border bg-background-secondary p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-label-13 font-medium">
                {t(`creativity_dimension_${key}`)}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-label-12">
                {t(`creativity_level_${dimension.level}`)}
              </span>
            </div>
            <p className="mt-3 text-copy-14 text-muted-foreground">
              {dimension.reason}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <FeedbackBlock
          label={t("creativity_strengths")}
          content={evaluation.strengths.join("；")}
        />
        <FeedbackBlock
          label={t("creativity_improvement")}
          content={evaluation.improvement}
        />
        <FeedbackBlock
          label={t("creativity_follow_up")}
          content={evaluation.followUpQuestion}
        />
      </div>
    </div>
  );
}

function FeedbackBlock({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-label-12 text-muted-foreground">{label}</div>
      <p className="mt-2 text-copy-14 leading-relaxed">{content}</p>
    </div>
  );
}
