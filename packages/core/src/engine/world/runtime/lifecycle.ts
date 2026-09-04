import type { WorldEvent, WorldEventInput, WorldNotificationPayloadMap, WorldNotificationType, WorldContextDefinition, NarrativeBeat } from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { ActorMemoryUpdateCoordinator } from "../../actor-memory/coordinator.js";
import type { ForegroundRecoveryController } from "./foreground-recovery.js";
import type { TimelineRuntime } from "./timeline-runtime.js";
import type { NarratorMode } from "../narrator/index.js";
import type { NarratorRuntime } from "./narrator-runtime.js";
import type { DirectorRuntime } from "./director-runtime.js";
import type { PresentationController } from "../presentation/controller.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { WorldState } from "../state.js";

export type WorldLifecycleStatus = "idle" | "running" | "paused" | "stopped";

interface LifecycleRecovery {
  cancelAll(): void;
  resume(): void;
}

interface LifecycleDirectorRuntime {
  pause(): void;
  resume(): void;
  stop(): void;
}

interface LifecycleNarratorRuntime {
  pause(): void;
  resume(): void;
  stop(): void;
}

interface LifecyclePresentation {
  startBeat(contextId: string, beatId: string): void;
  stop(): void;
}

interface LifecycleMemoryUpdates {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  checkpoint(actorIds: readonly string[]): void;
}

/** Owns World lifecycle orchestration without owning World state. */
export interface WorldLifecycleHost {
  state: WorldState;
  runtime: RuntimeHost;
  contextRuntimes: ReadonlyMap<string, ChatContextRuntime>;
  directorRuntime: LifecycleDirectorRuntime | DirectorRuntime;
  narratorRuntime: LifecycleNarratorRuntime | NarratorRuntime;
  presentation: LifecyclePresentation | PresentationController;
  actorMemoryUpdates: LifecycleMemoryUpdates | ActorMemoryUpdateCoordinator;
  timelineRuntime: Pick<TimelineRuntime, "stop">;
  recovery: LifecycleRecovery | ForegroundRecoveryController;
  getStatus(): WorldLifecycleStatus;
  setStatus(status: WorldLifecycleStatus): void;
  bumpLifecycleEpoch(): void;
  abortPlayerTurns(): void;
  now(): number;
  isPrivateConversationContext(context: WorldContextDefinition): boolean;
  getActiveBeat(contextId: string): NarrativeBeat | undefined;
  activateContext(contextId: string): void;
  ensureContextRunning(context: ChatContextRuntime): void;
  scheduleContextAmbient(contextId: string, delayOverrideMs?: number): void;
  scheduleNarrator(
    contextId: string,
    mode: NarratorMode,
    sourceEventIds?: readonly string[],
  ): void;
  latestContextEventIds(contextId: string, limit: number): string[];
  considerDirectorWork(immediate: boolean): void;
  scheduleDirector(immediate: boolean, reason?: string): void;
  appendEvent(input: WorldEventInput): WorldEvent;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

export class WorldLifecycleRuntime {
  constructor(private readonly host: WorldLifecycleHost) {}

  start(): void {
    if (this.host.getStatus() === "stopped" || this.host.getStatus() === "running") return;
    this.host.setStatus("running");
    this.host.actorMemoryUpdates.start();

    const initialContexts = new Set(
      this.host.state.definition.contexts
        .filter((context) => !this.host.isPrivateConversationContext(context))
        .filter((context) => (
          context.initiallyActive ||
          this.host.state.contexts.get(context.id)?.status === "active" ||
          Boolean(this.host.getActiveBeat(context.id))
        ))
        .map((context) => context.id),
    );

    for (const context of this.host.state.definition.contexts) {
      if (this.host.isPrivateConversationContext(context)) continue;
      const activity = this.host.state.contexts.get(context.id)?.activity;
      const restoredDueAt = activity?.nextAmbientAt;
      if (initialContexts.has(context.id)) {
        this.host.activateContext(context.id);
        this.host.scheduleContextAmbient(
          context.id,
          restoredDueAt == null ? undefined : Math.max(0, restoredDueAt - this.host.now()),
        );
      } else if (restoredDueAt != null) {
        this.host.scheduleContextAmbient(
          context.id,
          Math.max(0, restoredDueAt - this.host.now()),
        );
      }
    }

    for (const context of this.host.contextRuntimes.values()) {
      const beat = this.host.getActiveBeat(context.definition.id);
      if (beat && context.definition.presentation?.kind === "galgame") {
        this.host.presentation.startBeat(context.definition.id, beat.id);
      }
    }
    this.scheduleStartupNarrators();
    this.host.considerDirectorWork(false);
  }

  pause(): void {
    if (this.host.getStatus() !== "running") return;
    this.host.setStatus("paused");
    this.host.directorRuntime.pause();
    this.host.narratorRuntime.pause();
    this.host.actorMemoryUpdates.pause();
    for (const context of this.host.contextRuntimes.values()) {
      if (this.host.isPrivateConversationContext(context.definition)) continue;
      if (this.host.state.contexts.get(context.definition.id)?.status === "active") {
        context.session.pause();
      }
      context.ambientTask?.cancel();
      context.ambientTask = undefined;
    }
    this.host.recovery.cancelAll();
  }

  resume(): void {
    if (this.host.getStatus() !== "paused") return;
    this.host.setStatus("running");
    this.host.actorMemoryUpdates.resume();
    for (const context of this.host.contextRuntimes.values()) {
      if (this.host.isPrivateConversationContext(context.definition)) continue;
      const activeBeat = this.host.getActiveBeat(context.definition.id);
      if (
        activeBeat &&
        this.host.state.contexts.get(context.definition.id)?.status !== "active"
      ) {
        this.host.activateContext(context.definition.id);
      } else if (this.host.state.contexts.get(context.definition.id)?.status === "active") {
        this.host.ensureContextRunning(context);
      }
      this.host.scheduleContextAmbient(context.definition.id);
    }
    this.scheduleStartupNarrators();
    this.host.narratorRuntime.resume();
    this.host.directorRuntime.resume();
    this.host.recovery.resume();
  }

  stop(): void {
    if (this.host.getStatus() === "stopped") return;
    this.host.setStatus("stopped");
    this.host.actorMemoryUpdates.stop();
    this.host.bumpLifecycleEpoch();
    this.host.directorRuntime.stop();
    this.host.narratorRuntime.stop();
    this.host.abortPlayerTurns();
    this.host.timelineRuntime.stop();
    this.host.presentation.stop();
    this.host.recovery.cancelAll();
    for (const context of this.host.contextRuntimes.values()) {
      context.suspendTask?.cancel();
      context.ambientTask?.cancel();
      context.ambientTask = undefined;
      context.turnCoordinator.clear();
      context.debugUnsubscribe?.();
      context.usageUnsubscribe?.();
      context.session.stop();
      const state = this.host.state.contexts.get(context.definition.id);
      if (state) {
        state.status = "stopped";
        state.updatedAt = this.host.now();
      }
    }
  }

  private scheduleStartupNarrators(): void {
    for (const context of this.host.contextRuntimes.values()) {
      if (this.host.isPrivateConversationContext(context.definition)) continue;
      const beat = this.host.getActiveBeat(context.definition.id);
      if (!beat) continue;
      const projected = this.host.state.contexts.get(context.definition.id);
      if (projected?.status !== "active") this.host.activateContext(context.definition.id);
      const sourceSequence = Math.max(
        0,
        ...beat.sourceEventIds.map((eventId) => this.host.state.journal.get(eventId)?.sequence ?? 0),
      );
      const hasBeatProgress = this.host.state.journal.all().some((event) => (
        event.sequence > sourceSequence &&
        event.contextId != null &&
        beat.contextIds.includes(event.contextId) &&
        (
          event.type === "narrative.narration.committed" ||
          event.type === "context.message.committed" ||
          event.type === "context.action.committed"
        )
      ));
      const mode: NarratorMode = hasBeatProgress ? "resolve_action" : "open_beat";
      this.host.scheduleNarrator(
        context.definition.id,
        mode,
        uniqueEventIds([
          ...beat.sourceEventIds,
          ...this.host.latestContextEventIds(context.definition.id, 8),
        ]),
      );
    }
  }
}

function uniqueEventIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}
