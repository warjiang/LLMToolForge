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
  CreativityHistoryRecord,
  CreativityMode,
  CreativityPromptOptions,
} from "@/lib/creativity/types";
import type { ExposedModel } from "@/lib/unifiedApi";
import { isAbortError } from "@/lib/http";
import { uid } from "@/lib/utils";
import { CreativityControls } from "./CreativityControls";
import { CreativityHistoryDialog } from "./CreativityHistoryDialog";
import { CreativityWorkspace } from "./CreativityWorkspace";
import {
  createInitialCreativityState,
  creativityReducer,
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
  const [modelId, setModelId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [records, setRecords] = useState<CreativityHistoryRecord[]>([]);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
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
        setRecords(storedRecords);
        const selected = selectCreativityModel(
          available,
          new Set(),
          settings?.modelId,
        );
        const nextModelId = selected?.id ?? "";
        setModelId(nextModelId);
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
    operation: "prompt" | "examples",
    roundId: string,
  ): AbortController => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "operation-started", operation, roundId });
    setSaveWarning(null);
    return controller;
  };

  const failOperation = (roundId: string, error: unknown) => {
    if (isAbortError(error)) {
      dispatch({ type: "operation-cancelled", roundId });
      return;
    }
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
      failOperation(roundId, error);
    }
  };

  const saveQuickRecord = async (
    examples: CreativityHistoryRecord["examples"],
  ) => {
    if (!state.prompt) return;
    const now = new Date().toISOString();
    const id = state.historyId ?? state.roundId;
    const existing = records.find((record) => record.id === id);
    const record: CreativityHistoryRecord = {
      id,
      mode: "inspiration",
      modelId,
      locale,
      options: state.options,
      prompt: state.prompt,
      answer: "",
      hints: [],
      examples,
      evaluation: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await history.upsert(record);
      dispatch({ type: "history-linked", roundId: state.roundId, historyId: id });
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
      await saveQuickRecord(examples);
    } catch (error) {
      failOperation(roundId, error);
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
        onGenerate={() => void generatePrompt()}
        onShowHistory={() => {
          void history.list().then(setRecords);
          setHistoryOpen(true);
        }}
      />
      <CreativityWorkspace
        state={state}
        onGenerate={() => void generatePrompt()}
        onGenerateExamples={() => void generateExamples()}
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
    </div>
  );
}
