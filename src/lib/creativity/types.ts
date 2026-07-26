import type { ChatMessage } from "@/lib/providers";

export type CreativityLocale = "zh" | "en";
export type CreativityMode = "inspiration" | "training";
export type SemanticDistance = "near" | "cross-domain" | "far";
export type AbstractionLevel = "concrete" | "abstract" | "mixed";
export type CreativityPurpose =
  | "divergent"
  | "product"
  | "story"
  | "problem-solving";
export type EvaluationLevel = "starting" | "clear" | "strong";

export interface CreativityPromptOptions {
  itemCount: 2 | 3;
  semanticDistance: SemanticDistance;
  domain: string;
  abstraction: AbstractionLevel;
  purpose: CreativityPurpose;
}

export interface CreativityPromptItem {
  text: string;
  kind: "thing" | "concept";
}

export interface CreativityPrompt {
  id: string;
  items: CreativityPromptItem[];
}

export interface CreativityHint {
  level: 1 | 2 | 3;
  content: string;
}

export interface CreativityExample {
  method: string;
  title: string;
  content: string;
}

export interface EvaluationDimension {
  level: EvaluationLevel;
  reason: string;
}

export interface CreativityEvaluation {
  dimensions: {
    distance: EvaluationDimension;
    coherence: EvaluationDimension;
    novelty: EvaluationDimension;
    depth: EvaluationDimension;
  };
  strengths: string[];
  improvement: string;
  followUpQuestion: string;
}

export interface CreativityPromptRequest {
  locale: CreativityLocale;
  options: CreativityPromptOptions;
}

export interface CreativityContextRequest {
  locale: CreativityLocale;
  promptItems: string[];
}

export interface CreativityHintRequest extends CreativityContextRequest {
  level: 1 | 2 | 3;
  previousHints: CreativityHint[];
}

export interface CreativityEvaluationRequest
  extends CreativityContextRequest {
  answer: string;
}

export interface CreativitySettings {
  modelId: string;
  mode: CreativityMode;
  options: CreativityPromptOptions;
}

export interface CreativityHistoryRecord {
  id: string;
  mode: CreativityMode;
  modelId: string;
  locale: CreativityLocale;
  options: CreativityPromptOptions;
  prompt: CreativityPrompt;
  answer: string;
  hints: CreativityHint[];
  examples: CreativityExample[];
  evaluation: CreativityEvaluation | null;
  createdAt: string;
  updatedAt: string;
}

export type CreativityMessages = ChatMessage[];
