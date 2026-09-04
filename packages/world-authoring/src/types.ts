import type {
  CharacterCard,
  GalgamePresentationConfig,
  LoreBook,
  SceneCard,
  PlayerCharacterCard,
  TokenUsage,
  UserProfileCard,
  WorldSourceBinding,
} from "@chatverse/core";

export const WORLD_DRAFT_SCHEMA_VERSION = 1;

export type WorldDraftRuntimeProfile = "world_story" | "group_chat";
export type DraftActorRole = "lead" | "support";
export type DraftPlayerMode = "participant" | "observer" | "director";
export type WorldAuthoringScope =
  | "foundation"
  | "actors"
  | "relations"
  | "context"
  | "chapters"
  | "polish";
export type WorldAuthoringPlanStatus =
  | "pending"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "skipped";

export interface WorldAuthoringPlanItem {
  id: string;
  title: string;
  scope: WorldAuthoringScope;
  status: WorldAuthoringPlanStatus;
}

export interface WorldAuthoringPlan {
  id: string;
  goal: string;
  items: WorldAuthoringPlanItem[];
}

export type WorldAuthoringTaskStatus =
  | "active"
  | "paused"
  | "waiting_user"
  | "blocked"
  | "completed";

/**
 * Durable-facing state for a long-running Studio authoring objective.
 * Scheduling/locking remains a server concern; this is only the observable task state.
 */
export interface WorldAuthoringTask {
  id: string;
  objective: string;
  phase: WorldAuthoringScope;
  status: WorldAuthoringTaskStatus;
  draftRevision: number;
  roundsStarted: number;
  maxRounds: number;
  noOpStreak: number;
  lastError?: string;
  updatedAt: number;
}

export interface WorldDraftMetadata {
  name: string;
  description: string;
  tone?: string;
  tags?: string[];
  rights?: {
    basis: "original" | "public_domain" | "licensed" | "user_supplied";
    sourceTitle?: string;
    sourceAuthor?: string;
    jurisdiction?: string;
    attribution?: string;
  };
}

export interface WorldDraftLore {
  core: string;
  rules: string[];
}

export interface DraftResearchSource {
  id: string;
  title: string;
  url: string;
  accessedAt: number;
  note: string;
}

export type WorldResearchEvent =
  | { type: "started"; query: string; purpose: string }
  | { type: "completed"; query: string; sourceCount: number; sources: DraftResearchSource[]; usage?: TokenUsage }
  | { type: "failed"; query: string; error: string };

export type WorldSourceMaterialOrigin = "user_import" | "architect";

/** Read-only material supplied by Studio for progressive source inspection. */
export interface WorldSourceMaterialDocument {
  bundleId: string;
  revision: number;
  origin: WorldSourceMaterialOrigin;
  documentId: string;
  path: string;
  title: string;
  content: string;
}

export interface WorldSourceDraftDocument {
  path: string;
  title: string;
  content: string;
}

/** A bounded Markdown bundle proposal. Studio persists it after the turn. */
export interface WorldSourceDraftArtifact {
  id: string;
  mode: "create" | "revise";
  bundleId: string;
  baseRevision?: number;
  revision: number;
  name: string;
  description?: string;
  documents: WorldSourceDraftDocument[];
}

export interface DraftPlayer {
  id: string;
  profile: UserProfileCard;
  mode: DraftPlayerMode;
  playerCard?: PlayerCharacterCard;
}

export interface DraftActor {
  id: string;
  role: DraftActorRole;
  card: CharacterCard;
  /** Actor-specific situation in this world, separate from omniscient lore. */
  background?: string;
}

export interface DraftRelation {
  id: string;
  fromActorId: string;
  toActorId: string;
  description: string;
}

export interface DraftContext {
  id: string;
  name: string;
  actorIds: string[];
  scene: SceneCard;
  /** Observable opening prose used as the initial scene node. */
  opening: string;
  lore?: LoreBook;
  presentation?: GalgamePresentationConfig;
}

export interface DraftChapter {
  id: string;
  title: string;
  treatment: string;
  targetOutcome: string;
  status: "queued" | "active";
  actorIds: string[];
  contextIds: string[];
}

export interface WorldDraft {
  schemaVersion: 1;
  id: string;
  revision: number;
  metadata: WorldDraftMetadata;
  premise: string;
  lore: WorldDraftLore;
  player?: DraftPlayer;
  actors: DraftActor[];
  relations: DraftRelation[];
  contexts: DraftContext[];
  chapters: DraftChapter[];
  runtimeProfile: WorldDraftRuntimeProfile;
  researchSources?: DraftResearchSource[];
  /** Immutable local Source revisions selected for Director retrieval. */
  sources?: WorldSourceBinding[];
  lastChangeSummary?: string;
}

export type DraftValidationSeverity = "error" | "warning";

export interface DraftValidationIssue {
  code: string;
  severity: DraftValidationSeverity;
  message: string;
  path?: string;
}

export interface DraftValidationResult {
  valid: boolean;
  issues: DraftValidationIssue[];
}

export type WorldDraftOperation =
  | {
      type: "set_metadata";
      metadata: Partial<WorldDraftMetadata>;
    }
  | {
      type: "set_premise";
      premise: string;
    }
  | {
      type: "set_lore";
      lore: Partial<WorldDraftLore>;
    }
  | {
      type: "upsert_player";
      player: Partial<DraftPlayer> & { id?: string };
    }
  | {
      type: "remove_player";
    }
  | {
      type: "upsert_actor";
      actor: Partial<DraftActor> & { id?: string; card: CharacterCard };
    }
  | {
      type: "remove_actor";
      actorId: string;
    }
  | {
      type: "upsert_relation";
      relation: Partial<DraftRelation> & {
        id?: string;
        fromActorId: string;
        toActorId: string;
        description: string;
      };
    }
  | {
      type: "remove_relation";
      relationId: string;
    }
  | {
      type: "upsert_context";
      context: Partial<DraftContext> & {
        id?: string;
        name: string;
        scene: SceneCard;
        opening: string;
      };
    }
  | {
      type: "upsert_chapter";
      chapter: Partial<DraftChapter> & {
        id?: string;
        title: string;
        treatment: string;
        targetOutcome: string;
      };
    }
  | {
      type: "remove_chapter";
      chapterId: string;
    }
  | {
      type: "set_runtime_profile";
      runtimeProfile: WorldDraftRuntimeProfile;
    }
  | {
      type: "set_sources";
      sources: WorldSourceBinding[];
    };

export interface WorldDraftChangeSet {
  id: string;
  baseRevision: number;
  nextRevision: number;
  summary: string;
  operations: WorldDraftOperation[];
  validation: DraftValidationResult;
  planItemId?: string;
  researchSources?: DraftResearchSource[];
}

export type WorldDraftBatchScope =
  | "foundation"
  | "player"
  | "actors"
  | "relations"
  | "context"
  | "chapters"
  | "runtime"
  | "mixed";

export interface WorldDraftBatchReceipt {
  id: string;
  objective: string;
  scope: WorldDraftBatchScope;
  previousRevision: number;
  revision: number;
  operationTypes: WorldDraftOperation["type"][];
  changedSections: string[];
  validationDelta: {
    resolved: string[];
    introduced: string[];
    remainingErrors: number;
  };
}

export interface WorldDraftBatchCommit {
  draft: WorldDraft;
  operations: WorldDraftOperation[];
  receipt: WorldDraftBatchReceipt;
}

export interface WorldArchitectResult {
  summary: string;
  questions: string[];
  workingDraft: WorldDraft;
  changeSet?: WorldDraftChangeSet;
  batchReceipts?: WorldDraftBatchReceipt[];
  sourceArtifacts?: WorldSourceDraftArtifact[];
  plan?: WorldAuthoringPlan;
  execution: WorldArchitectExecution;
}

export type WorldArchitectStopReason =
  | "finished"
  | "natural_response"
  | "no_change"
  | "max_tokens"
  | "tool_input_error"
  | "round_limit";

export interface WorldArchitectExecution {
  steps: number;
  toolCalls: number;
  stopReason: WorldArchitectStopReason;
}

export type WorldAuthoringSessionEventType =
  | "turn.started"
  | "step.started"
  | "model.requested"
  | "model.completed"
  | "tool.called"
  | "tool.completed"
  | "step.completed"
  | "draft.committed"
  | "turn.completed"
  | "turn.cancelled"
  | "turn.failed";

/** Append-only, replay-friendly execution fact emitted by the Studio Harness. */
export interface WorldAuthoringSessionEvent {
  sequence: number;
  occurredAt: number;
  turnId: string;
  step?: number;
  type: WorldAuthoringSessionEventType;
  data: Record<string, unknown>;
}

export interface WorldAuthoringHarnessState {
  currentTurnId?: string;
  turnCount: number;
  stepCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  totalTokens: number;
  lastStopReason?: WorldArchitectStopReason | "cancelled" | "failed";
  lastEventSequence: number;
  recentEvents: WorldAuthoringSessionEvent[];
}
