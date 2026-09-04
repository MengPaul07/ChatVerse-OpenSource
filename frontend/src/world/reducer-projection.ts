import type {
  ActorAction,
  ChatMessage,
  NarrativeBeat,
  NarrativeEdge,
  NarrativeNarration,
  NarrativeChapter,
  WorldEvent,
  WorldNotification,
} from "@chatverse/core";
import type { WorldForegroundRecoveryState, WorldView, WorldViewBeat, WorldViewEntry } from "./types";

export function normalizeView(view: WorldView): WorldView {
  return {
    ...view,
    contexts: view.contexts.map((context) => ({
      ...context,
      unreadCount: context.unreadCount ?? 0,
    })),
    entries: dedupeById(view.entries).sort((left, right) => left.sequence - right.sequence),
    narrative: {
      beats: dedupeById(view.narrative.beats),
      edges: dedupeById(view.narrative.edges),
      chapters: dedupeById(view.narrative.chapters),
    },
  };
}

export function applyWorldEvent(
  view: WorldView,
  streamSequence: number,
  event: WorldEvent,
): WorldView {
  let next: WorldView = {
    ...view,
    world: {
      ...view.world,
      eventSequence: Math.max(view.world.eventSequence, event.sequence),
    },
    lastStreamSequence: streamSequence,
  };
  const entry = eventToEntry(event, view);
  if (entry) {
    next = {
      ...next,
      entries: appendUnique(view.entries, entry),
    };
  }

  switch (event.type) {
    case "context.activated":
    case "context.suspended":
      next = {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === event.contextId
            ? { ...context, status: event.type === "context.activated" ? "active" : "dormant" }
            : context
        )),
      };
      break;
    case "narrative.narration.committed": {
      const narration = readNarration(event);
      if (!narration) break;
      next = {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === event.contextId
            ? { ...context, scene: narration }
            : context
        )),
      };
      break;
    }
    case "actor.registered": {
      if (!event.actorId || next.actors.some((actor) => actor.id === event.actorId)) break;
      const playerControlled = event.payload.playerControlled === true;
      next = {
        ...next,
        actors: [
          ...next.actors,
          {
            id: event.actorId,
            name: stringValue(event.payload.name) ?? event.actorId,
            kind: "character",
            playerControlled,
            description: stringValue(event.payload.description),
            presence: "online",
            availability: "available",
            control: {
              directorAuthority: playerControlled ? "observe" : "coordinate",
            },
            contexts: [],
          },
        ],
      };
      break;
    }
    case "actor.presence.changed": {
      const after = objectValue(event.payload.after);
      const presence = stringValue(after.presence);
      const mapped = presence === "online"
        ? "available"
        : presence === "offline"
          ? "unavailable"
          : presence === "away"
            ? "away"
            : undefined;
      next = {
        ...next,
        actors: next.actors.map((actor) => (
          actor.id === event.actorId && mapped
            ? {
                ...actor,
                availability: mapped,
                presence: presence as "online" | "away" | "offline",
                status: stringValue(after.status),
              }
            : actor
        )),
      };
      break;
    }
    case "actor.participation.changed": {
      const after = objectValue(event.payload.after);
      const participation = stringValue(after.participation);
      if (
        event.contextId &&
        (participation === "joined" || participation === "muted" || participation === "left")
      ) {
        next = {
          ...next,
          actors: next.actors.map((actor) => actor.id === event.actorId
            ? {
                ...actor,
                contexts: [
                  ...(actor.contexts ?? []).filter(
                    (item) => item.contextId !== event.contextId,
                  ),
                  { contextId: event.contextId!, participation },
                ],
              }
            : actor),
        };
      }
      break;
    }
    case "actor.control.changed": {
      const after = objectValue(event.payload.after);
      const policy = objectValue(after.policy);
      const authority = stringValue(policy.directorAuthority);
      next = {
        ...next,
        actors: next.actors.map((actor) => actor.id === event.actorId
          ? {
              ...actor,
              control: {
                directorAuthority: authority === "observe" || authority === "coordinate" || authority === "manage"
                  ? authority
                  : actor.control?.directorAuthority ?? "coordinate",
              },
            }
          : actor),
      };
      break;
    }
    case "world.time.advanced": {
      const worldTime = numberValue(event.payload.worldTime);
      if (worldTime != null) next = { ...next, world: { ...next.world, worldTime } };
      break;
    }
    case "narrative.beat.recorded": {
      const beat = objectValue(event.payload.beat) as unknown as NarrativeBeat;
      const chapter = objectValue(event.payload.chapter) as unknown as NarrativeChapter;
      if (beat?.id) {
        const projectedBeat: WorldViewBeat = { ...beat, sequence: event.sequence };
        next = {
          ...next,
          narrative: {
            ...next.narrative,
            beats: appendUnique(next.narrative.beats, projectedBeat),
            chapters: chapter?.id
              ? upsertById(next.narrative.chapters, chapter)
              : next.narrative.chapters,
          },
        };
      }
      break;
    }
    case "narrative.beat.completed": {
      const beat = objectValue(event.payload.beat) as unknown as NarrativeBeat;
      const chapter = objectValue(event.payload.chapter) as unknown as NarrativeChapter;
      if (!beat?.id || !chapter?.id) break;
      const recordedSequence = next.narrative.beats.find((candidate) => candidate.id === beat.id)?.sequence
        ?? event.sequence;
      next = {
        ...next,
        narrative: {
          ...next.narrative,
          beats: upsertById(next.narrative.beats, { ...beat, sequence: recordedSequence }),
          chapters: upsertById(next.narrative.chapters, chapter),
        },
      };
      break;
    }
    case "narrative.beats.linked": {
      const edge = objectValue(event.payload.edge) as unknown as NarrativeEdge;
      if (edge?.id) {
        next = {
          ...next,
          narrative: { ...next.narrative, edges: appendUnique(next.narrative.edges, edge) },
        };
      }
      break;
    }
    case "narrative.chapter.created":
    case "narrative.chapter.completed":
    case "narrative.chapter.activated": {
      const chapter = objectValue(event.payload.chapter) as unknown as NarrativeChapter;
      if (chapter?.id) {
        next = {
          ...next,
          narrative: {
            ...next.narrative,
            chapters: upsertById(next.narrative.chapters, chapter),
          },
        };
      }
      break;
    }
    case "narrative.chapter.focus_changed": {
      const toChapterId = stringValue(event.payload.toChapterId);
      next = {
        ...next,
        narrative: {
          ...next.narrative,
          foregroundChapterId: toChapterId,
        },
      };
      break;
    }
  }
  return next;
}

export function applyWorldNotification(
  view: WorldView,
  streamSequence: number,
  notification: WorldNotification,
): WorldView {
  const next = { ...view, lastStreamSequence: streamSequence };
  switch (notification.type) {
    case "provider.blocked": {
      return {
        ...next,
        runtime: {
          ...next.runtime,
          providerIssue: {
            ...notification.payload,
            occurredAt: notification.occurredAt,
          },
        },
      };
    }
    case "world.status_changed": {
      const status = worldStatus(notification.payload.status);
      return status ? { ...next, world: { ...next.world, status } } : next;
    }
    case "context.status_changed": {
      const contextId = stringValue(notification.payload.contextId);
      const status = contextStatus(notification.payload.status);
      if (!contextId || !status) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === contextId
            ? {
                ...context,
                status,
                pauseReason: status === "paused"
                  ? notification.payload.pauseReason
                  : undefined,
              }
            : context
        )),
      };
    }
    case "context.pacing_changed": {
      const contextId = stringValue(notification.payload.contextId);
      const pacingMultiplier = numberValue(notification.payload.pacingMultiplier);
      if (!contextId || pacingMultiplier == null) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === contextId ? { ...context, pacingMultiplier } : context
        )),
      };
    }
    case "context.focus_changed": {
      const contextId = stringValue(notification.payload.contextId);
      const focusActorIds = stringArrayValue(notification.payload.focusActorIds);
      if (!contextId) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === contextId
            ? {
                ...context,
                activity: {
                  revision: (context.activity?.revision ?? 0) + 1,
                  focusActorIds,
                  lastCommittedAt: context.activity?.lastCommittedAt ?? notification.occurredAt,
                  ambientNoopCount: context.activity?.ambientNoopCount ?? 0,
                  nextAmbientAt: context.activity?.nextAmbientAt,
                },
              }
            : context
        )),
      };
    }
    case "context.ambient_scheduled": {
      const contextId = stringValue(notification.payload.contextId);
      const dueAt = numberValue(notification.payload.dueAt);
      const noopCount = numberValue(notification.payload.noopCount) ?? 0;
      if (!contextId) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === contextId
            ? {
                ...context,
                activity: {
                  revision: context.activity?.revision ?? 0,
                  focusActorIds: context.activity?.focusActorIds ?? [],
                  lastCommittedAt: context.activity?.lastCommittedAt ?? notification.occurredAt,
                  ambientNoopCount: noopCount,
                  nextAmbientAt: dueAt,
                },
              }
            : context
        )),
      };
    }
    case "context.ambient_triggered": {
      const contextId = stringValue(notification.payload.contextId);
      if (!contextId) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === contextId && context.activity
            ? { ...context, activity: { ...context.activity, nextAmbientAt: undefined } }
            : context
        )),
      };
    }
    case "runtime.operation_expected":
    case "runtime.operation_started":
    case "runtime.retry_scheduled":
    case "runtime.operation_failed": {
      const recovery = objectValue(notification.payload.recovery) as unknown as WorldForegroundRecoveryState;
      if (!recovery?.id || !recovery.contextId) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => context.id === recovery.contextId
          ? { ...context, recovery }
          : context),
      };
    }
    case "runtime.operation_recovered": {
      const contextId = stringValue(notification.payload.contextId);
      const recoveryId = stringValue(notification.payload.recoveryId);
      if (!contextId || !recoveryId) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => (
          context.id === contextId && context.recovery?.id === recoveryId
            ? { ...context, recovery: undefined }
            : context
        )),
      };
    }
    case "presentation.waiting_ack": {
      const contextId = stringValue(notification.payload.contextId);
      const presentation = objectValue(notification.payload.turn) as unknown as import("@chatverse/core").PresentationTurnState;
      if (!contextId || !presentation?.turnToken) return next;
      const buffered = notification.payload.buffered === true;
      return {
        ...next,
        contexts: next.contexts.map((context) => context.id === contextId
          ? buffered
            ? {
                ...context,
                bufferedPresentationCount: (context.bufferedPresentationCount ?? 0) + 1,
              }
            : {
                ...context,
                presentationTurn: presentation,
                bufferedPresentationCount: Math.max(0, (context.bufferedPresentationCount ?? 0) - 1),
                playerProposal: undefined,
              }
          : context),
      };
    }
    case "presentation.waiting_player": {
      const contextId = stringValue(notification.payload.contextId);
      const proposal = objectValue(notification.payload.proposal) as unknown as import("@chatverse/core").PlayerTurnProposal;
      const presentation = objectValue(notification.payload.turn) as unknown as import("@chatverse/core").PresentationTurnState;
      const buffered = notification.payload.buffered === true;
      if (!contextId) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => context.id === contextId
          ? buffered
              ? {
                ...context,
                bufferedPresentationCount: (context.bufferedPresentationCount ?? 0) + 1,
              }
            : {
              ...context,
              presentationTurn: presentation?.turnToken ? presentation : {
                turnToken: `player:${proposal?.id ?? notification.sequence}`,
                contextId,
                beatId: stringValue(notification.payload.beatId) ?? "",
                participant: {
                  type: "player",
                  actorId: context.actorIds.find((actorId) => next.actors.some(
                    (actor) => actor.id === actorId && actor.playerControlled,
                  )) ?? "player",
                },
                entryIds: [],
                status: "waiting_player",
              },
              bufferedPresentationCount: Math.max(0, (context.bufferedPresentationCount ?? 0) - 1),
              playerProposal: proposal?.id ? proposal : undefined,
            }
          : context),
      };
    }
    case "presentation.acknowledged": {
      const contextId = stringValue(notification.payload.contextId);
      if (!contextId) return next;
      if (notification.payload.nextTurnToken) return next;
      return {
        ...next,
        contexts: next.contexts.map((context) => context.id === contextId
          ? {
              ...context,
              presentationTurn: undefined,
              bufferedPresentationCount: 0,
              playerProposal: undefined,
            }
          : context),
      };
    }
    case "presentation.error": {
      return next;
    }
    case "director.scheduled":
      return {
        ...next,
        director: {
          status: "scheduled",
          dueAt: numberValue(notification.payload.dueAt),
          reason: stringValue(notification.payload.reason),
        },
      };
    case "director.started":
      return {
        ...next,
        director: {
          ...next.director,
          status: "running",
          objective: notification.payload.objective,
          requiredToolNames: notification.payload.requiredToolNames,
          toolNames: undefined,
          failedToolNames: undefined,
          taskStatus: undefined,
          taskRetryCount: undefined,
          missingToolNames: undefined,
          error: undefined,
        },
      };
    case "director.completed":
      return {
        ...next,
        director: {
          ...next.director,
          status: "idle",
          toolNames: notification.payload.toolNames,
          failedToolNames: notification.payload.failedToolNames,
          taskStatus: notification.payload.taskStatus,
          taskRetryCount: notification.payload.taskRetryCount,
          missingToolNames: notification.payload.missingToolNames,
          error: undefined,
        },
      };
    case "director.retry_scheduled":
      return {
        ...next,
        director: {
          status: "scheduled",
          dueAt: notification.occurredAt + (numberValue(notification.payload.retryMs) ?? 0),
          reason: "retry",
        },
      };
    case "director.error":
      return {
        ...next,
        director: {
          status: "error",
          error: stringValue(notification.payload.message) ?? "Director 运行失败",
        },
      };
    default:
      return next;
  }
}

function eventToEntry(event: WorldEvent, view: WorldView): WorldViewEntry | undefined {
  if (event.type === "context.message.committed") {
    const message = objectValue(event.payload.message) as Partial<ChatMessage>;
    if (typeof message.message !== "string") return undefined;
    const actor = view.actors.find((candidate) => candidate.id === event.actorId);
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
    const action = objectValue(event.payload.action) as Partial<ActorAction>;
    if (typeof action.action !== "string") return undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: "action",
      actorId: event.actorId,
      actorName: view.actors.find((actor) => actor.id === event.actorId)?.name ?? action.characterName,
      text: action.action,
      occurredAt: action.timestamp ?? event.occurredAt,
      contextId: event.contextId,
    };
  }
  if (event.type === "narrative.narration.committed") {
    const narration = readNarration(event);
    if (!narration) return undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: "narration",
      text: narration.text,
      occurredAt: narration.occurredAt ?? event.occurredAt,
      contextId: narration.contextId ?? event.contextId,
      sourceEventIds: narration.sourceEventIds ?? [],
    };
  }
  if (event.type === "player.directive") {
    const text = stringValue(event.payload.instruction);
    if (!text) return undefined;
    return {
      id: event.id,
      sequence: event.sequence,
      kind: "directive",
      actorId: event.actorId,
      actorName: view.actors.find((actor) => actor.id === event.actorId)?.name,
      text,
      occurredAt: event.occurredAt,
    };
  }
  return undefined;
}

function readNarration(
  event: Extract<WorldEvent, { type: "narrative.narration.committed" }>,
): NarrativeNarration | undefined {
  const value = objectValue(event.payload.narration) as Partial<NarrativeNarration>;
  if (
    typeof value.id !== "string" ||
    typeof value.contextId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.occurredAt !== "number"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    contextId: value.contextId,
    text: value.text,
    sourceEventIds: Array.isArray(value.sourceEventIds)
      ? value.sourceEventIds.filter((item): item is string => typeof item === "string")
      : [],
    occurredAt: value.occurredAt,
  };
}

function appendUnique<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((candidate) => candidate.id === item.id) ? items : [...items, item];
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((candidate, candidateIndex) => candidateIndex === index ? item : candidate);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}


function worldStatus(value: unknown): WorldView["world"]["status"] | undefined {
  return value === "idle" || value === "running" || value === "paused" || value === "stopped" ? value : undefined;
}

function contextStatus(value: unknown): WorldView["contexts"][number]["status"] | undefined {
  return value === "dormant" || value === "active" || value === "paused" || value === "stopped" ? value : undefined;
}
