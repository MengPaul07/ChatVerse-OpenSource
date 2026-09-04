import type {
  WorldContextDefinition,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { WorldState } from "../state.js";
import { ambientDelayRange, unique } from "./helpers.js";

export interface ContextActivityHost {
  isRunning(): boolean;
  isStopped(): boolean;
  notify(type: WorldNotificationType, payload: Record<string, unknown>): void;
  onAmbientDue(contextId: string, noopCount: number): void;
  onSuspendDue(contextId: string): void;
}

export interface ContextActivityOptions {
  state: WorldState;
  contextRuntimes: ReadonlyMap<string, ChatContextRuntime>;
  runtime: RuntimeHost;
  contextSuspendAfterMs: number;
  isConversationContext(context: WorldContextDefinition): boolean;
  isPlayerControlledActor(actorId: string): boolean;
  host: ContextActivityHost;
}

/** Owns per-Context focus, ambient backoff, and inactivity suspension timers. */
export class ContextActivityController {
  constructor(private readonly options: ContextActivityOptions) {}

  currentFocusActors(contextId: string): string[] {
    const context = this.options.contextRuntimes.get(contextId);
    const activity = this.options.state.contexts.get(contextId)?.activity;
    if (!context || !activity) return [];
    return activity.focusActorIds.filter((actorId) => {
      const actor = this.options.state.actorDefinitions.get(actorId);
      const actorState = this.options.state.actorStates.get(actorId);
      const presence = this.options.state.getPresence(contextId, actorId);
      return (
        actor != null &&
        !this.options.isPlayerControlledActor(actorId) &&
        actorState?.presence === "online" &&
        presence?.participation === "joined"
      );
    }).slice(0, 2);
  }

  updateFocus(contextId: string, actorId: string, reason: string): void {
    if (this.options.host.isStopped()) return;
    const projected = this.options.state.contexts.get(contextId);
    if (!projected?.activity) return;
    const next = unique([
      actorId,
      ...this.currentFocusActors(contextId).filter((current) => current !== actorId),
    ]).slice(0, 2);
    if (sameValues(next, projected.activity.focusActorIds)) return;
    projected.activity.focusActorIds = next;
    projected.activity.revision++;
    projected.updatedAt = this.now();
    this.options.host.notify("context.focus_changed", {
      contextId,
      focusActorIds: next,
      reason,
    });
  }

  pruneFocus(contextId: string, reason: string): void {
    if (this.options.host.isStopped()) return;
    const activity = this.options.state.contexts.get(contextId)?.activity;
    if (!activity) return;
    const next = this.currentFocusActors(contextId);
    if (sameValues(next, activity.focusActorIds)) return;
    activity.focusActorIds = next;
    activity.revision++;
    this.options.host.notify("context.focus_changed", {
      contextId,
      focusActorIds: next,
      reason,
    });
  }

  recordActivity(contextId: string, focusActorId?: string): void {
    if (this.options.host.isStopped()) return;
    const projected = this.options.state.contexts.get(contextId);
    if (!projected?.activity) return;
    projected.activity.lastCommittedAt = this.now();
    projected.activity.ambientNoopCount = 0;
    projected.activity.revision++;
    projected.updatedAt = this.now();
    if (focusActorId) this.updateFocus(contextId, focusActorId, "actor_output");
    this.scheduleAmbient(contextId);
  }

  recordAmbientNoop(contextId: string): void {
    if (this.options.host.isStopped()) return;
    const activity = this.options.state.contexts.get(contextId)?.activity;
    if (!activity) return;
    activity.ambientNoopCount = Math.min(3, activity.ambientNoopCount + 1);
    activity.revision++;
    this.scheduleAmbient(contextId);
  }

  scheduleAmbient(contextId: string, delayOverrideMs?: number): void {
    const context = this.options.contextRuntimes.get(contextId);
    const projected = this.options.state.contexts.get(contextId);
    if (!context || !projected?.activity) return;
    context.ambientTask?.cancel();
    context.ambientTask = undefined;
    projected.activity.nextAmbientAt = undefined;
    if (
      !this.options.host.isRunning() ||
      this.options.isConversationContext(context.definition) ||
      context.actorRuntime.activation !== "beat_runtime" ||
      context.actorRuntime.ambient !== "low" ||
      context.definition.presentation?.kind === "galgame"
    ) return;

    const [minimumMs, maximumMs] = ambientDelayRange(projected.activity.ambientNoopCount);
    const delayMs = delayOverrideMs == null
      ? Math.round(minimumMs + Math.random() * (maximumMs - minimumMs))
      : Math.max(0, Math.round(delayOverrideMs));
    const dueAt = this.now() + delayMs;
    projected.activity.nextAmbientAt = dueAt;
    context.ambientTask = this.options.runtime.scheduler.schedule(delayMs, () => {
      context.ambientTask = undefined;
      const current = this.options.state.contexts.get(contextId)?.activity;
      if (!current || !this.options.host.isRunning()) return;
      current.nextAmbientAt = undefined;
      context.turnCoordinator.resetAmbientCycle();
      this.options.host.onAmbientDue(contextId, current.ambientNoopCount);
    });
    this.options.host.notify("context.ambient_scheduled", {
      contextId,
      dueAt,
      delayMs,
      noopCount: projected.activity.ambientNoopCount,
    });
  }

  scheduleSuspend(contextId: string, delay = this.options.contextSuspendAfterMs): void {
    const context = this.options.contextRuntimes.get(contextId);
    if (!context) return;
    context.suspendTask?.cancel();
    context.suspendTask = this.options.runtime.scheduler.schedule(delay, () => {
      context.suspendTask = undefined;
      if (this.options.host.isRunning() || this.options.isConversationContext(context.definition)) {
        this.options.host.onSuspendDue(contextId);
      }
    });
  }

  private now(): number {
    return this.options.runtime.clock.now();
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
