import { uid } from "@/lib/utils";
import type {
  CreativityEvaluation,
  CreativityExample,
  CreativityHint,
  CreativityMode,
  CreativityPrompt,
  CreativityPromptOptions,
} from "@/lib/creativity/types";

export type CreativityOperation =
  | "prompt"
  | "hint"
  | "examples"
  | "evaluation"
  | null;

export interface CreativityState {
  roundId: string;
  mode: CreativityMode;
  options: CreativityPromptOptions;
  prompt: CreativityPrompt | null;
  answer: string;
  answerDirty: boolean;
  hints: CreativityHint[];
  examples: CreativityExample[];
  evaluation: CreativityEvaluation | null;
  operation: CreativityOperation;
  operationRoundId: string | null;
  error: string | null;
  historyId: string | null;
}

export const DEFAULT_CREATIVITY_OPTIONS: CreativityPromptOptions = {
  itemCount: 2,
  semanticDistance: "far",
  domain: "any",
  abstraction: "mixed",
  purpose: "divergent",
};

export function createInitialCreativityState(): CreativityState {
  return {
    roundId: uid("round"),
    mode: "inspiration",
    options: DEFAULT_CREATIVITY_OPTIONS,
    prompt: null,
    answer: "",
    answerDirty: false,
    hints: [],
    examples: [],
    evaluation: null,
    operation: null,
    operationRoundId: null,
    error: null,
    historyId: null,
  };
}

export type CreativityAction =
  | { type: "round-reset"; roundId: string }
  | { type: "mode-changed"; mode: CreativityMode }
  | { type: "options-changed"; options: CreativityPromptOptions }
  | { type: "answer-changed"; answer: string }
  | {
      type: "operation-started";
      operation: Exclude<CreativityOperation, null>;
      roundId: string;
    }
  | {
      type: "prompt-succeeded";
      roundId: string;
      prompt: CreativityPrompt;
    }
  | { type: "hint-succeeded"; roundId: string; hint: CreativityHint }
  | {
      type: "examples-succeeded";
      roundId: string;
      examples: CreativityExample[];
    }
  | {
      type: "evaluation-succeeded";
      roundId: string;
      evaluation: CreativityEvaluation;
    }
  | { type: "operation-failed"; roundId: string; message: string }
  | { type: "operation-cancelled"; roundId: string }
  | { type: "history-linked"; roundId: string; historyId: string };

function currentRound(state: CreativityState, roundId: string): boolean {
  return state.roundId === roundId;
}

function idle(state: CreativityState): CreativityState {
  return {
    ...state,
    operation: null,
    operationRoundId: null,
  };
}

export function creativityReducer(
  state: CreativityState,
  action: CreativityAction,
): CreativityState {
  switch (action.type) {
    case "round-reset":
      return {
        ...createInitialCreativityState(),
        roundId: action.roundId,
        mode: state.mode,
        options: state.options,
      };
    case "mode-changed":
      return {
        ...state,
        roundId: uid("round"),
        mode: action.mode,
        answer: "",
        answerDirty: false,
        hints: [],
        examples: [],
        evaluation: null,
        operation: null,
        operationRoundId: null,
        error: null,
        historyId: null,
      };
    case "options-changed":
      return { ...state, options: action.options };
    case "answer-changed":
      return {
        ...state,
        answer: action.answer,
        answerDirty: true,
        error: null,
      };
    case "operation-started":
      if (!currentRound(state, action.roundId)) return state;
      return {
        ...state,
        operation: action.operation,
        operationRoundId: action.roundId,
        error: null,
      };
    case "prompt-succeeded":
      if (!currentRound(state, action.roundId)) return state;
      return idle({
        ...state,
        prompt: action.prompt,
        answer: "",
        answerDirty: false,
        hints: [],
        examples: [],
        evaluation: null,
        error: null,
        historyId: null,
      });
    case "hint-succeeded":
      if (!currentRound(state, action.roundId)) return state;
      return idle({
        ...state,
        hints: [...state.hints, action.hint],
        error: null,
      });
    case "examples-succeeded":
      if (!currentRound(state, action.roundId)) return state;
      return idle({ ...state, examples: action.examples, error: null });
    case "evaluation-succeeded":
      if (!currentRound(state, action.roundId)) return state;
      return idle({
        ...state,
        evaluation: action.evaluation,
        answerDirty: false,
        error: null,
      });
    case "operation-failed":
      if (!currentRound(state, action.roundId)) return state;
      return {
        ...idle(state),
        error: action.message,
      };
    case "operation-cancelled":
      if (!currentRound(state, action.roundId)) return state;
      return idle(state);
    case "history-linked":
      if (!currentRound(state, action.roundId)) return state;
      return { ...state, historyId: action.historyId };
  }
}
