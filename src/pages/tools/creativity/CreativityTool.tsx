import { useReducer, useState } from "react";
import type { CreativityClient } from "@/lib/creativity/client";
import { creativityClient } from "@/lib/creativity/client";
import type { CreativityHistoryStore } from "@/lib/creativity/history";
import { creativityHistory } from "@/lib/creativity/history";
import type { ExposedModel } from "@/lib/unifiedApi";
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
  client: _client = creativityClient,
  history: _history = creativityHistory,
}: CreativityToolProps) {
  const [state, dispatch] = useReducer(
    creativityReducer,
    undefined,
    createInitialCreativityState,
  );
  const [models] = useState<ExposedModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto">
      <CreativityControls
        mode={state.mode}
        options={state.options}
        models={models}
        modelId={modelId}
        loading={state.operation === "prompt"}
        onModeChange={(mode) => dispatch({ type: "mode-changed", mode })}
        onOptionsChange={(options) =>
          dispatch({ type: "options-changed", options })
        }
        onModelChange={setModelId}
        onGenerate={() => undefined}
        onShowHistory={() => setHistoryOpen(true)}
      />
      <CreativityWorkspace state={state} onGenerate={() => undefined} />
      <CreativityHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        records={[]}
      />
    </div>
  );
}
