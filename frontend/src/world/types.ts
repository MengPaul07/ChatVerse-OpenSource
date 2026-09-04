import type {
  NarrativeBeat,
  NarrativeEdge,
  NarrativeNarration,
  NarrativeChapter,
  ContextActivityState,
  ResolvedWorldActorRuntimePolicy,
  WorldEvent,
  WorldNotification,
  WorldArchive,
  ActorVisualProfile,
  GalgamePresentationConfig,
  PlayerTurnProposal,
  PresentationTurnState,
  WorldForegroundRecoveryState,
  ProviderProtocol,
} from "@chatverse/core";
export type { WorldForegroundRecoveryState } from "@chatverse/core";

export type DirectorViewStatus = "idle" | "scheduled" | "running" | "error";

export interface WorldViewEntry {
  id: string;
  sequence: number;
  kind: "character" | "human" | "action" | "narration" | "directive";
  actorId?: string;
  actorName?: string;
  text: string;
  occurredAt: number;
  contextId?: string;
  sourceEventIds?: string[];
}

export type WorldViewBeat = NarrativeBeat & {
  /** Sequence of the narrative.beat.recorded event in the World journal. */
  sequence: number;
};

export interface WorldProviderIssue {
  contextId?: string;
  operation: "director" | "narrator" | "actor" | "player" | "memory" | "compression" | "unknown";
  kind: "billing" | "authentication" | "permission" | "configuration";
  status?: number;
  code?: string;
  message: string;
  userMessage: string;
  occurredAt: number;
}

export interface WorldView {
  roomId: string;
  world: {
    id: string;
    archiveId: string;
    name: string;
    description?: string;
    status: "idle" | "running" | "paused" | "stopped";
    worldTime: number;
    eventSequence: number;
  };
  runtime: {
    directorEnabled: boolean;
    actorMemoryEnabled: boolean;
    providerIssue?: WorldProviderIssue;
    room: {
      viewerCount: number;
      autoPauseEnabled: boolean;
      autoPauseAfterMs?: number;
      autoPauseDueAt?: number;
      autoPausedAt?: number;
    };
  };
  contexts: Array<{
    id: string;
    name: string;
    conversationMode?: "group" | "private";
    actorIds: string[];
    status: "dormant" | "active" | "paused" | "stopped";
    pauseReason?: "manual" | "unread" | "unobserved";
    unreadCount?: number;
    pacingMultiplier: number;
    scene: NarrativeNarration;
    actorRuntime: ResolvedWorldActorRuntimePolicy;
    activity?: ContextActivityState;
    presentation?: GalgamePresentationConfig;
    presentationTurn?: PresentationTurnState;
    presentationMode: "world" | "stage";
    presentationPrefetchLimit: number;
    bufferedPresentationCount?: number;
    playerProposal?: PlayerTurnProposal;
    recovery?: WorldForegroundRecoveryState;
  }>;
  actors: Array<{
    id: string;
    name: string;
    kind: "character";
    playerControlled: boolean;
    description?: string;
    presence?: "online" | "away" | "offline";
    status?: string;
    availability: "available" | "away" | "unavailable";
    control?: {
      directorAuthority: "observe" | "coordinate" | "manage";
    };
    contexts?: Array<{
      contextId: string;
      participation: "joined" | "muted" | "left";
    }>;
    visual?: ActorVisualProfile;
    playerCardComplete?: boolean;
    playerCard?: import("@chatverse/core").PlayerCharacterCard;
  }>;
  entries: WorldViewEntry[];
  narrative: {
    beats: WorldViewBeat[];
    edges: NarrativeEdge[];
    chapters: NarrativeChapter[];
    foregroundChapterId?: string;
  };
  director: {
    status: DirectorViewStatus;
    dueAt?: number;
    reason?: string;
    error?: string;
    objective?: string;
    taskMode?: "plan_beat" | "transition_beat" | "player_directive";
    requiredToolNames?: string[];
    toolNames?: string[];
    failedToolNames?: string[];
    taskStatus?: "complete" | "partial" | "empty";
    taskRetryCount?: number;
    missingToolNames?: string[];
  };
  lastStreamSequence: number;
}

export type WorldStreamPayload =
  | { sequence: number; kind: "world_event"; event: WorldEvent }
  | { sequence: number; kind: "world_notification"; notification: WorldNotification }
  | { sequence: number; kind: "usage_recorded"; record: TokenUsageRecord }
  | {
      sequence: number;
      kind: "context_runtime";
      contextId: string;
      unreadCount: number;
      status: "dormant" | "active" | "paused" | "stopped";
      pauseReason?: "manual" | "unread" | "unobserved";
    }
  | { sequence: number; kind: "resync_required" };

export interface TokenUsageRecord {
  schemaVersion: 1;
  id: string;
  occurredAt: number;
  providerRole: "character" | "history_compression" | "world_director" | "world_narrator" | "player_actor" | "actor_memory" | "world_authoring" | "world_authoring_research";
  operation: "complete" | "stream" | "chat" | "research";
  purpose?: "world_director" | "world_narrator" | "actor_decision" | "actor_response" | "player_actor" | "actor_memory" | "world_authoring" | "world_authoring_research" | "history_compression" | "other";
  provider?: string;
  model?: string;
  protocol?: ProviderProtocol;
  worldId: string;
  worldName: string;
  roomId: string;
  contextId?: string;
  actorId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheMetricsReported: boolean;
}

export interface ApiResponse {
  ok: boolean;
  roomId?: string;
  contextId?: string;
  view?: WorldView;
  code?: string;
  message?: string;
  archive?: WorldArchive;
}
