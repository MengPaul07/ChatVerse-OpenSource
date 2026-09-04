import type {
  BenchmarkActorObservation,
  BenchmarkActionType,
  BenchmarkCapability,
  BenchmarkMetrics,
  BenchmarkObservation,
  BenchmarkOperation,
  BenchmarkVisibleEntry,
} from "./types.js";

/**
 * The bridge intentionally accepts a small structural view instead of
 * importing World Run Lab. The benchmark package stays independent from the
 * current runner and can be used by another engine without a dependency
 * cycle.
 */
export interface ChatVerseWorldRunReportLike {
  runId: string;
  scenario: { id: string };
  events: readonly ChatVerseEventLike[];
  notifications: readonly ChatVerseNotificationLike[];
  debug: readonly ChatVerseDebugLike[];
  metrics: ChatVerseMetricsLike;
  steps?: readonly ChatVerseStepLike[];
  checkpoints?: readonly unknown[];
  durationMs?: number;
}

interface ChatVerseEventLike {
  sequence: number;
  type: string;
  contextId?: string;
  actorId?: string;
  payload: unknown;
}

interface ChatVerseNotificationLike {
  sequence: number;
  type: string;
  payload: unknown;
}

interface ChatVerseDebugLike {
  event: {
    type: string;
    actorId?: string;
    payload: unknown;
  };
}

interface ChatVerseStepLike {
  id?: string;
  type: string;
  status: "passed" | "failed";
  eventSequenceBefore: number;
  eventSequenceAfter: number;
  error?: string;
}

interface ChatVerseMetricsLike {
  tokenUsage: {
    requestCount: number;
    totalTokens: number;
    cacheHitRate: number;
    byPurpose?: readonly { key: string; requestCount: number }[];
  };
  providerLatency: { maximumMs?: number };
  stability: { wallTimeMs?: number; stallCount: number };
  director: { callCount: number };
  toolUsage?: { byName: Record<string, number> };
}

export function toBenchmarkObservation(
  report: ChatVerseWorldRunReportLike,
  options: {
    engineRevision?: string;
    adapterName?: string;
    capabilities?: BenchmarkCapability[];
    initialActors?: readonly {
      id: string;
      name: string;
      lifecycle?: "persistent" | "scene";
    }[];
  } = {},
): BenchmarkObservation {
  const entries = buildEntries(report.events);
  const actors = buildActors(report.events, entries, options.initialActors);
  const operations = buildOperations(report.notifications, report.debug);
  const toolCalls = buildToolCalls(report.notifications, report.debug, report.checkpoints, report.metrics.toolUsage);
  const metrics: BenchmarkMetrics = {
    providerCalls: report.metrics.tokenUsage.requestCount,
    directorCalls: report.metrics.director.callCount,
    narratorCalls: requestCountForPurpose(report.metrics.tokenUsage.byPurpose, "world_narrator")
      ?? operations.filter((operation) => operation.component === "narrator").length,
    actorCalls: requestCountForPurpose(report.metrics.tokenUsage.byPurpose, "actor_decision")
      ?? operations.filter((operation) => operation.component === "actor").length,
    totalTokens: report.metrics.tokenUsage.totalTokens,
    cacheHitRate: report.metrics.tokenUsage.cacheHitRate,
    wallTimeMs: report.durationMs ?? report.metrics.stability.wallTimeMs ?? report.metrics.providerLatency.maximumMs ?? 0,
    stallCount: report.metrics.stability.stallCount,
  };
  return {
    schemaVersion: 1,
    runId: report.runId,
    scenarioId: report.scenario.id,
    engine: {
      name: "ChatVerse World",
      revision: options.engineRevision,
      adapter: options.adapterName ?? "chatverse-world-run-lab",
    },
    capabilities: options.capabilities ?? [],
    actions: (report.steps ?? []).map((step) => ({
      id: step.id ?? `step-${step.eventSequenceBefore}-${step.eventSequenceAfter}`,
      type: normalizeActionType(step.type),
      status: step.status === "passed" ? "completed" : "failed",
      eventSequenceBefore: step.eventSequenceBefore,
      eventSequenceAfter: step.eventSequenceAfter,
      ...(step.error ? { error: step.error } : {}),
    })),
    entries,
    actors,
    operations,
    toolCalls,
    metrics,
    failures: collectFailures(report),
    raw: report,
  };
}

function buildEntries(events: readonly ChatVerseEventLike[]): BenchmarkVisibleEntry[] {
  const entries: BenchmarkVisibleEntry[] = [];
  for (const event of events) {
    const payload = record(event.payload);
    if (event.type === "context.message.committed") {
      const message = record(payload.message);
      const text = stringValue(message.message);
      if (text) entries.push({
        sequence: event.sequence,
        contextId: event.contextId,
        actorId: event.actorId,
        speaker: stringValue(message.characterName),
        kind: "message",
        text,
      });
    } else if (event.type === "context.action.committed") {
      const action = record(payload.action);
      const text = stringValue(action.action);
      if (text) entries.push({
        sequence: event.sequence,
        contextId: event.contextId,
        actorId: event.actorId,
        speaker: stringValue(action.characterName),
        kind: "action",
        text,
      });
    } else if (event.type === "narrative.narration.committed") {
      const narration = record(payload.narration);
      const text = stringValue(narration.text);
      if (text) entries.push({
        sequence: event.sequence,
        contextId: event.contextId,
        kind: "narration",
        speaker: "旁白",
        text,
      });
    }
  }
  return entries;
}

function buildActors(
  events: readonly ChatVerseEventLike[],
  entries: readonly BenchmarkVisibleEntry[],
  initialActors: readonly {
    id: string;
    name: string;
    lifecycle?: "persistent" | "scene";
  }[] | undefined,
): BenchmarkActorObservation[] {
  const actors = new Map<string, BenchmarkActorObservation>();
  for (const actor of initialActors ?? []) {
    actors.set(actor.id, {
      id: actor.id,
      name: actor.name,
      lifecycle: actor.lifecycle ?? "persistent",
      joinedAtSequence: 0,
      messageCount: 0,
    });
  }
  for (const event of events) {
    if (event.type !== "actor.registered" || !event.actorId) continue;
    const payload = record(event.payload);
    actors.set(event.actorId, {
      id: event.actorId,
      name: stringValue(payload.name) ?? event.actorId,
      lifecycle: payload.lifecycle === "persistent" ? "persistent" : "scene",
      joinedAtSequence: event.sequence,
      messageCount: 0,
    });
  }
  for (const entry of entries) {
    if (!entry.actorId) continue;
    const actor = actors.get(entry.actorId);
    if (actor) actor.messageCount++;
  }
  return [...actors.values()];
}

function buildOperations(
  notifications: readonly ChatVerseNotificationLike[],
  debug: readonly ChatVerseDebugLike[],
): BenchmarkOperation[] {
  const operations: BenchmarkOperation[] = [];
  for (const notification of notifications) {
    const component = notificationComponent(notification.type);
    if (!component) continue;
    operations.push({
      sequence: notification.sequence,
      component,
      name: notification.type,
      outcome: notification.type.endsWith("error") ? "error" : "completed",
    });
  }
  for (const record of debug) {
    const component = debugComponent(record.event.type);
    if (!component) continue;
    operations.push({
      sequence: 0,
      component,
      name: record.event.type,
      outcome: record.event.type.endsWith("error") ? "error" : "completed",
      actorId: record.event.actorId,
    });
  }
  return operations;
}

function buildToolCalls(
  notifications: readonly ChatVerseNotificationLike[],
  debug: readonly ChatVerseDebugLike[],
  checkpoints: readonly unknown[] | undefined,
  toolUsage: { byName: Record<string, number> } | undefined,
): BenchmarkObservation["toolCalls"] {
  const calls: BenchmarkObservation["toolCalls"] = [];
  const countedTools = Object.entries(toolUsage?.byName ?? {});
  if (countedTools.length > 0) {
    for (const [name, count] of countedTools) {
      for (let index = 0; index < count; index++) {
        calls.push({ sequence: 0, name: normalizeToolName(name), outcome: "accepted", component: "tool" });
      }
    }
  }
  for (const notification of notifications) {
    if (notification.type !== "director.completed") continue;
    if (countedTools.length > 0) continue;
    const payload = record(notification.payload);
    const names = Array.isArray(payload.toolNames) ? payload.toolNames : [];
    for (const name of names) {
      if (typeof name !== "string") continue;
      calls.push({ sequence: notification.sequence, name: normalizeToolName(name), outcome: "accepted", component: "director" });
    }
  }
  for (const debugRecord of debug) {
    if (countedTools.length > 0) break;
    const payload = recordValue(debugRecord.event.payload);
    const values = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
    for (const value of values) {
      const call = recordValue(value);
      const fn = recordValue(call.function);
      const name = stringValue(fn.name);
      if (name) calls.push({ sequence: 0, name: normalizeToolName(name), outcome: "accepted", component: "tool" });
    }
  }
  for (const checkpoint of checkpoints ?? []) {
    if (checkpoint !== undefined) {
      calls.push({ sequence: 0, name: "runtime.snapshot_restore", outcome: "accepted", component: "runtime" });
    }
  }
  return calls;
}

function requestCountForPurpose(
  values: readonly { key: string; requestCount: number }[] | undefined,
  purpose: string,
): number | undefined {
  const entry = values?.find((value) => value.key === purpose);
  return entry?.requestCount;
}

function normalizeActionType(type: string): BenchmarkActionType {
  const known: Record<string, BenchmarkActionType> = {
    progression: "start",
    message: "player_message",
    directive: "player_directive",
    event: "world_event",
    wait: "wait",
    pause: "pause",
    resume: "resume",
    snapshot: "snapshot",
    restore: "restore",
  };
  return known[type] ?? (type as BenchmarkActionType);
}

function collectFailures(report: ChatVerseWorldRunReportLike): string[] {
  const failures: string[] = [];
  for (const event of report.events) {
    if (event.type.endsWith("error")) failures.push(event.type);
  }
  for (const notification of report.notifications) {
    if (notification.type.endsWith("error")) failures.push(notification.type);
  }
  return [...new Set(failures)];
}

function notificationComponent(type: string): BenchmarkOperation["component"] | undefined {
  if (type.startsWith("director.")) return "director";
  if (type.startsWith("narrator.")) return "narrator";
  if (type.startsWith("actor.")) return "actor";
  if (type.startsWith("presentation.")) return "runtime";
  return undefined;
}

function debugComponent(type: string): BenchmarkOperation["component"] | undefined {
  if (type.startsWith("provider.")) return "runtime";
  if (type.startsWith("director.")) return "director";
  if (type.startsWith("narrator.")) return "narrator";
  if (type.startsWith("actor.")) return "actor";
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const record = recordValue;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeToolName(name: string): string {
  const known: Record<string, string> = {
    dismiss_spawned_actor: "macro.dismiss_actor",
    inspect_context: "context.inspect",
    query_narrative: "narrative.query",
    advance_world_time: "world.advance_time",
    verify_life_support: "evidence.verify_life_support",
    snapshot_restore: "runtime.snapshot_restore",
  };
  return known[name] ?? name;
}
