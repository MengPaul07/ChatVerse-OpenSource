import { isProviderProtocol } from "@chatverse/core";
import type {
  TokenUsage,
  ProviderProtocol,
  WorldDebugEvent,
  WorldEvent,
  WorldNotification,
  WorldTokenUsageBreakdown,
  WorldTokenUsageTotals,
} from "@chatverse/core";
import type {
  WorldRunDebugRecord,
  WorldRunDirectorMetrics,
  WorldRunLatencyMetrics,
  WorldRunMetrics,
  WorldRunToolUsage,
  WorldRunTranscriptEntry,
  WorldRunStabilityMetrics,
} from "./types.js";

export function buildMetrics(input: {
  events: readonly WorldEvent[];
  notifications: readonly WorldNotification[];
  debug: readonly WorldRunDebugRecord[];
  checkpointCount: number;
  restoreCount: number;
  stability: WorldRunStabilityMetrics;
}): WorldRunMetrics {
  const tokenAccumulator = new TokenAccumulator();
  const toolUsage: WorldRunToolUsage = { totalCalls: 0, byName: {} };
  const latencies: number[] = [];

  for (const record of input.debug) {
    const event = record.event;
    if (event.type === "provider.usage") {
      tokenAccumulator.add(event);
    }
    const elapsedMs = finiteNumber(event.payload.elapsedMs);
    if (elapsedMs !== undefined) latencies.push(elapsedMs);
    const toolCalls = Array.isArray(event.payload.toolCalls)
      ? event.payload.toolCalls
      : [];
    for (const value of toolCalls) {
      const name = toolCallName(value);
      if (!name) continue;
      toolUsage.totalCalls++;
      toolUsage.byName[name] = (toolUsage.byName[name] ?? 0) + 1;
    }
  }

  const rawTokenUsage = tokenAccumulator.snapshot();
  const cacheableInputTokens = rawTokenUsage.cacheHitInputTokens + rawTokenUsage.cacheMissInputTokens;
  const eventCount = input.events.length;
  const director = directorMetrics(input.notifications);
  return {
    eventCount: input.events.length,
    eventsByType: countBy(input.events, (event) => event.type),
    notificationCount: input.notifications.length,
    notificationsByType: countBy(input.notifications, (event) => event.type),
    debugEventCount: input.debug.length,
    debugEventsByType: countBy(input.debug, (record) => record.event.type),
    tokenUsage: {
      ...rawTokenUsage,
      cacheableInputTokens,
      cacheHitRate: cacheableInputTokens > 0
        ? rawTokenUsage.cacheHitInputTokens / cacheableInputTokens
        : 0,
      averageInputTokensPerRequest: average(
        rawTokenUsage.inputTokens,
        rawTokenUsage.requestCount,
      ),
      averageOutputTokensPerRequest: average(
        rawTokenUsage.outputTokens,
        rawTokenUsage.requestCount,
      ),
      inputTokensPerEvent: average(rawTokenUsage.inputTokens, eventCount),
      totalTokensPerEvent: average(rawTokenUsage.totalTokens, eventCount),
    },
    toolUsage,
    director,
    providerLatency: latencyMetrics(latencies),
    stability: input.stability,
    checkpointCount: input.checkpointCount,
    restoreCount: input.restoreCount,
  };
}

function directorMetrics(
  notifications: readonly WorldNotification[],
): WorldRunDirectorMetrics {
  const scheduled = notifications.filter((notification) => (
    notification.type === "director.scheduled"
  ));
  const started = notifications.filter((notification) => (
    notification.type === "director.started"
  ));
  const completed = notifications.filter((notification) => (
    notification.type === "director.completed" &&
    notification.payload.taskStatus !== undefined
  ));
  const scheduleReasons = countBy(
    scheduled,
    (notification) => notification.type === "director.scheduled"
      ? notification.payload.reason
      : "unknown",
  );
  const batchScheduleCount = scheduleReasons.event_batch ?? 0;
  const nonImmediateScheduleCount = batchScheduleCount + (scheduleReasons.scene_actor_output ?? 0);
  const taskCompleteCount = completed.filter((notification) => (
    notification.type === "director.completed" && notification.payload.taskStatus === "complete"
  )).length;
  const taskPartialCount = completed.filter((notification) => (
    notification.type === "director.completed" && notification.payload.taskStatus === "partial"
  )).length;
  const taskEmptyCount = completed.filter((notification) => (
    notification.type === "director.completed" && notification.payload.taskStatus === "empty"
  )).length;
  const taskRetryCount = completed.reduce((sum, notification) => (
    sum + (notification.type === "director.completed"
      ? notification.payload.taskRetryCount ?? 0
      : 0)
  ), 0);
  const taskStarts = started.filter((notification) => (
    notification.type === "director.started" &&
    (notification.payload.objective || notification.payload.requiredToolNames?.length)
  ));
  const requiredToolCount = taskStarts.reduce((sum, notification) => (
    sum + (notification.type === "director.started"
      ? notification.payload.requiredToolNames?.length ?? 0
      : 0)
  ), 0);
  const satisfiedToolCount = taskStarts.reduce((sum, notification, index) => {
    const completion = completed[index];
    if (!completion || completion.type !== "director.completed") return sum;
    const actual = new Set(completion.payload.toolNames ?? []);
    return sum + (notification.type === "director.started"
      ? (notification.payload.requiredToolNames ?? []).filter((name) => actual.has(name)).length
      : 0);
  }, 0);
  const taskCount = completed.length;
  return {
    scheduledCount: scheduled.length,
    callCount: started.length,
    immediateScheduleCount: Math.max(0, scheduled.length - nonImmediateScheduleCount),
    batchScheduleCount,
    scheduleReasons,
    averageEventsPerCall: average(
      started.reduce((sum, notification) => (
        sum + (notification.type === "director.started"
          ? notification.payload.eventCount
          : 0)
      ), 0),
      started.length,
    ),
    taskCount,
    taskCompleteCount,
    taskPartialCount,
    taskEmptyCount,
    taskRetryCount,
    taskCompletionRate: taskCount > 0 ? taskCompleteCount / taskCount : 0,
    taskToolComplianceRate: requiredToolCount > 0
      ? satisfiedToolCount / requiredToolCount
      : 1,
  };
}

export function buildTranscript(
  events: readonly WorldEvent[],
): WorldRunTranscriptEntry[] {
  const entries: WorldRunTranscriptEntry[] = [];
  for (const event of events) {
    const payload = objectValue(event.payload);
    if (event.type === "context.message.committed") {
      const message = objectValue(payload.message);
      const text = stringValue(message.message);
      if (!text) continue;
      entries.push({
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        contextId: event.contextId,
        actorId: event.actorId,
        kind: "message",
        speaker: stringValue(message.characterName),
        text,
      });
    } else if (event.type === "context.action.committed") {
      const action = objectValue(payload.action);
      const text = stringValue(action.action);
      if (!text) continue;
      entries.push({
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        contextId: event.contextId,
        actorId: event.actorId,
        kind: "action",
        speaker: stringValue(action.characterName),
        text,
      });
    } else if (event.type === "narrative.narration.committed") {
      const narration = objectValue(payload.narration);
      const text = stringValue(narration.text);
      if (!text) continue;
      entries.push({
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        contextId: event.contextId,
        kind: "narration",
        speaker: "旁白",
        text,
      });
    }
  }
  return entries;
}

class TokenAccumulator {
  private readonly totals = emptyTotals();
  private readonly byRole = new Map<string, WorldTokenUsageTotals>();
  private readonly byPurpose = new Map<string, WorldTokenUsageTotals>();
  private readonly byActor = new Map<string, WorldTokenUsageTotals>();
  private readonly byModel = new Map<string, WorldTokenUsageTotals>();

  add(event: WorldDebugEvent): void {
    const usage = tokenUsage(event.payload.usage);
    if (!usage) return;
    const delta: WorldTokenUsageTotals = {
      requestCount: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheHitInputTokens: usage.cacheHitInputTokens ?? 0,
      cacheMissInputTokens: usage.cacheMissInputTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
    };
    addTotals(this.totals, delta);
    const requestContext = objectValue(event.payload.requestContext);
    addBreakdown(this.byRole, stringValue(event.payload.providerRole), delta);
    addBreakdown(this.byPurpose, stringValue(requestContext.purpose), delta);
    addBreakdown(
      this.byActor,
      stringValue(requestContext.actorId) ?? event.actorId,
      delta,
    );
    addBreakdown(this.byModel, usage.model, delta);
  }

  snapshot(): RawTokenUsage {
    return {
      ...this.totals,
      byRole: breakdown(this.byRole),
      byPurpose: breakdown(this.byPurpose),
      byActor: breakdown(this.byActor),
      byModel: breakdown(this.byModel),
    };
  }
}

type RawTokenUsage = WorldTokenUsageTotals & {
  byRole: WorldTokenUsageBreakdown[];
  byPurpose: WorldTokenUsageBreakdown[];
  byActor: WorldTokenUsageBreakdown[];
  byModel: WorldTokenUsageBreakdown[];
};

function countBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function latencyMetrics(values: number[]): WorldRunLatencyMetrics {
  if (!values.length) {
    return { sampleCount: 0, averageMs: 0, maximumMs: 0, p95Ms: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
  );
  return {
    sampleCount: sorted.length,
    averageMs: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    maximumMs: Math.round(sorted[sorted.length - 1] ?? 0),
    p95Ms: Math.round(sorted[p95Index] ?? 0),
  };
}

function average(total: number, count: number): number {
  return count > 0 ? Math.round((total / count) * 100) / 100 : 0;
}

function toolCallName(value: unknown): string | undefined {
  const call = objectValue(value);
  const fn = objectValue(call.function);
  return stringValue(fn.name);
}

function tokenUsage(value: unknown): TokenUsage | undefined {
  const usage = objectValue(value);
  const inputTokens = finiteNumber(usage.inputTokens);
  const outputTokens = finiteNumber(usage.outputTokens);
  const totalTokens = finiteNumber(usage.totalTokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheHitInputTokens: finiteNumber(usage.cacheHitInputTokens),
    cacheMissInputTokens: finiteNumber(usage.cacheMissInputTokens),
    reasoningTokens: finiteNumber(usage.reasoningTokens),
    provider: stringValue(usage.provider),
    model: stringValue(usage.model),
    protocol: providerProtocol(usage.protocol),
  };
}

function providerProtocol(value: unknown): ProviderProtocol | undefined {
  return isProviderProtocol(value) ? value : undefined;
}

function emptyTotals(): WorldTokenUsageTotals {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
    reasoningTokens: 0,
  };
}

function addTotals(
  target: WorldTokenUsageTotals,
  delta: WorldTokenUsageTotals,
): void {
  target.requestCount += delta.requestCount;
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.totalTokens += delta.totalTokens;
  target.cacheHitInputTokens += delta.cacheHitInputTokens;
  target.cacheMissInputTokens += delta.cacheMissInputTokens;
  target.reasoningTokens += delta.reasoningTokens;
}

function addBreakdown(
  target: Map<string, WorldTokenUsageTotals>,
  key: string | undefined,
  delta: WorldTokenUsageTotals,
): void {
  if (!key) return;
  const totals = target.get(key) ?? emptyTotals();
  addTotals(totals, delta);
  target.set(key, totals);
}

function breakdown(
  values: ReadonlyMap<string, WorldTokenUsageTotals>,
): WorldTokenUsageBreakdown[] {
  return [...values.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}
