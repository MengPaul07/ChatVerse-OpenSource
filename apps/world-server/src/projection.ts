import type {
  ActorAction,
  ChatMessage,
  NarrativeNarration,
  World,
  WorldDefinition,
  WorldEvent,
  WorldNotification,
} from "@chatverse/core";
import type {
  DirectorViewStatus,
  PublicActorDefinition,
  PublicContextDefinition,
  WorldRoomRuntimeState,
  WorldView,
  WorldViewEntry,
} from "./types.js";

export interface DirectorProjection {
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
}

export function publicDefinitions(definition: WorldDefinition): {
  actors: PublicActorDefinition[];
  contexts: PublicContextDefinition[];
} {
  return {
    actors: definition.actors.map((actor) => ({
      id: actor.id,
      name: actor.card.name,
      kind: actor.kind,
      playerControlled: actor.playerControlled === true,
      description: actor.card.description,
      visual: actor.card.visual,
      playerCardComplete: actor.playerControlled === true
        ? isPlayerCardComplete(actor.playerCard)
        : undefined,
      playerCard: actor.playerControlled === true && actor.playerCard
        ? structuredClone(actor.playerCard)
        : undefined,
    })),
    contexts: definition.contexts.map((context) => ({
      id: context.id,
      name: context.name,
      conversationMode: context.conversationMode,
      actorIds: [...context.actorIds],
      actorRuntime: context.runtime?.actorRuntime
        ? { ...context.runtime.actorRuntime }
        : undefined,
      presentation: context.presentation ? { ...context.presentation } : undefined,
    })),
  };
}

export function projectWorldView(input: {
  roomId: string;
  world: World;
  definition: WorldDefinition;
  archiveId: string;
  director: DirectorProjection;
  lastStreamSequence: number;
  roomRuntime: WorldRoomRuntimeState;
  providerIssue?: import("./types.js").WorldProviderIssue;
  contextAttention?: ReadonlyMap<string, { unreadCount: number }>;
}): WorldView {
  const snapshot = input.world.snapshot();
  const contextDefinitions = [
    ...input.definition.contexts,
    ...(snapshot.dynamicContexts ?? []).filter((context) => (
      !input.definition.contexts.some((candidate) => candidate.id === context.id)
    )),
  ];
  const definitions = publicDefinitions({
    ...input.definition,
    contexts: contextDefinitions,
    actors: [
      ...input.definition.actors,
      ...snapshot.dynamicActors,
    ],
  });
  const actorById = new Map(definitions.actors.map((actor) => [actor.id, actor]));
  const contextById = new Map(definitions.contexts.map((context) => [context.id, context]));
  const sourceContextById = new Map(contextDefinitions.map((context) => [context.id, context]));
  const presentationByContext = new Map((snapshot.presentationRuntime ?? []).map((state) => [state.contextId, state]));
  const hiddenPresentationEntryIds = new Set(
    (snapshot.presentationRuntime ?? []).flatMap((state) => state.buffered.flatMap((turn) => turn.entryIds)),
  );
  const recoveryByContext = new Map((snapshot.foregroundRecovery ?? []).map((state) => [state.contextId, state]));
  const beatSequenceById = new Map<string, number>();
  for (const event of snapshot.events) {
    if (event.type !== "narrative.beat.recorded") continue;
    beatSequenceById.set(event.payload.beat.id, event.sequence);
  }
  const visibleBeats = snapshot.narrative.beats.filter((beat) => beat.status !== "prepared");

  return {
    roomId: input.roomId,
    world: {
      id: input.definition.metadata.id,
      archiveId: input.archiveId,
      name: input.definition.metadata.name,
      description: input.definition.metadata.description,
      status: input.world.status,
      worldTime: snapshot.worldTime,
      eventSequence: snapshot.eventSequence,
    },
    runtime: {
      directorEnabled: input.definition.directorPolicy?.enabled !== false,
      actorMemoryEnabled: input.definition.actorMemoryPolicy?.enabled === true,
      room: { ...input.roomRuntime },
      providerIssue: input.providerIssue ? { ...input.providerIssue } : undefined,
    },
    contexts: snapshot.contexts.map((context) => ({
      id: context.contextId,
      name: contextById.get(context.contextId)?.name ?? context.contextId,
      conversationMode: contextById.get(context.contextId)?.conversationMode,
      actorIds: [...(contextById.get(context.contextId)?.actorIds ?? [])],
      status: context.status,
      pauseReason: context.pauseReason,
      unreadCount: input.contextAttention?.get(context.contextId)?.unreadCount ?? 0,
      pacingMultiplier: input.world.getContextPacingMultiplier(context.contextId),
      scene: context.scene,
      actorRuntime: resolveActorRuntimeView(
        contextById.get(context.contextId)?.actorRuntime,
        input.definition.directorPolicy?.enabled !== false,
      ),
      activity: context.activity
        ? { ...context.activity, focusActorIds: [...context.activity.focusActorIds] }
        : undefined,
      recovery: recoveryByContext.has(context.contextId)
        ? structuredClone(recoveryByContext.get(context.contextId))
        : undefined,
      presentation: contextById.get(context.contextId)?.presentation,
      presentationTurn: presentationByContext.get(context.contextId)?.current,
      presentationMode: presentationByContext.get(context.contextId)?.mode ?? "world",
      presentationPrefetchLimit: sourceContextById.get(context.contextId)?.runtime?.beatRuntime?.presentationPrefetchLimit ?? 5,
      bufferedPresentationCount: presentationByContext.get(context.contextId)?.buffered.length ?? 0,
      playerProposal: presentationByContext.get(context.contextId)?.current?.status === "waiting_player"
        ? presentationByContext.get(context.contextId)?.playerProposal
        : undefined,
    })),
    actors: snapshot.actorStates.map((state) => {
      const definition = actorById.get(state.actorId);
      const control = snapshot.actorControls.find((item) => item.actorId === state.actorId);
      return {
        id: state.actorId,
        name: definition?.name ?? state.actorId,
        kind: definition?.kind ?? "character",
        playerControlled: definition?.playerControlled ?? false,
        description: definition?.description,
        visual: definition?.visual,
        playerCardComplete: definition?.playerCardComplete,
        playerCard: definition?.playerCard ? structuredClone(definition.playerCard) : undefined,
        presence: state.presence,
        status: state.status,
        availability: state.presence === "online"
          ? "available"
          : state.presence === "offline"
            ? "unavailable"
            : "away",
        control: {
          directorAuthority: control?.policy.directorAuthority ?? (
            definition?.playerControlled ? "observe" : "coordinate"
          ),
        },
        contexts: snapshot.presences
          .filter((presence) => presence.actorId === state.actorId)
          .map((presence) => ({
            contextId: presence.contextId,
            participation: presence.participation,
          })),
      };
    }),
    entries: snapshot.events
      .map((event) => eventToEntry(event, actorById))
      .filter((entry): entry is WorldViewEntry => entry !== undefined && !hiddenPresentationEntryIds.has(entry.id)),
    narrative: {
      ...snapshot.narrative,
      beats: visibleBeats.map((beat) => ({
        ...beat,
        sequence: beatSequenceById.get(beat.id) ?? 0,
      })),
    },
    director: { ...input.director },
    lastStreamSequence: input.lastStreamSequence,
  };
}

function resolveActorRuntimeView(
  input: import("@chatverse/core").WorldActorRuntimePolicy | undefined,
  directorEnabled: boolean,
): import("@chatverse/core").ResolvedWorldActorRuntimePolicy {
  const activation = input?.activation ?? (
    directorEnabled ? "beat_runtime" : "autonomous_idle"
  );
  return {
    activation,
    playerRouting: input?.playerRouting ?? "focus_actor",
    ambient: input?.ambient ?? (activation === "beat_runtime" ? "low" : "off"),
  };
}

export function updateDirectorProjection(
  current: DirectorProjection,
  notification: WorldNotification,
): DirectorProjection {
  switch (notification.type) {
    case "director.scheduled":
      return {
        status: "scheduled",
        dueAt: numberValue(notification.payload.dueAt),
        reason: stringValue(notification.payload.reason),
        taskMode: notification.payload.taskMode,
      };
    case "director.started":
      return {
        ...current,
        status: "running",
        objective: notification.payload.objective,
        taskMode: notification.payload.taskMode,
        requiredToolNames: notification.payload.requiredToolNames,
        toolNames: undefined,
        failedToolNames: undefined,
        taskStatus: undefined,
        taskRetryCount: undefined,
        missingToolNames: undefined,
        error: undefined,
      };
    case "director.completed":
      return {
        ...current,
        status: "idle",
        toolNames: notification.payload.toolNames,
        failedToolNames: notification.payload.failedToolNames,
        taskStatus: notification.payload.taskStatus,
        taskRetryCount: notification.payload.taskRetryCount,
        missingToolNames: notification.payload.missingToolNames,
        error: undefined,
      };
    case "director.retry_scheduled":
      return {
        ...current,
        status: "scheduled",
        dueAt: notification.occurredAt + (numberValue(notification.payload.retryMs) ?? 0),
        reason: "retry",
      };
    case "director.error":
      return {
        status: "error",
        error: stringValue(notification.payload.message) ?? "Director failed",
      };
    case "world.status_changed":
      return notification.payload.status === "stopped"
        ? { status: "idle" }
        : current;
    default:
      return current;
  }
}

function eventToEntry(
  event: WorldEvent,
  actorById: ReadonlyMap<string, PublicActorDefinition>,
): WorldViewEntry | undefined {
  if (event.type === "context.message.committed") {
    const message = objectValue(event.payload.message) as Partial<ChatMessage> | undefined;
    if (!message || typeof message.message !== "string") return undefined;
    const actor = event.actorId ? actorById.get(event.actorId) : undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: message.source === "human" ? "human" : "character",
      actorId: event.actorId,
      actorName: actor?.name ?? message.characterName,
      text: message.message,
      occurredAt: event.occurredAt,
      contextId: event.contextId,
    };
  }

  if (event.type === "context.action.committed") {
    const action = objectValue(event.payload.action) as Partial<ActorAction> | undefined;
    if (!action || typeof action.action !== "string") return undefined;
    const actor = event.actorId ? actorById.get(event.actorId) : undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: "action",
      actorId: event.actorId,
      actorName: actor?.name ?? action.characterName,
      text: action.action,
      occurredAt: action.timestamp ?? event.occurredAt,
      contextId: event.contextId,
    };
  }

  if (event.type === "narrative.narration.committed") {
    const narration = objectValue(event.payload.narration) as Partial<NarrativeNarration> | undefined;
    if (!narration || typeof narration.text !== "string") return undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: "narration",
      text: narration.text,
      occurredAt: narration.occurredAt ?? event.occurredAt,
      contextId: narration.contextId ?? event.contextId,
      sourceEventIds: Array.isArray(narration.sourceEventIds)
        ? narration.sourceEventIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  }

  if (event.type === "player.directive") {
    const instruction = stringValue(event.payload.instruction);
    if (!instruction) return undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: "directive",
      actorId: event.actorId,
      actorName: event.actorId ? actorById.get(event.actorId)?.name : undefined,
      text: instruction,
      occurredAt: event.occurredAt,
    };
  }

  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPlayerCardComplete(card: import("@chatverse/core").PlayerCharacterCard | undefined): boolean {
  if (!card) return false;
  return [card.name, card.identity, card.background, card.personality, card.appearance, card.speechStyle, card.boundaries]
    .every((value) => Boolean(value.trim()));
}
