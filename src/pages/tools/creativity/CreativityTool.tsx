import {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  creativityClient,
  selectCreativityModel,
  type CreativityClient,
} from "@/lib/creativity/client";
import type { CreativityHistoryStore } from "@/lib/creativity/history";
import { creativityHistory } from "@/lib/creativity/history";
import type {
  CreativityEvaluation,
  CreativityExample,
  CreativityHistoryRecord,
  CreativityMode,
  CreativityPromptOptions,
} from "@/lib/creativity/types";
import type { ExposedModel } from "@/lib/unifiedApi";
import { isAbortError } from "@/lib/http";
import { uid } from "@/lib/utils";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CreativityControls } from "./CreativityControls";
import { CreativityHistoryDialog } from "./CreativityHistoryDialog";
import { CreativityWorkspace } from "./CreativityWorkspace";
import {
  createInitialCreativityState,
  creativityReducer,
  type CreativityOperation,
} from "./state";

export interface CreativityToolProps {
  client?: CreativityClient;
  history?: CreativityHistoryStore;
}

export function CreativityTool({
  client = creativityClient,
  history = creativityHistory,
}: CreativityToolProps) {
  const { t, i18n } = useTranslation("pages");
  const [state, dispatch] = useReducer(
    creativityReducer,
    undefined,
    createInitialCreativityState,
  );
  const [models, setModels] = useState<ExposedModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelId, setModelId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [records, setRecords] = useState<CreativityHistoryRecord[]>([]);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [failedOperation, setFailedOperation] = useState<
    Exclude<CreativityOperation, null> | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);

  const locale = i18n.resolvedLanguage?.startsWith("en") ? "en" : "zh";

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      client.listModels(),
      history.loadSettings(),
      history.list(),
    ])
      .then(async ([available, settings, storedRecords]) => {
        if (cancelled) return;
        setModels(available);
        setModelsLoaded(true);
        setRecords(storedRecords);
        const selected = selectCreativityModel(
          available,
          new Set(),
          settings?.modelId,
        );
        const nextModelId = selected?.id ?? "";
        setModelId(nextModelId);
        if (
          settings?.modelId &&
          selected &&
          selected.id !== settings.modelId
        ) {
          setModelNotice(
            t("creativity_model_fallback", { model: selected.id }),
          );
        }
        if (settings) {
          dispatch({ type: "mode-changed", mode: settings.mode });
          dispatch({ type: "options-changed", options: settings.options });
        }
        if (selected && selected.id !== settings?.modelId) {
          await history.saveSettings({
            modelId: selected.id,
            mode: settings?.mode ?? "inspiration",
            options: settings?.options ?? state.options,
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setModelsLoaded(true);
        dispatch({
          type: "operation-failed",
          roundId: state.roundId,
          message:
            error instanceof Error
              ? error.message
              : t("creativity_load_failed"),
        });
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // Dependencies are injected once per mounted tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, history]);

  const persistSettings = (
    nextModelId: string,
    mode: CreativityMode,
    options: CreativityPromptOptions,
  ) => {
    void history
      .saveSettings({ modelId: nextModelId, mode, options })
      .catch(() => setSaveWarning(t("creativity_save_warning")));
  };

  const startOperation = (
    operation: "prompt" | "hint" | "examples" | "evaluation",
    roundId: string,
  ): AbortController => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "operation-started", operation, roundId });
    setSaveWarning(null);
    setFailedOperation(null);
    return controller;
  };

  const failOperation = (
    roundId: string,
    operation: Exclude<CreativityOperation, null>,
    error: unknown,
  ) => {
    if (isAbortError(error)) {
      dispatch({ type: "operation-cancelled", roundId });
      return;
    }
    setFailedOperation(operation);
    dispatch({
      type: "operation-failed",
      roundId,
      message:
        error instanceof Error ? error.message : t("creativity_load_failed"),
    });
  };

  const generatePrompt = async () => {
    if (!modelId) return;
    const roundId = uid("round");
    abortRef.current?.abort();
    dispatch({ type: "round-reset", roundId });
    const controller = startOperation("prompt", roundId);
    try {
      const prompt = await client.generatePrompt(
        modelId,
        { locale, options: state.options },
        controller.signal,
      );
      dispatch({ type: "prompt-succeeded", roundId, prompt });
    } catch (error) {
      failOperation(roundId, "prompt", error);
    }
  };

  const requestPrompt = () => {
    if (
      state.mode === "training" &&
      state.answerDirty &&
      !state.evaluation
    ) {
      setDiscardOpen(true);
      return;
    }
    void generatePrompt();
  };

  const saveRecord = async ({
    examples,
    evaluation,
  }: {
    examples: CreativityExample[];
    evaluation: CreativityEvaluation | null;
  }) => {
    if (!state.prompt) return;
    const now = new Date().toISOString();
    const id = state.historyId ?? state.roundId;
    const existing = records.find((record) => record.id === id);
    const record: CreativityHistoryRecord = {
      id,
      mode: state.mode,
      modelId,
      locale,
      options: state.options,
      prompt: state.prompt,
      answer: state.mode === "training" ? state.answer : "",
      hints: state.mode === "training" ? state.hints : [],
      examples,
      evaluation,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await history.upsert(record);
      dispatch({
        type: "history-linked",
        roundId: state.roundId,
        historyId: id,
      });
      setRecords(await history.list());
    } catch {
      setSaveWarning(t("creativity_save_warning"));
    }
  };

  const generateExamples = async () => {
    if (!modelId || !state.prompt) return;
    const roundId = state.roundId;
    const controller = startOperation("examples", roundId);
    try {
      const examples = await client.generateExamples(
        modelId,
        {
          locale,
          promptItems: state.prompt.items.map((item) => item.text),
        },
        controller.signal,
      );
      dispatch({ type: "examples-succeeded", roundId, examples });
      await saveRecord({
        examples,
        evaluation: state.mode === "training" ? state.evaluation : null,
      });
    } catch (error) {
      failOperation(roundId, "examples", error);
    }
  };

  const generateHint = async () => {
    if (!modelId || !state.prompt || state.hints.length >= 3) return;
    const roundId = state.roundId;
    const level = (state.hints.length + 1) as 1 | 2 | 3;
    const controller = startOperation("hint", roundId);
    try {
      const hint = await client.generateHint(
        modelId,
        {
          locale,
          promptItems: state.prompt.items.map((item) => item.text),
          level,
          previousHints: state.hints,
        },
        controller.signal,
      );
      dispatch({ type: "hint-succeeded", roundId, hint });
    } catch (error) {
      failOperation(roundId, "hint", error);
    }
  };

  const evaluateAnswer = async () => {
    if (!modelId || !state.prompt || !state.answer.trim()) return;
    const roundId = state.roundId;
    const controller = startOperation("evaluation", roundId);
    try {
      const evaluation = await client.evaluate(
        modelId,
        {
          locale,
          promptItems: state.prompt.items.map((item) => item.text),
          answer: state.answer.trim(),
        },
        controller.signal,
      );
      dispatch({ type: "evaluation-succeeded", roundId, evaluation });
      await saveRecord({ examples: state.examples, evaluation });
    } catch (error) {
      failOperation(roundId, "evaluation", error);
    }
  };

  const retryFailedOperation = () => {
    switch (failedOperation) {
      case "prompt":
        requestPrompt();
        break;
      case "hint":
        void generateHint();
        break;
      case "examples":
        void generateExamples();
        break;
      case "evaluation":
        void evaluateAnswer();
        break;
      case null:
        break;
    }
  };

  const changeMode = (mode: CreativityMode) => {
    abortRef.current?.abort();
    dispatch({ type: "mode-changed", mode });
    persistSettings(modelId, mode, state.options);
  };

  const changeOptions = (options: CreativityPromptOptions) => {
    dispatch({ type: "options-changed", options });
    persistSettings(modelId, state.mode, options);
  };

  const changeModel = (nextModelId: string) => {
    setModelId(nextModelId);
    setModelNotice(null);
    persistSettings(nextModelId, state.mode, state.options);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto">
      <CreativityControls
        mode={state.mode}
        options={state.options}
        models={models}
        modelId={modelId}
        loading={state.operation === "prompt"}
        onModeChange={changeMode}
        onOptionsChange={changeOptions}
        onModelChange={changeModel}
        onGenerate={requestPrompt}
        onShowHistory={() => {
          void history.list().then(setRecords);
          setHistoryOpen(true);
        }}
      />
      {modelsLoaded && models.length === 0 && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background-secondary p-4">
          <p className="text-copy-14 text-muted-foreground">
            {t("creativity_no_model")}
          </p>
          <a
            href="/unified"
            className="shrink-0 rounded-sm border border-border bg-background px-3 py-1.5 text-label-13 transition-colors hover:bg-secondary"
          >
            {t("creativity_open_unified")}
          </a>
        </div>
      )}
      {modelNotice && (
        <div className="rounded-md border border-border bg-background-secondary px-4 py-2 text-label-13 text-muted-foreground">
          {modelNotice}
        </div>
      )}
      <CreativityWorkspace
        state={state}
        onGenerate={requestPrompt}
        onGenerateExamples={() => void generateExamples()}
        onGenerateHint={() => void generateHint()}
        onAnswerChange={(answer) =>
          dispatch({ type: "answer-changed", answer })
        }
        onEvaluate={() => void evaluateAnswer()}
        onRetry={retryFailedOperation}
        saveWarning={saveWarning}
      />
      <CreativityHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        records={records}
        onDelete={async (id) => {
          await history.remove(id);
          setRecords(await history.list());
        }}
        onClear={async () => {
          await history.clear();
          setRecords([]);
        }}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("creativity_discard_title")}
        description={t("creativity_discard_desc")}
        confirmLabel={t("creativity_discard_confirm")}
        onConfirm={() => {
          setDiscardOpen(false);
          void generatePrompt();
        }}
      />
    </div>
  );
}
