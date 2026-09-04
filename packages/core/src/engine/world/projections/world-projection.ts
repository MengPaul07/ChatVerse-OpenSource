import type { WorldSnapshot } from "../../../contracts/world.js";
import type { ActorMemoryUpdateCoordinator, InMemoryActorMemoryStore } from "../../actor-memory/index.js";
import type { WorldDebugEmitter } from "../../../observability/world-debug/index.js";
import type { WorldDebugSnapshot } from "../../../contracts/world-debug.js";
import type { DirectorRuntime } from "../runtime/director-runtime.js";
import type { TimelineCheckpoint } from "../../../context/timeline.js";
import type { PresentationController } from "../presentation/controller.js";
import type { ChatContextRuntime } from "../runtime/context-runtime.js";
import type { ForegroundRecoveryController } from "../runtime/foreground-recovery.js";
import type { WorldState } from "../state.js";
import {
  buildWorldDebugSnapshot,
  buildWorldSnapshot,
} from "../persistence/snapshot-builder.js";

export interface WorldProjectionHost {
  state: WorldState;
  contextRuntimes: ReadonlyMap<string, ChatContextRuntime>;
  actorMemory: Pick<InMemoryActorMemoryStore, "snapshots" | "snapshot">;
  actorMemoryUpdates: Pick<ActorMemoryUpdateCoordinator, "snapshots" | "debugSnapshots">;
  presentation: Pick<PresentationController, "snapshot" | "debug">;
  timelineCheckpoints: ReadonlyMap<string, TimelineCheckpoint>;
  foregroundRecovery: Pick<ForegroundRecoveryController, "snapshot" | "get">;
  debug: WorldDebugEmitter;
  director: Pick<DirectorRuntime, "debugState" | "planState" | "pendingEventCount">;
  getStatus(): WorldDebugSnapshot["world"]["status"];
  now(): number;
}

/** Owns the durable and diagnostic projections of a World. */
export class WorldProjectionRuntime {
  constructor(private readonly host: WorldProjectionHost) {}

  snapshot(): WorldSnapshot {
    return buildWorldSnapshot({
      state: this.host.state,
      contextRuntimes: this.host.contextRuntimes,
      actorMemory: this.host.actorMemory,
      actorMemoryUpdates: this.host.actorMemoryUpdates,
      presentation: this.host.presentation,
      timelineCheckpoints: this.host.timelineCheckpoints,
      foregroundRecovery: this.host.foregroundRecovery,
      now: () => this.host.now(),
    });
  }

  debugSnapshot(): WorldDebugSnapshot {
    const directorDebug = this.host.director.debugState;
    const tokenUsage = this.host.debug.tokenUsage;
    const plan = this.host.director.planState;
    return buildWorldDebugSnapshot({
      state: this.host.state,
      contextRuntimes: this.host.contextRuntimes,
      actorMemory: this.host.actorMemory,
      actorMemoryUpdates: this.host.actorMemoryUpdates,
      presentation: this.host.presentation,
      timelineCheckpoints: this.host.timelineCheckpoints,
      foregroundRecovery: this.host.foregroundRecovery,
      debug: this.host.debug,
      status: this.host.getStatus(),
      now: () => this.host.now(),
      director: {
        running: directorDebug.running,
        dueAt: directorDebug.dueAt,
        cursor: this.host.state.directorCursor,
        pendingEvents: this.host.director.pendingEventCount(),
        retryIndex: directorDebug.retryIndex,
        lastRunAt: directorDebug.lastRunAt,
        plan: plan
          ? {
              id: plan.id,
              reasons: [...plan.reasons],
              contextIds: [...plan.contextIds],
              modelRequestCount: tokenUsage.byTurn.find((entry) => entry.key === plan.id)
                ?.requestCount ?? 0,
              taskMode: plan.taskMode,
            }
          : undefined,
        task: directorDebug.task,
      },
    });
  }
}
