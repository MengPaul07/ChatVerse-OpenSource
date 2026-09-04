import type { WorldArchive } from "@chatverse/core";
import type {
  DraftValidationResult,
  WorldAuthoringHarnessState,
  WorldAuthoringPlan,
  WorldAuthoringSessionEvent,
  WorldAuthoringTask,
  WorldDraft,
  WorldSourceDraftArtifact,
} from "@chatverse/world-authoring";

export interface AuthoringConversationEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface AuthoringSessionView {
  id: string;
  status: "idle" | "running" | "previewing" | "error";
  acceptedDraft: WorldDraft;
  workingDraft: WorldDraft;
  canUndo: boolean;
  canRedo: boolean;
  conversation: AuthoringConversationEntry[];
  validation: DraftValidationResult;
  plan?: WorldAuthoringPlan;
  task?: WorldAuthoringTask;
  research: { enabled: boolean; available: boolean };
  harness: WorldAuthoringHarnessState;
  sourceArtifacts: WorldSourceDraftArtifact[];
  lastSequence: number;
  error?: string;
}

export interface PreviewEntry {
  id: string;
  kind: "narration" | "character" | "action";
  actorName?: string;
  text: string;
}

export interface PreviewResult {
  entries: PreviewEntry[];
  beatCount: number;
  warnings: string[];
  timedOut: boolean;
}

export interface AuthoringApiResponse {
  ok: boolean;
  code?: string;
  message?: string;
  session?: AuthoringSessionView;
  preview?: PreviewResult;
  roomId?: string;
  archive?: WorldArchive;
  events?: WorldAuthoringSessionEvent[];
  harness?: WorldAuthoringHarnessState;
}

