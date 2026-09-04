import type {
  ActorAction,
  ChatMessage,
  SessionSnapshot,
} from "./chat.js";
import type {
  ActorMemoryCandidate,
  ActorMemoryRevision,
  ActorMemoryRuntimeSnapshot,
  ActorMemorySnapshot,
} from "./actor-memory.js";
import type { WorldDebugConfig } from "./world-debug.js";
import type {
  ActorPresence,
  ActorStateSource,
  ContextParticipation,
  ContextPresenceState,
  PlayerCharacterCard,
  WorldActorBackgroundState,
  WorldActorControlPolicy,
  WorldActorControlState,
  WorldActorDefinition,
  WorldActorState,
  WorldRelation,
} from "./world/actors.js";
import type {
  NarrativeBeat,
  NarrativeEdge,
  NarrativeNarration,
  NarrativeChapter,
} from "./world/narrative.js";
import type {
  WorldSourceProvider,
} from "./world/source.js";
import type {
  PresentationParticipant,
  PresentationRuntimeSnapshot,
  PresentationTurnState,
  PlayerPerformance,
  PlayerTurnProposal,
  WorldContextPauseReason,
  WorldContextState,
  WorldContextStatus,
} from "./world/presentation.js";
import type {
  WorldActorMemoryPolicy,
  WorldContextDefinition,
  WorldDefinition,
  WorldDirectorPolicy,
} from "./world/runtime.js";
import type {
  WorldForegroundOperation,
  WorldForegroundRecoveryState,
} from "./world/foreground.js";

export type * from "./world/actors.js";
export type * from "./world/narrative.js";
export type * from "./world/presentation.js";
export type * from "./world/runtime.js";
export type * from "./world/source.js";
export type * from "./world/foreground.js";

export type WorldEventType =
  | "context.message.committed"
  | "context.action.committed"
  | "context.activated"
  | "context.suspended"
  | "actor.registered"
  | "actor.background.updated"
  | "actor.presence.changed"
  | "actor.participation.changed"
  | "actor.control.changed"
  | "actor.memory.recorded"
  | "actor.memory.revised"
  | "actor.memory.updated"
  | "relation.added"
  | "relation.updated"
  | "relation.removed"
  | "world.event.emitted"
  | "world.progression.requested"
  | "player.directive"
  | "world.time.advanced"
  | "narrative.narration.committed"
  | "narrative.beat.recorded"
  | "narrative.beat.completed"
  | "narrative.beats.linked"
  | "narrative.chapter.created"
  | "narrative.chapter.completed"
  | "narrative.chapter.activated"
  | "narrative.chapter.focus_changed";

/**
 * Durable payloads are tied to their event name. Keeping this map next to the
 * public event names prevents a producer from pairing a valid type with an
 * unrelated payload while still allowing the journal to remain generic.
 */
export interface WorldEventPayloadMap {
  "context.message.committed": {
    message: ChatMessage;
  };
  "context.action.committed": {
    action: ActorAction;
  };
  "context.activated": Record<string, never>;
  "context.suspended": Record<string, never>;
  "actor.registered": {
    kind: WorldActorDefinition["kind"];
    playerControlled: boolean;
    name: string;
    description?: string;
    lifecycle: "persistent" | "scene";
    relationCount: number;
  };
  "actor.background.updated": {
    before: WorldActorBackgroundState;
    after: WorldActorBackgroundState;
  };
  "actor.presence.changed": {
    before: WorldActorState;
    after: WorldActorState;
    source: ActorStateSource;
    reason?: string;
  };
  "actor.participation.changed": {
    before: ContextPresenceState;
    after: ContextPresenceState;
    source: ActorStateSource;
    reason?: string;
  };
  "actor.control.changed": {
    before: WorldActorControlState;
    after: WorldActorControlState;
    source: ActorStateSource;
    reason?: string;
  };
  "actor.memory.recorded": {
    nodeId: string;
    kind: string;
    sourceEventIds: string[];
  };
  "actor.memory.revised": {
    nodeId: string;
    status: string;
    sourceEventIds: string[];
  };
  "actor.memory.updated": {
    idempotencyKey: string;
    fromRevision: number;
    toRevision: number;
    createdNodeIds: string[];
    revisedNodeIds: string[];
    deletedNodeIds: string[];
    createdEdgeIds: string[];
    deletedEdgeIds: string[];
    sourceEventIds: string[];
  };
  "relation.added": {
    relation: WorldRelation;
  };
  "relation.updated": {
    before?: WorldRelation;
    after: WorldRelation;
    source: "actor_memory";
    sourceNodeId: string;
  };
  "relation.removed": {
    before: WorldRelation;
    restored?: WorldRelation;
    source: "actor_memory";
  };
  "world.event.emitted": {
    message: string;
    contextIds: string[];
    actorIds: string[];
  };
  "world.progression.requested": {
    reason: "bootstrap" | "observer_continue" | "ambient";
    chapterId?: string;
  };
  "player.directive": {
    instruction: string;
  };
  "world.time.advanced": {
    seconds: number;
    reason?: string;
    worldTime: number;
  };
  "narrative.narration.committed": {
    narration: NarrativeNarration;
  };
  "narrative.beat.recorded": {
    beat: NarrativeBeat;
    chapter: NarrativeChapter;
  };
  "narrative.beat.completed": {
    beat: NarrativeBeat;
    chapter: NarrativeChapter;
    reason: "resolved" | "superseded";
  };
  "narrative.beats.linked": {
    edge: NarrativeEdge;
  };
  "narrative.chapter.created": {
    chapter: NarrativeChapter;
  };
  "narrative.chapter.completed": {
    chapter: NarrativeChapter;
  };
  "narrative.chapter.activated": {
    chapter: NarrativeChapter;
  };
  "narrative.chapter.focus_changed": {
    fromChapterId?: string;
    toChapterId?: string;
    reason: "initial" | "continued" | "switched" | "completed";
    beatId?: string;
  };
}

/**
 * Ordered public world journal. Snapshots remain authoritative for private
 * memory and complete dynamic definitions; journal payloads cover observable
 * facts and provenance needed by projections.
 */
export type WorldEvent<TType extends WorldEventType = WorldEventType> =
  TType extends WorldEventType
    ? {
        id: string;
        worldId: string;
        sequence: number;
        type: TType;
        occurredAt: number;
        contextId?: string;
        actorId?: string;
        causationId?: string;
        correlationId?: string;
        payload: WorldEventPayloadMap[TType];
      }
    : never;

export type WorldEventInput<TType extends WorldEventType = WorldEventType> =
  TType extends WorldEventType
    ? {
        type: TType;
        contextId?: string;
        actorId?: string;
        causationId?: string;
        correlationId?: string;
        payload: WorldEventPayloadMap[TType];
      }
    : never;

export type WorldEventListener = (event: WorldEvent) => void;
export type WorldUnsubscribe = () => void;

export type WorldNotificationType =
  | "world.status_changed"
  | "context.status_changed"
  | "context.pacing_changed"
  | "context.focus_changed"
  | "context.ambient_scheduled"
  | "context.ambient_triggered"
  | "actor.wake_enqueued"
  | "actor.wake_skipped"
  | "actor.wake_settled"
  | "narrator.started"
  | "narrator.turn_selected"
  | "narrator.director_requested"
  | "narrator.completed"
  | "narrator.error"
  | "presentation.turn_queued"
  | "presentation.waiting_ack"
  | "presentation.waiting_player"
  | "presentation.acknowledged"
  | "presentation.error"
  | "director.scheduled"
  | "director.started"
  | "director.completed"
  | "director.retry_scheduled"
  | "director.error"
  | "actor_memory.scheduled"
  | "actor_memory.started"
  | "actor_memory.completed"
  | "actor_memory.retry_scheduled"
  | "actor_memory.error"
  | "provider.blocked"
  | "runtime.operation_expected"
  | "runtime.operation_started"
  | "runtime.retry_scheduled"
  | "runtime.operation_failed"
  | "runtime.operation_recovered"
  | "world.error";

export interface WorldNotificationPayloadMap {
  "world.status_changed": {
    previous: "idle" | "running" | "paused" | "stopped";
    status: "idle" | "running" | "paused" | "stopped";
  };
  "context.status_changed": {
    contextId: string;
    status: WorldContextStatus;
    pauseReason?: WorldContextPauseReason;
  };
  "context.pacing_changed": {
    contextId: string;
    pacingMultiplier: number;
    previousPacingMultiplier: number;
  };
  "context.focus_changed": {
    contextId: string;
    focusActorIds: string[];
    reason: string;
  };
  "context.ambient_scheduled": {
    contextId: string;
    dueAt: number;
    delayMs: number;
    noopCount: number;
  };
  "context.ambient_triggered": {
    contextId: string;
    noopCount: number;
  };
  "actor.wake_enqueued": {
    contextId: string;
    actorId: string;
    source: string;
    reason: string;
    requiresReply: boolean;
    priority: number;
    messageId?: string;
    beatId?: string;
  };
  "actor.wake_skipped": {
    contextId?: string;
    actorId?: string;
    source?: string;
    reason: string;
    result?: string;
    priority?: number;
    messageId?: string;
  };
  "actor.wake_settled": {
    contextId: string;
    actorId?: string;
    characterName: string;
    source: string;
    outcome: string;
    messageId?: string;
    beatId?: string;
    failure?: "provider" | "parse" | "invalid_target" | "unavailable";
  };
  "narrator.started": {
    contextId: string;
    beatId: string;
    mode: "open_beat" | "resolve_action" | "check_closure" | "redirect_scene";
    triggerSource: "player" | "actor" | "world" | "mixed";
  };
  "narrator.turn_selected": {
    contextId: string;
    beatId: string;
    participant: PresentationParticipant;
    reason?: string;
  };
  "narrator.director_requested": {
    contextId: string;
    beatId: string;
    kind: "transition_beat";
    objective: string;
    reason: string;
  };
  "narrator.completed": {
    contextId: string;
    beatId: string;
    mode: "open_beat" | "resolve_action" | "check_closure" | "redirect_scene";
    status: "continue" | "complete";
    affectedActorIds: string[];
  };
  "narrator.error": {
    contextId: string;
    beatId: string;
    mode: "open_beat" | "resolve_action" | "check_closure" | "redirect_scene";
    message: string;
  };
  "presentation.turn_queued": {
    contextId: string;
    beatId: string;
    participant: PresentationParticipant;
    entryIds: string[];
    buffered?: boolean;
  };
  "presentation.waiting_ack": {
    contextId: string;
    beatId: string;
    turn: PresentationTurnState;
    buffered?: boolean;
  };
  "presentation.waiting_player": {
    contextId: string;
    beatId: string;
    turn: PresentationTurnState;
    proposal?: PlayerTurnProposal;
    buffered?: boolean;
  };
  "presentation.acknowledged": {
    contextId: string;
    beatId: string;
    turnToken: string;
    nextTurnToken?: string;
  };
  "presentation.error": {
    contextId: string;
    beatId: string;
    message: string;
  };
  "director.scheduled": {
    dueAt: number;
    delayMs: number;
    reason: string;
    planId?: string;
    taskMode?: "plan_beat" | "transition_beat" | "player_directive";
  };
  "director.started": {
    fromSequence: number;
    throughSequence: number;
    eventCount: number;
    objective?: string;
    requiredToolNames?: string[];
    taskMode?: "plan_beat" | "transition_beat" | "player_directive";
    planId?: string;
  };
  "director.completed": {
    throughSequence: number;
    mutationCount: number;
    toolNames?: string[];
    failedToolNames?: string[];
    taskStatus?: "complete" | "partial" | "empty";
    taskRetryCount?: number;
    missingToolNames?: string[];
    planId?: string;
  };
  "director.retry_scheduled": {
    retryMs: number;
    retryIndex?: number;
    maxRetries?: number;
    planId?: string;
  };
  "director.error": {
    message: string;
  };
  "actor_memory.scheduled": {
    actorIds: string[];
    dueAt: number;
    delayMs: number;
    reason: string;
    pendingEvents: number;
  };
  "actor_memory.started": {
    actorIds: string[];
    fromSequence?: number;
    throughSequence?: number;
    eventCount: number;
  };
  "actor_memory.completed": {
    actorId: string;
    sharedBatch: boolean;
    throughSequence: number;
    operationCount: number;
    applied: boolean;
    candidateEventCount: number;
  };
  "actor_memory.retry_scheduled": {
    actorIds: string[];
    retryMs: number;
  };
  "actor_memory.error": {
    actorIds: string[];
    message: string;
  };
  "provider.blocked": {
    contextId?: string;
    operation: "director" | "narrator" | "actor" | "player" | "memory" | "compression" | "unknown";
    kind: "billing" | "authentication" | "permission" | "configuration";
    status?: number;
    code?: string;
    message: string;
    userMessage: string;
  };
  "runtime.operation_expected": { recovery: WorldForegroundRecoveryState };
  "runtime.operation_started": { recovery: WorldForegroundRecoveryState };
  "runtime.retry_scheduled": { recovery: WorldForegroundRecoveryState };
  "runtime.operation_failed": { recovery: WorldForegroundRecoveryState };
  "runtime.operation_recovered": {
    contextId: string;
    recoveryId: string;
    operation: WorldForegroundOperation;
  };
  "world.error": {
    contextId?: string;
    actorId?: string;
    operation?: string;
    source?: ActorStateSource;
    message: string;
  };
}

export type WorldNotification<TType extends WorldNotificationType = WorldNotificationType> =
  TType extends WorldNotificationType
    ? {
        worldId: string;
        sequence: number;
        occurredAt: number;
        type: TType;
        payload: WorldNotificationPayloadMap[TType];
      }
    : never;

export type WorldNotificationInput<
  TType extends WorldNotificationType = WorldNotificationType,
> = TType extends WorldNotificationType
  ? {
      type: TType;
      payload: WorldNotificationPayloadMap[TType];
    }
  : never;

export type WorldNotificationListener = (notification: WorldNotification) => void;

export interface WorldSnapshot {
  schemaVersion: 7;
  worldId: string;
  worldTime: number;
  eventSequence: number;
  events: WorldEvent[];
  actorStates: WorldActorState[];
  actorBackgrounds: WorldActorBackgroundState[];
  actorControls: WorldActorControlState[];
  /** Actors registered after the static WorldDefinition was compiled. */
  dynamicActors: WorldActorDefinition[];
  /** Contexts created at runtime (for example private/group chat surfaces). */
  dynamicContexts?: WorldContextDefinition[];
  /** Relations introduced together with dynamic actors. */
  dynamicRelations: WorldRelation[];
  /** Mutable Actor Workspace overlays, separate from shareable actor seed data. */
  actorMemories: ActorMemorySnapshot[];
  /** Pending observations and cursors keep background curation cold-restart safe. */
  actorMemoryRuntime: ActorMemoryRuntimeSnapshot[];
  presences: ContextPresenceState[];
  contexts: WorldContextState[];
  contextSessions: Array<{ contextId: string; snapshot: SessionSnapshot }>;
  presentationRuntime?: PresentationRuntimeSnapshot[];
  /** Player-visible foreground failures survive room refresh and archive restore. */
  foregroundRecovery?: WorldForegroundRecoveryState[];
  narrative: {
    beats: NarrativeBeat[];
    edges: NarrativeEdge[];
    chapters: NarrativeChapter[];
    /** Chapter currently owning the foreground story. */
    foregroundChapterId?: string;
  };
  directorCursor: number;
  timestamp: number;
  /** 增量时间线归档点;缺省(旧快照)时从零开始累积新增行。 */
  contextTimelineCheckpoints?: Array<{
    contextId: string;
    checkpoint: {
      summary: string;
      facts: string[];
      throughSequence: number;
      curatedAt: number;
    };
  }>;
}

export type WorldArchiveRuntimeStatus = "idle" | "running" | "paused" | "stopped";

export interface WorldArchiveMetadata {
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  eventSequence: number;
  worldTime: number;
  lastStatus: WorldArchiveRuntimeStatus;
  actorNames: string[];
  activeChapterTitles: string[];
  lastScene?: {
    contextId: string;
    contextName: string;
    text: string;
  };
  coverImage?: string;
}

/**
 * Portable long-running World save.
 *
 * Provider instances, API keys, debug traces, prompts, and transport state are
 * deliberately excluded. A restored archive always receives a fresh host room.
 */
export interface WorldArchive {
  schemaVersion: 1;
  archiveId: string;
  worldId: string;
  definition: WorldDefinition;
  snapshot: WorldSnapshot;
  metadata: WorldArchiveMetadata;
}

export interface CreateWorldOptions {
  snapshot?: WorldSnapshot;
  directorPolicy?: WorldDirectorPolicy;
  actorMemoryPolicy?: WorldActorMemoryPolicy;
  sourceProvider?: WorldSourceProvider;
  debug?: boolean | WorldDebugConfig;
  /** 增量时间线新增行达到该数量后触发归档折叠;默认 32,范围 1-1000。 */
  timelineCuratorMinRows?: number;
}

export interface WorldMessageInput {
  contextId: string;
  actorId: string;
  message: string;
}

export interface WorldSubmitPlayerTurnInput {
  contextId: string;
  actorId: string;
  proposalId?: string;
  performance?: PlayerPerformance;
  /** Continue the scene without committing a player message or action. */
  skip?: boolean;
}

export interface WorldAcknowledgePresentationInput {
  contextId: string;
  turnToken: string;
}

export interface WorldUpdatePlayerCardInput {
  actorId: string;
  card: PlayerCharacterCard;
}

export interface WorldRetryForegroundOperationInput {
  contextId: string;
  failureId: string;
}

export interface WorldDismissForegroundFailureInput {
  contextId: string;
  failureId: string;
}

export interface WorldCreateChatContextInput {
  /** The human Actor who owns the conversation. */
  humanActorId: string;
  /** AI Actors invited into the conversation. */
  actorIds: string[];
  conversationMode: "group" | "private";
  name?: string;
  topic?: string;
}

export interface WorldRegisterActorInput {
  actor: WorldActorDefinition;
  /** Optional relations committed with the new Actor. Every endpoint must already exist. */
  relations?: WorldRelation[];
}

export interface WorldExternalEventInput {
  message: string;
  contextIds?: string[];
  actorIds?: string[];
  correlationId?: string;
}

export interface WorldDirectionInput {
  contextId: string;
  direction: string;
}

export interface WorldProgressionInput {
  contextId: string;
  reason?: "bootstrap" | "observer_continue" | "ambient";
}

export interface WorldRecordActorMemoryInput {
  actorId: string;
  candidate: ActorMemoryCandidate;
}

export interface WorldReviseActorMemoryInput {
  actorId: string;
  revision: ActorMemoryRevision;
}

export interface WorldSetActorPresenceInput {
  actorId: string;
  presence: ActorPresence;
  /** Omit to preserve the current status; use null or an empty string to clear it. */
  status?: string | null;
  reason?: string;
}

export interface WorldSetActorParticipationInput {
  actorId: string;
  contextId: string;
  participation: ContextParticipation;
  reason?: string;
}

export interface WorldUpdateActorControlPolicyInput {
  actorId: string;
  policy: WorldActorControlPolicy;
}
