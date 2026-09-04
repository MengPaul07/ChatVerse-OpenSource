/**
 * Release budgets for the HTTP/SSE acceptance flows.
 *
 * These checks are part of CVWB because they describe observable runtime
 * quality (cost, cache stability and ambient scheduling), not a particular
 * test script or server implementation.
 */

export const E2E_PHASES = [
  "bootstrap",
  "player-message",
  "observer-progression",
  "lifecycle-controls",
] as const;

export type E2ePhase = (typeof E2E_PHASES)[number];

export interface E2eBudget {
  maxProviderCalls: number;
  maxTotalTokens: number;
  minCacheHitRate: number;
  maxBootstrapDirectorCalls: number;
  maxPlayerActorCalls: number;
  maxAmbientTriggers: number;
}

export const DEFAULT_E2E_BUDGET: Readonly<E2eBudget> = Object.freeze({
  maxProviderCalls: 18,
  maxTotalTokens: 50_000,
  minCacheHitRate: 0.85,
  maxBootstrapDirectorCalls: 1,
  maxPlayerActorCalls: 3,
  maxAmbientTriggers: 0,
});

export interface E2eUsageRecord {
  providerRole?: string;
  model?: string;
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  cacheHitInputTokens?: unknown;
  cacheMissInputTokens?: unknown;
  cacheMetricsReported?: boolean;
}

export interface E2eUsageMessage {
  kind: "world_event" | "world_notification" | "usage_recorded";
  observedPhase?: string;
  record?: E2eUsageRecord;
  notification?: { type?: string };
}

export interface E2eBreakdown {
  calls: number;
  totalTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
}

export interface E2eMetrics {
  durationMs: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  cacheMeasuredInputTokens: number;
  cacheHitRate: number;
  eventCount: number;
  notificationCount: number;
  ambientTriggers: number;
  byRole: Record<string, E2eBreakdown>;
  byModel: Record<string, E2eBreakdown>;
}

export interface E2eUsageSummary {
  total: E2eMetrics;
  phases: Record<E2ePhase, E2eMetrics>;
}

export interface E2eBudgetCheck {
  id: string;
  label: string;
  actual: number;
  limit: number;
  operator: "<=" | ">=";
  passed: boolean;
}

export interface E2eBudgetEvaluation {
  passed: boolean;
  checks: E2eBudgetCheck[];
}

export function resolveE2eBudget(
  environment: Record<string, string | undefined> = runtimeEnvironment(),
): E2eBudget {
  return {
    maxProviderCalls: positiveInteger(environment.WORLD_E2E_MAX_CALLS, DEFAULT_E2E_BUDGET.maxProviderCalls),
    maxTotalTokens: positiveInteger(environment.WORLD_E2E_MAX_TOKENS, DEFAULT_E2E_BUDGET.maxTotalTokens),
    minCacheHitRate: boundedRate(environment.WORLD_E2E_MIN_CACHE_HIT_RATE, DEFAULT_E2E_BUDGET.minCacheHitRate),
    maxBootstrapDirectorCalls: nonNegativeInteger(
      environment.WORLD_E2E_MAX_BOOTSTRAP_DIRECTOR_CALLS,
      DEFAULT_E2E_BUDGET.maxBootstrapDirectorCalls,
    ),
    maxPlayerActorCalls: nonNegativeInteger(
      environment.WORLD_E2E_MAX_PLAYER_ACTOR_CALLS,
      DEFAULT_E2E_BUDGET.maxPlayerActorCalls,
    ),
    maxAmbientTriggers: nonNegativeInteger(
      environment.WORLD_E2E_MAX_AMBIENT_TRIGGERS,
      DEFAULT_E2E_BUDGET.maxAmbientTriggers,
    ),
  };
}

export function summarizeE2eUsage(
  messages: readonly E2eUsageMessage[],
  phaseDurations: Partial<Record<E2ePhase, number>> = {},
): E2eUsageSummary {
  const phases = Object.fromEntries(E2E_PHASES.map((phase) => [phase, emptyMetrics()])) as Record<E2ePhase, E2eMetrics>;
  const total = emptyMetrics();

  for (const message of messages) {
    const phase = isE2ePhase(message.observedPhase) ? phases[message.observedPhase] : undefined;
    if (message.kind === "world_event") {
      total.eventCount++;
      if (phase) phase.eventCount++;
    }
    if (message.kind === "world_notification") {
      total.notificationCount++;
      if (phase) phase.notificationCount++;
      if (message.notification?.type === "context.ambient_triggered") {
        total.ambientTriggers++;
        if (phase) phase.ambientTriggers++;
      }
    }
    if (message.kind === "usage_recorded") {
      addUsage(total, message.record);
      if (phase) addUsage(phase, message.record);
    }
  }

  for (const phase of E2E_PHASES) {
    phases[phase].durationMs = Math.max(0, Number(phaseDurations[phase] ?? 0));
    finishMetrics(phases[phase]);
  }
  finishMetrics(total);
  total.durationMs = E2E_PHASES.reduce((sum, phase) => sum + phases[phase].durationMs, 0);
  return { total, phases };
}

export function evaluateE2eBudget(
  summary: E2eUsageSummary,
  budget: E2eBudget,
): E2eBudgetEvaluation {
  const bootstrapDirectorCalls = roleCalls(summary.phases.bootstrap, "world_director");
  const playerActorCalls = roleCalls(summary.phases["player-message"], "character");
  const checks = [
    maximumCheck("provider_calls", "Provider 调用总数", summary.total.providerCalls, budget.maxProviderCalls),
    maximumCheck("total_tokens", "Token 总量", summary.total.totalTokens, budget.maxTotalTokens),
    minimumCheck("cache_hit_rate", "缓存命中率", summary.total.cacheHitRate, budget.minCacheHitRate),
    maximumCheck("bootstrap_director_calls", "开场 Director 调用数", bootstrapDirectorCalls, budget.maxBootstrapDirectorCalls),
    maximumCheck("player_actor_calls", "玩家消息阶段 Actor 调用数", playerActorCalls, budget.maxPlayerActorCalls),
    maximumCheck("ambient_triggers", "验收期间 Ambient 触发数", summary.total.ambientTriggers, budget.maxAmbientTriggers),
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

function emptyMetrics(): E2eMetrics {
  return {
    durationMs: 0,
    providerCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
    cacheMeasuredInputTokens: 0,
    cacheHitRate: 0,
    eventCount: 0,
    notificationCount: 0,
    ambientTriggers: 0,
    byRole: {},
    byModel: {},
  };
}

function addUsage(metrics: E2eMetrics, record: E2eUsageRecord | undefined): void {
  const inputTokens = finiteNumber(record?.inputTokens);
  const outputTokens = finiteNumber(record?.outputTokens);
  const totalTokens = finiteNumber(record?.totalTokens) || inputTokens + outputTokens;
  const cacheHit = finiteNumber(record?.cacheHitInputTokens);
  const cacheMiss = finiteNumber(record?.cacheMissInputTokens);
  metrics.providerCalls++;
  metrics.inputTokens += inputTokens;
  metrics.outputTokens += outputTokens;
  metrics.totalTokens += totalTokens;
  metrics.cacheHitInputTokens += cacheHit;
  metrics.cacheMissInputTokens += cacheMiss;
  if (record?.cacheMetricsReported || cacheHit > 0 || cacheMiss > 0) {
    metrics.cacheMeasuredInputTokens += cacheHit + cacheMiss;
  }
  addBreakdown(metrics.byRole, record?.providerRole || "unknown", totalTokens, cacheHit, cacheMiss);
  addBreakdown(metrics.byModel, record?.model || "unknown", totalTokens, cacheHit, cacheMiss);
}

function addBreakdown(
  target: Record<string, E2eBreakdown>,
  key: string,
  tokens: number,
  cacheHit: number,
  cacheMiss: number,
): void {
  const current = target[key] ?? {
    calls: 0,
    totalTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
  };
  current.calls++;
  current.totalTokens += tokens;
  current.cacheHitInputTokens += cacheHit;
  current.cacheMissInputTokens += cacheMiss;
  target[key] = current;
}

function finishMetrics(metrics: E2eMetrics): void {
  metrics.cacheHitRate = metrics.cacheMeasuredInputTokens > 0
    ? metrics.cacheHitInputTokens / metrics.cacheMeasuredInputTokens
    : 0;
}

function roleCalls(metrics: E2eMetrics, role: string): number {
  return metrics.byRole[role]?.calls ?? 0;
}

function maximumCheck(id: string, label: string, actual: number, limit: number): E2eBudgetCheck {
  return { id, label, actual, limit, operator: "<=", passed: actual <= limit };
}

function minimumCheck(id: string, label: string, actual: number, limit: number): E2eBudgetCheck {
  return { id, label, actual, limit, operator: ">=", passed: actual >= limit };
}

function isE2ePhase(value: string | undefined): value is E2ePhase {
  return value !== undefined && (E2E_PHASES as readonly string[]).includes(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedRate(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function runtimeEnvironment(): Record<string, string | undefined> {
  const global = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return global.process?.env ?? {};
}
