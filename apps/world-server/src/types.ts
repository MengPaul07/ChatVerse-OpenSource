import type {
  NarrativeBeat,
  NarrativeEdge,
  NarrativeNarration,
  NarrativeChapter,
  ContextActivityState,
  ProviderRequestContext,
  ProviderUsageOperation,
  ProviderUsageRole,
  ResolvedWorldActorRuntimePolicy,
  WorldEvent,
  WorldDebugEvent,
  WorldDebugSnapshot,
  WorldNotification,
  WorldSnapshot,
} from "@chatverse/core";

export type PublicWorldStatus = "idle" | "running" | "paused" | "stopped";
export type DirectorViewStatus = "idle" | "scheduled" | "running" | "error";
export type WorldForegroundRecoveryView = NonNullable<WorldSnapshot["foregroundRecovery"]>[number];

export interface TokenUsageRecord {
  schemaVersion: 1;
  id: string;
  occurredAt: number;
  providerRole: ProviderUsageRole;
  operation: ProviderUsageOperation;
  purpose?: ProviderRequestContext["purpose"];
  provider?: string;
  model?: string;
  protocol?: import("@chatverse/core").ProviderProtocol;
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

export interface WorldRoomRuntimeState {
  viewerCount: number;
  autoPauseEnabled: boolean;
  autoPauseAfterMs?: number;
  autoPauseDueAt?: number;
  autoPausedAt?: number;
}

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
    status: PublicWorldStatus;
    worldTime: number;
    eventSequence: number;
  };
  runtime: {
    directorEnabled: boolean;
    actorMemoryEnabled: boolean;
    room: WorldRoomRuntimeState;
    providerIssue?: WorldProviderIssue;
  };
  contexts: Array<{
    id: string;
    name: string;
    conversationMode?: "group" | "private";
    actorIds: string[];
    status: "dormant" | "active" | "paused" | "stopped";
    pauseReason?: "manual" | "unread" | "unobserved";
    unreadCount: number;
    pacingMultiplier: number;
    scene: NarrativeNarration;
    actorRuntime: ResolvedWorldActorRuntimePolicy;
    activity?: ContextActivityState;
    recovery?: WorldForegroundRecoveryView;
    presentation?: import("@chatverse/core").GalgamePresentationConfig;
    presentationTurn?: import("@chatverse/core").PresentationTurnState;
    presentationMode: "world" | "stage";
    presentationPrefetchLimit: number;
    bufferedPresentationCount?: number;
    playerProposal?: import("@chatverse/core").PlayerTurnProposal;
  }>;
  actors: Array<{
    id: string;
    name: string;
    kind: "character";
    playerControlled: boolean;
    description?: string;
    presence: "online" | "away" | "offline";
    status?: string;
    availability: "available" | "away" | "unavailable";
    control: {
      directorAuthority: "observe" | "coordinate" | "manage";
    };
    contexts: Array<{
      contextId: string;
      participation: "joined" | "muted" | "left";
    }>;
    visual?: import("@chatverse/core").ActorVisualProfile;
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
  | {
      sequence: number;
      kind: "world_event";
      event: WorldEvent;
    }
  | {
      sequence: number;
      kind: "world_notification";
      notification: WorldNotification;
    }
  | {
      sequence: number;
      kind: "usage_recorded";
      record: TokenUsageRecord;
    }
  | {
      sequence: number;
      kind: "context_runtime";
      contextId: string;
      unreadCount: number;
      status: "dormant" | "active" | "paused" | "stopped";
      pauseReason?: "manual" | "unread" | "unobserved";
    }
  | {
      sequence: number;
      kind: "resync_required";
    };

export interface WorldDebugView {
  roomId: string;
  snapshot: WorldDebugSnapshot;
  actors: WorldView["actors"];
  transport: {
    debugClientCount: number;
    lastDebugSequence: number;
  };
}

export interface WorldDebugStreamPayload {
  sequence: number;
  kind: "debug_event";
  event: WorldDebugEvent;
}

export interface PublicActorDefinition {
  id: string;
  name: string;
  kind: "character";
  playerControlled: boolean;
  description?: string;
  visual?: import("@chatverse/core").ActorVisualProfile;
  playerCardComplete?: boolean;
  playerCard?: import("@chatverse/core").PlayerCharacterCard;
}

export interface PublicContextDefinition {
  id: string;
  name: string;
  conversationMode?: "group" | "private";
  actorIds: string[];
  actorRuntime?: import("@chatverse/core").WorldActorRuntimePolicy;
  presentation?: import("@chatverse/core").GalgamePresentationConfig;
}
