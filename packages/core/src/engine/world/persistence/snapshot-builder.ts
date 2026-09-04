import type {
  WorldForegroundRecoveryState,
  WorldSnapshot,
} from "../../../contracts/world.js";
import type { TimelineCheckpoint } from "../../../context/timeline.js";
import type { WorldDebugEmitter } from "../../../observability/world-debug/index.js";
import type { WorldDebugSnapshot } from "../../../contracts/world-debug.js";
import type { ActorMemoryUpdateCoordinator } from "../../actor-memory/index.js";
import type { InMemoryActorMemoryStore } from "../../actor-memory/index.js";
import type { PresentationController } from "../presentation/controller.js";
import type { ChatContextRuntime } from "../runtime/context-runtime.js";
import type { WorldState } from "../state.js";
import {
  cloneActorBackgroundState,
  cloneActorControlState,
  cloneDebugEvent,
} from "../runtime/helpers.js";

export interface WorldSnapshotInput {
  state: WorldState;
  contextRuntimes: ReadonlyMap<string, ChatContextRuntime>;
  actorMemory: Pick<InMemoryActorMemoryStore, "snapshots" | "snapshot">;
  actorMemoryUpdates: Pick<ActorMemoryUpdateCoordinator, "snapshots" | "debugSnapshots">;
  presentation: Pick<PresentationController, "snapshot" | "debug">;
  timelineCheckpoints: ReadonlyMap<string, TimelineCheckpoint>;
  foregroundRecovery: Pick<{
    snapshot: () => WorldForegroundRecoveryState[];
  }, "snapshot">;
  now: () => number;
}

export interface WorldDebugSnapshotInput extends Omit<WorldSnapshotInput, "foregroundRecovery"> {
  foregroundRecovery: Pick<{
    snapshot: () => WorldForegroundRecoveryState[];
    get: (contextId: string) => WorldForegroundRecoveryState | undefined;
  }, "snapshot" | "get">;
  debug: WorldDebugEmitter;
  status: WorldDebugSnapshot["world"]["status"];
  director: {
    running: boolean;
    dueAt?: number;
    cursor: number;
    pendingEvents: number;
    retryIndex: number;
    lastRunAt: number;
    plan?: {
      id: string;
      reasons: string[];
      contextIds: string[];
      taskMode?: "plan_beat" | "transition_beat" | "player_directive";
      modelRequestCount: number;
    };
    task?: WorldDebugSnapshot["director"]["task"];
  };
}

export function buildWorldSnapshot(input: WorldSnapshotInput): WorldSnapshot {
  const contextSessions = [...input.contextRuntimes.values()].map((context) => ({
    contextId: context.definition.id,
    snapshot: context.session.snapshot(),
  }));
  return {
    ...input.state.snapshot(
      contextSessions,
      input.now(),
      input.actorMemory.snapshots(),
      input.actorMemoryUpdates.snapshots(),
      input.presentation.snapshot(),
    ),
    contextTimelineCheckpoints: [...input.timelineCheckpoints.entries()].map(([contextId, checkpoint]) => ({
      contextId,
      checkpoint: { ...checkpoint, facts: [...checkpoint.facts] },
    })),
    foregroundRecovery: input.foregroundRecovery.snapshot(),
  };
}

export function buildWorldDebugSnapshot(input: WorldDebugSnapshotInput): WorldDebugSnapshot {
  const memory = input.actorMemoryUpdates.debugSnapshots().map((runtimeState) => {
    const snapshot = input.actorMemory.snapshot(runtimeState.actorId);
    return {
      runtime: runtimeState,
      snapshot: input.debug.config.includeMemoryContent
        ? snapshot
        : {
            ...snapshot,
            nodes: snapshot.nodes.map((node) => ({
              ...node,
              content: "[redacted]",
            })),
          },
    };
  });
  const plan = input.director.plan;
  return {
    schemaVersion: 1,
    generatedAt: input.now(),
    world: {
      id: input.state.definition.metadata.id,
      status: input.status,
      worldTime: input.state.worldTime,
      eventSequence: input.state.journal.lastSequence,
    },
    director: {
      running: input.director.running,
      dueAt: input.director.dueAt,
      cursor: input.director.cursor,
      pendingEvents: input.director.pendingEvents,
      retryIndex: input.director.retryIndex,
      lastRunAt: Number.isFinite(input.director.lastRunAt)
        ? input.director.lastRunAt
        : undefined,
      plan: plan
        ? {
            id: plan.id,
            reasons: [...plan.reasons],
            contextIds: [...plan.contextIds],
            modelRequestCount: plan.modelRequestCount,
            taskMode: plan.taskMode,
          }
        : undefined,
      task: input.director.task
        ? {
            ...input.director.task,
            requiredToolNames: [...input.director.task.requiredToolNames],
            toolNames: [...input.director.task.toolNames],
            failedToolNames: [...input.director.task.failedToolNames],
            missingToolNames: [...input.director.task.missingToolNames],
          }
        : undefined,
    },
    contexts: [...input.contextRuntimes.values()].map((context) => {
      const contextState = input.state.contexts.get(context.definition.id);
      return {
        contextId: context.definition.id,
        name: context.definition.name,
        status: contextState?.status ?? "dormant",
        actorRuntime: { ...context.actorRuntime },
        presentation: input.presentation.debug(context.definition.id)[0],
        recovery: input.foregroundRecovery.get(context.definition.id),
        activity: contextState?.activity
          ? {
              ...contextState.activity,
              focusActorIds: [...contextState.activity.focusActorIds],
            }
          : undefined,
        session: context.session.snapshotDebugState() as unknown as Record<string, unknown>,
      };
    }),
    actors: [...input.state.actorStates.values()].map((state) => ({
      state: { ...state },
      background: cloneActorBackgroundState(input.state.actorBackgrounds.get(state.actorId)),
      control: cloneActorControlState(input.state.actorControls.get(state.actorId)),
      presences: [...input.state.presences.values()]
        .filter((presence) => presence.actorId === state.actorId)
        .map((presence) => ({ ...presence })),
    })),
    memory,
    narrative: {
      beats: [...input.state.beats.values()].map((beat) => ({
        ...beat,
        actorIds: [...beat.actorIds],
        contextIds: [...beat.contextIds],
        sourceEventIds: [...beat.sourceEventIds],
      })),
      edges: [...input.state.edges.values()].map((edge) => ({ ...edge })),
      chapters: [...input.state.chapters.values()].map((chapter) => ({
        ...chapter,
        actorIds: [...chapter.actorIds],
        contextIds: [...chapter.contextIds],
        beatIds: [...chapter.beatIds],
      })),
      foregroundChapterId: input.state.foregroundChapterId,
    },
    tokenUsage: input.debug.tokenUsage,
    events: input.debug.events.map(cloneDebugEvent),
    firstRetainedDebugSequence: input.debug.events[0]?.sequence,
    lastDebugSequence: input.debug.lastSequence,
    droppedDebugEventCount: input.debug.droppedEventCount,
  };
}
