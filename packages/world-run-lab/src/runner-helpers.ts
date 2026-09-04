import type { World } from "@chatverse/core";
import type {
  WorldRunOperationKind,
  WorldRunOperationOutcome,
} from "./types.js";

export function isWorldBusy(
  snapshot: ReturnType<World["debugSnapshot"]>,
): boolean {
  if (snapshot.director.running) return true;
  // A failed Director pass is retried by the foreground recovery controller.
  // Do not hold the conversational step open for that background retry; the
  // next player event can still coalesce it and the report records the error.
  if (snapshot.director.dueAt !== undefined && snapshot.director.retryIndex === 0) {
    return true;
  }
  // Memory curation is deliberately background work. It is observed in the
  // report and cancelled by World.stop(), but it must never block a player
  // step or make an otherwise quiet conversation look stuck.
  return snapshot.contexts.some((context) => {
    if (context.presentation && context.presentation.status !== "waiting_player" && context.presentation.status !== "waiting_ack") return true;
    const session = context.session as {
      queues?: {
        scheduled?: unknown[];
        generating?: unknown[];
        triggers?: unknown[];
      };
    };
    return Boolean(
      session.queues?.scheduled?.length ||
      session.queues?.generating?.length ||
      session.queues?.triggers?.length
    );
  });
}

export function hasInFlightProvider(
  snapshot: ReturnType<World["debugSnapshot"]>,
): boolean {
  if (snapshot.director.running) return true;
  if (snapshot.memory.some(({ runtime }) => (
    runtime.status === "running" || runtime.status === "ready"
  ))) return true;
  return snapshot.contexts.some((context) => {
    const session = context.session as {
      queues?: { generating?: unknown[] };
    };
    return Boolean(session.queues?.generating?.length);
  });
}

export function createRunId(scenarioId: string, timestamp: number): string {
  return `${scenarioId}-${new Date(timestamp).toISOString().replace(/[:.]/g, "-")}`;
}

export async function flushMicrotasks(): Promise<void> {
  // Provider mocks resolve synchronously, but the World/Session continuations
  // form several promise layers. A bounded flush keeps accelerated runs fast
  // while still surfacing unresolved work instead of waiting forever.
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ActiveOperation {
  id: string;
  kind: WorldRunOperationKind;
  actorId?: string;
  contextId?: string;
  startedAt: number;
}

export function actorOperationKey(
  contextId: string | undefined,
  actorId: string,
): string {
  return `actor:${contextId ?? "unknown"}:${actorId}`;
}

export function operationOutcomeFromMessage(
  message: string,
): WorldRunOperationOutcome {
  return /abort|cancel|timeout|timed out|超时|中止|取消/i.test(message)
    ? "timeout"
    : "error";
}
