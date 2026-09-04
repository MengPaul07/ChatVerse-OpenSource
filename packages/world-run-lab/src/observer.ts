import type {
  World,
  WorldDebugEvent,
  WorldNotification,
} from "@chatverse/core";
import {
  actorOperationKey,
  hasInFlightProvider as hasInFlightProviderSnapshot,
  isWorldBusy as isWorldBusySnapshot,
  operationOutcomeFromMessage,
  type ActiveOperation,
} from "./runner-helpers.js";
import type {
  WorldRunOperationKind,
  WorldRunOperationOutcome,
  WorldRunOperationRecord,
  WorldRunProgress,
} from "./types.js";

interface WorldRunObserverHost {
  progress(progress: WorldRunProgress): void;
  getEventSequence(): number | undefined;
}

interface WorldRunObserverOptions {
  host: WorldRunObserverHost;
  notifications: WorldNotification[];
  operations: WorldRunOperationRecord[];
  errors: string[];
}

/** Collects runtime observations without mixing them into the execution loop. */
export class WorldRunObserver {
  readonly activeOperations = new Map<string, ActiveOperation>();
  readonly narratorRunningContexts = new Set<string>();
  private maxConcurrentOperations = 0;
  private maxOperationAgeMs = 0;

  constructor(private readonly options: WorldRunObserverOptions) {}

  get stability() {
    return {
      maxConcurrentOperations: this.maxConcurrentOperations,
      maxOperationAgeMs: this.maxOperationAgeMs,
      activeOperationsAtFinish: this.activeOperations.size,
    };
  }

  isWorldBusy(snapshot: ReturnType<World["debugSnapshot"]>): boolean {
    return this.narratorRunningContexts.size > 0 || isWorldBusySnapshot(snapshot);
  }

  hasInFlightProvider(snapshot: ReturnType<World["debugSnapshot"]>): boolean {
    return this.narratorRunningContexts.size > 0 || hasInFlightProviderSnapshot(snapshot);
  }

  trackNotification(notification: WorldNotification): void {
    const timestamp = notification.occurredAt;
    switch (notification.type) {
      case "director.started":
        this.beginOperation("director", "director", timestamp);
        return;
      case "director.completed":
        this.finishOperation("director", timestamp, "completed");
        return;
      case "director.error":
        this.finishOperation(
          "director",
          timestamp,
          operationOutcomeFromMessage(notification.payload.message),
        );
        return;
      case "actor_memory.started":
        this.beginOperation("memory", "memory", timestamp);
        return;
      case "actor_memory.completed":
        this.finishOperation("memory", timestamp, "completed");
        return;
      case "actor_memory.error":
        this.finishOperation(
          "memory",
          timestamp,
          operationOutcomeFromMessage(notification.payload.message),
        );
        return;
      case "actor.wake_settled":
        if (notification.payload.actorId && (
          notification.payload.outcome === "failed" ||
          notification.payload.outcome === "cancelled"
        )) {
          this.finishActorOperation(
            notification.payload.actorId,
            notification.payload.contextId,
            timestamp,
            notification.payload.outcome === "cancelled" ? "cancelled" : "error",
          );
        }
        return;
      case "narrator.started":
        this.narratorRunningContexts.add(notification.payload.contextId);
        return;
      case "narrator.completed":
      case "narrator.error":
        this.narratorRunningContexts.delete(notification.payload.contextId);
        return;
      case "world.status_changed":
        if (notification.payload.status === "stopped") this.finishAllOperations(timestamp, "cancelled");
        return;
      default:
        return;
    }
  }

  trackDebugEvent(event: WorldDebugEvent): void {
    if (event.type === "director.response") {
      const toolCalls = Array.isArray(event.payload.toolCalls)
        ? event.payload.toolCalls as Array<{ function?: { name?: string }; name?: string }>
        : [];
      const names = toolCalls
        .map((call) => call.function?.name ?? call.name)
        .filter((name): name is string => Boolean(name));
      this.options.host.progress({
        phase: "provider",
        eventSequence: this.options.host.getEventSequence(),
        message: `director round=${String(event.payload.round ?? "?")} tools=${names.join(",") || "none"}`,
      });
    }
    if (event.type === "director.tool_result") {
      this.options.host.progress({
        phase: "provider",
        eventSequence: this.options.host.getEventSequence(),
        message: `director tool=${String(event.payload.toolName ?? "unknown")} ` +
          `${event.payload.accepted === true ? "accepted" : `rejected: ${String(event.payload.error ?? "unknown")}`}`,
      });
    }
    if (event.type === "character.request_started" && event.actorId) {
      this.beginOperation(
        "actor",
        actorOperationKey(event.contextId, event.actorId),
        event.occurredAt,
        event.actorId,
        event.contextId,
      );
      return;
    }
    if (event.type === "character.response_completed" && event.actorId) {
      this.finishActorOperation(event.actorId, event.contextId, event.occurredAt, "completed");
      return;
    }
    if (event.type === "agent.error" && event.actorId) {
      const message = typeof event.payload.message === "string"
        ? event.payload.message
        : "actor request failed";
      this.finishActorOperation(
        event.actorId,
        event.contextId,
        event.occurredAt,
        operationOutcomeFromMessage(message),
      );
    }
  }

  recordUnrecoveredRuntimeErrors(): void {
    const latest = new Map<string, { type: "completed" | "error"; message?: string }>();
    for (const notification of this.options.notifications) {
      switch (notification.type) {
        case "director.completed":
          latest.set("director", { type: "completed" });
          break;
        case "director.error":
          latest.set("director", { type: "error", message: notification.payload.message });
          break;
        case "narrator.completed":
          latest.set(
            `narrator:${notification.payload.contextId}:${notification.payload.beatId}`,
            { type: "completed" },
          );
          break;
        case "narrator.error":
          latest.set(
            `narrator:${notification.payload.contextId}:${notification.payload.beatId}`,
            { type: "error", message: notification.payload.message },
          );
          break;
        case "actor_memory.completed":
          latest.set("memory", { type: "completed" });
          break;
        case "actor_memory.error":
          latest.set("memory", { type: "error", message: notification.payload.message });
          break;
        case "world.error":
          this.pushUniqueError(`World runtime error: ${notification.payload.message}`);
          break;
        default:
          break;
      }
    }
    for (const [key, state] of latest) {
      if (state.type === "error") {
        this.pushUniqueError(`${key} did not recover: ${state.message ?? "unknown error"}`);
      }
    }
  }

  private beginOperation(
    kind: WorldRunOperationKind,
    key: string,
    startedAt: number,
    actorId?: string,
    contextId?: string,
  ): void {
    if (this.activeOperations.has(key)) return;
    const operation: ActiveOperation = {
      id: `operation-${this.options.operations.length + this.activeOperations.size + 1}`,
      kind,
      actorId,
      contextId,
      startedAt,
    };
    this.activeOperations.set(key, operation);
    this.maxConcurrentOperations = Math.max(this.maxConcurrentOperations, this.activeOperations.size);
  }

  private finishActorOperation(
    actorId: string,
    contextId: string | undefined,
    finishedAt: number,
    outcome: WorldRunOperationOutcome,
  ): void {
    const exactKey = actorOperationKey(contextId, actorId);
    if (this.activeOperations.has(exactKey)) {
      this.finishOperation(exactKey, finishedAt, outcome);
      return;
    }
    const fallbackKey = [...this.activeOperations.keys()].find((key) => key.endsWith(`:${actorId}`));
    if (fallbackKey) this.finishOperation(fallbackKey, finishedAt, outcome);
  }

  private finishOperation(
    key: string,
    finishedAt: number,
    outcome: WorldRunOperationOutcome,
  ): void {
    const active = this.activeOperations.get(key);
    if (!active) return;
    this.activeOperations.delete(key);
    const durationMs = Math.max(0, finishedAt - active.startedAt);
    this.maxOperationAgeMs = Math.max(this.maxOperationAgeMs, durationMs);
    this.options.operations.push({
      ...active,
      finishedAt,
      durationMs,
      outcome,
    });
  }

  finishAllOperations(finishedAt: number, outcome: WorldRunOperationOutcome): void {
    for (const key of [...this.activeOperations.keys()]) this.finishOperation(key, finishedAt, outcome);
  }

  private pushUniqueError(message: string): void {
    if (!this.options.errors.includes(message)) this.options.errors.push(message);
  }
}
