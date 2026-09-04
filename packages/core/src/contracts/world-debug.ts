import type {
  ActorMemoryRuntimeSnapshot,
  ActorMemorySnapshot,
} from "./actor-memory.js";
import type {
  ContextPresenceState,
  WorldActorBackgroundState,
  WorldActorControlState,
  WorldActorState,
} from "./world/actors.js";
import type {
  NarrativeBeat,
  NarrativeEdge,
  NarrativeChapter,
} from "./world/narrative.js";
import type {
  ContextActivityState,
  PresentationRuntimeSnapshot,
  WorldContextStatus,
} from "./world/presentation.js";
import type { ResolvedWorldActorRuntimePolicy } from "./world/runtime.js";
import type { WorldForegroundRecoveryState } from "./world/foreground.js";

export interface WorldDebugConfig {
  enabled?: boolean;
  tracePrompts?: boolean;
  traceResponses?: boolean;
  traceToolCalls?: boolean;
  includeMemoryContent?: boolean;
  maxEvents?: number;
}

export type WorldDebugCategory =
  | "world"
  | "director"
  | "context"
  | "harness"
  | "queue"
  | "memory"
  | "provider"
  | "error";

export type WorldDebugLevel = "trace" | "info" | "warning" | "error";

export interface WorldDebugEvent {
  id: string;
  sequence: number;
  occurredAt: number;
  worldId: string;
  category: WorldDebugCategory;
  type: string;
  level: WorldDebugLevel;
  contextId?: string;
  actorId?: string;
  causationId?: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}

export type WorldDebugEventInput = Omit<
  WorldDebugEvent,
  "id" | "sequence" | "occurredAt" | "worldId"
>;

export type WorldDebugListener = (event: WorldDebugEvent) => void;

export interface ActorMemoryDebugSnapshot extends ActorMemoryRuntimeSnapshot {
  revision: number;
  status: "idle" | "scheduled" | "ready" | "running" | "retrying";
  dueAt?: number;
  retryIndex: number;
  candidateEventCount: number;
}

export interface WorldTokenUsageTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  reasoningTokens: number;
}

export interface WorldTokenUsageBreakdown extends WorldTokenUsageTotals {
  key: string;
}

export interface WorldTokenUsageSnapshot extends WorldTokenUsageTotals {
  firstObservedAt?: number;
  lastObservedAt?: number;
  byRole: WorldTokenUsageBreakdown[];
  byPurpose: WorldTokenUsageBreakdown[];
  byActor: WorldTokenUsageBreakdown[];
  byModel: WorldTokenUsageBreakdown[];
  byTurn: WorldTokenUsageBreakdown[];
}

export interface WorldDebugSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  world: {
    id: string;
    status: "idle" | "running" | "paused" | "stopped";
    worldTime: number;
    eventSequence: number;
  };
  director: {
    running: boolean;
    dueAt?: number;
    cursor: number;
    pendingEvents: number;
    retryIndex: number;
    lastRunAt?: number;
    plan?: {
      id: string;
      reasons: string[];
      contextIds: string[];
      modelRequestCount: number;
      taskMode?: "plan_beat" | "transition_beat" | "player_directive";
    };
    task?: {
      mode?: "plan_beat" | "transition_beat" | "player_directive";
      objective: string;
      requiredToolNames: string[];
      toolNames: string[];
      failedToolNames: string[];
      status: "running" | "complete" | "partial" | "empty" | "error";
      retryCount: number;
      missingToolNames: string[];
    };
  };
  contexts: Array<{
    contextId: string;
    name: string;
    status: WorldContextStatus;
    actorRuntime: ResolvedWorldActorRuntimePolicy;
    activity?: ContextActivityState;
    session: Record<string, unknown>;
    presentation?: PresentationRuntimeSnapshot;
    recovery?: WorldForegroundRecoveryState;
  }>;
  actors: Array<{
    state: WorldActorState;
    background?: WorldActorBackgroundState;
    control?: WorldActorControlState;
    presences: ContextPresenceState[];
  }>;
  memory: Array<{
    runtime: ActorMemoryDebugSnapshot;
    snapshot: ActorMemorySnapshot;
  }>;
  narrative: {
    beats: NarrativeBeat[];
    edges: NarrativeEdge[];
    chapters: NarrativeChapter[];
    foregroundChapterId?: string;
  };
  tokenUsage: WorldTokenUsageSnapshot;
  events: WorldDebugEvent[];
  firstRetainedDebugSequence?: number;
  lastDebugSequence: number;
  droppedDebugEventCount: number;
}
