import type {
  WorldActorDefinition,
  WorldContextDefinition,
  WorldEvent,
  WorldEventInput,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { ActorMemoryUpdateCoordinator } from "../../actor-memory/coordinator.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { ForegroundRecoveryController } from "./foreground-recovery.js";
import type { WorldState } from "../state.js";
import { isPlayerControlledActor } from "../persistence/definition.js";
import { errorToMessage } from "./helpers.js";

type WorldRuntimeStatus = "idle" | "running" | "paused" | "stopped";

interface ContextLifecycleHost {
  state: WorldState;
  runtime: RuntimeHost;
  recovery: Pick<ForegroundRecoveryController, "get" | "cancel" | "resumeContext">;
  actorMemoryUpdates: Pick<ActorMemoryUpdateCoordinator, "checkpoint">;
  getStatus(): WorldRuntimeStatus;
  requireContext(contextId: string): ChatContextRuntime;
  requireActor(actorId: string): WorldActorDefinition;
  isConversationContext(context: WorldContextDefinition): boolean;
  runContext(context: ChatContextRuntime): Promise<void>;
  scheduleSuspend(contextId: string, delay?: number): void;
  scheduleAmbient(contextId: string, delayOverrideMs?: number): void;
  appendEvent<TType extends "context.activated" | "context.suspended">
    (input: WorldEventInput<TType>): WorldEvent<TType>;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Owns Context activation, independent conversation pause, and Session recovery. */
export class ContextLifecycleRuntime {
  constructor(private readonly host: ContextLifecycleHost) {}

  activate(contextId: string): void {
    const context = this.host.requireContext(contextId);
    const projected = this.host.state.contexts.get(contextId)!;
    if (projected.status === "paused") return;
    if (projected.status === "active" && context.started) {
      this.host.scheduleSuspend(contextId);
      this.host.scheduleAmbient(contextId);
      return;
    }
    if (this.host.getStatus() === "stopped") return;

    const wasActive = projected.status === "active";
    projected.status = "active";
    projected.updatedAt = this.now();
    if (this.host.getStatus() === "running" || this.host.isConversationContext(context.definition)) {
      this.ensureRunning(context);
    }
    if (!wasActive) {
      this.host.appendEvent({
        type: "context.activated",
        contextId,
        payload: {},
      });
      this.host.notify("context.status_changed", { contextId, status: "active" });
    }
    this.host.scheduleSuspend(contextId);
    this.host.scheduleAmbient(contextId);
  }

  pause(contextId: string, pauseReason: "manual" | "unread" | "unobserved" = "manual"): void {
    const context = this.host.requireContext(contextId);
    if (!this.host.isConversationContext(context.definition)) {
      throw new Error("Only conversation contexts can be paused independently.");
    }
    const projected = this.host.state.contexts.get(contextId)!;
    if (projected.status === "stopped") return;
    context.session.pause();
    context.suspendTask?.cancel();
    context.suspendTask = undefined;
    context.ambientTask?.cancel();
    context.ambientTask = undefined;
    this.host.recovery.cancel(contextId);
    projected.status = "paused";
    projected.pauseReason = pauseReason;
    projected.updatedAt = this.now();
    this.host.notify("context.status_changed", {
      contextId,
      status: "paused",
      pauseReason,
    });
  }

  resume(contextId: string): void {
    const context = this.host.requireContext(contextId);
    if (!this.host.isConversationContext(context.definition)) {
      throw new Error("Only conversation contexts can be resumed independently.");
    }
    const projected = this.host.state.contexts.get(contextId)!;
    if (projected.status === "stopped") return;
    projected.status = "active";
    projected.pauseReason = undefined;
    projected.updatedAt = this.now();
    this.ensureRunning(context);
    this.host.notify("context.status_changed", { contextId, status: "active" });
    this.host.scheduleSuspend(contextId);
    this.host.recovery.resumeContext(contextId);
  }

  suspend(contextId: string): void {
    const context = this.host.requireContext(contextId);
    const projected = this.host.state.contexts.get(contextId)!;
    if (projected.status !== "active") return;
    const recovery = this.host.recovery.get(contextId);
    if (context.session.hasPendingWork() || (recovery && recovery.status !== "failed")) {
      this.host.scheduleSuspend(contextId, 15_000);
      return;
    }
    context.session.pause();
    context.suspendTask?.cancel();
    context.suspendTask = undefined;
    projected.status = "dormant";
    projected.updatedAt = this.now();
    this.host.appendEvent({
      type: "context.suspended",
      contextId,
      payload: {},
    });
    this.host.actorMemoryUpdates.checkpoint(
      this.host.state.actorIdsInContext(contextId).filter((actorId) => (
        !isPlayerControlledActor(this.host.requireActor(actorId))
      )),
    );
    this.host.notify("context.status_changed", { contextId, status: "dormant" });
  }

  ensureRunning(context: ChatContextRuntime): void {
    if (context.runTask) {
      context.session.resume();
      return;
    }
    context.started = true;
    const runTask = this.host.runContext(context);
    context.runTask = runTask;
    void runTask.then(
      () => this.finishRun(context, runTask),
      (error) => {
        this.finishRun(context, runTask);
        this.host.notify("world.error", {
          contextId: context.definition.id,
          message: errorToMessage(error),
        });
      },
    );
  }

  private finishRun(context: ChatContextRuntime, runTask: Promise<void>): void {
    if (context.runTask !== runTask) return;
    context.runTask = undefined;
    context.started = false;
  }

  private now(): number {
    return this.host.runtime.clock.now();
  }
}
