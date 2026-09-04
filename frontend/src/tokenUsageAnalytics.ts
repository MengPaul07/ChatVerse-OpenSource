import type { TokenUsageRecord } from "./world/types";

export interface TokenUsageFilters {
  from?: number;
  to?: number;
  worldId?: string;
  modelKey?: string;
  purpose?: string;
}

export interface TokenUsageTotals {
  requestCount: number;
  inputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  unknownCacheInputTokens: number;
  measuredInputTokens: number;
  visibleOutputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenUsageBreakdown extends TokenUsageTotals {
  key: string;
  label: string;
}

export interface DailyTokenUsage extends TokenUsageTotals {
  key: string;
  timestamp: number;
}

export interface TokenUsageAnalytics {
  records: TokenUsageRecord[];
  totals: TokenUsageTotals;
  byDay: DailyTokenUsage[];
  byModel: TokenUsageBreakdown[];
  byWorld: TokenUsageBreakdown[];
  byPurpose: TokenUsageBreakdown[];
}

export function buildTokenUsageAnalytics(
  records: readonly TokenUsageRecord[],
  filters: TokenUsageFilters = {},
): TokenUsageAnalytics {
  const filtered = records.filter((record) => matchesFilters(record, filters));
  const totals = emptyTotals();
  const byDay = new Map<string, DailyTokenUsage>();
  const byModel = new Map<string, TokenUsageBreakdown>();
  const byWorld = new Map<string, TokenUsageBreakdown>();
  const byPurpose = new Map<string, TokenUsageBreakdown>();

  for (const record of filtered) {
    const usage = usageFromRecord(record);
    addUsage(totals, usage);
    const dayKey = localDateKey(record.occurredAt);
    const day = byDay.get(dayKey) ?? {
      key: dayKey,
      timestamp: startOfLocalDay(record.occurredAt),
      ...emptyTotals(),
    };
    addUsage(day, usage);
    byDay.set(dayKey, day);

    addBreakdown(byModel, modelKey(record), modelLabel(record), usage);
    addBreakdown(byWorld, record.worldId, record.worldName || "未命名世界", usage);
    addBreakdown(byPurpose, record.purpose ?? "other", purposeLabel(record.purpose), usage);
  }

  return {
    records: filtered,
    totals,
    byDay: [...byDay.values()].sort((left, right) => left.timestamp - right.timestamp),
    byModel: sortedBreakdown(byModel),
    byWorld: sortedBreakdown(byWorld),
    byPurpose: sortedBreakdown(byPurpose),
  };
}

export function modelKey(record: TokenUsageRecord): string {
  return `${record.provider || "unknown"}/${record.model || "unknown"}`;
}

export function purposeLabel(purpose?: string): string {
  const labels: Record<string, string> = {
    world_director: "世界导演",
    world_narrator: "世界旁白",
    player_actor: "玩家代演",
    actor_decision: "角色判断",
    actor_response: "角色表达",
    actor_memory: "记忆整理",
    world_authoring: "世界创作",
    world_authoring_research: "联网研究",
    history_compression: "上下文压缩",
    other: "其他调用",
  };
  return labels[purpose ?? "other"] ?? purpose ?? "其他调用";
}

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function matchesFilters(record: TokenUsageRecord, filters: TokenUsageFilters): boolean {
  if (filters.from !== undefined && record.occurredAt < filters.from) return false;
  if (filters.to !== undefined && record.occurredAt > filters.to) return false;
  if (filters.worldId && record.worldId !== filters.worldId) return false;
  if (filters.modelKey && modelKey(record) !== filters.modelKey) return false;
  if (filters.purpose && (record.purpose ?? "other") !== filters.purpose) return false;
  return true;
}

function usageFromRecord(record: TokenUsageRecord): TokenUsageTotals {
  const input = positive(record.inputTokens);
  const output = positive(record.outputTokens);
  const reasoning = Math.min(output, positive(record.reasoningTokens));
  const cacheHit = record.cacheMetricsReported
    ? Math.min(input, positive(record.cacheHitInputTokens))
    : 0;
  const cacheMiss = record.cacheMetricsReported && record.cacheMissInputTokens !== undefined
    ? Math.min(input - cacheHit, positive(record.cacheMissInputTokens))
    : 0;
  return {
    requestCount: 1,
    inputTokens: input,
    cacheHitInputTokens: cacheHit,
    cacheMissInputTokens: cacheMiss,
    unknownCacheInputTokens: record.cacheMetricsReported ? Math.max(0, input - cacheHit - cacheMiss) : input,
    measuredInputTokens: record.cacheMetricsReported ? input : 0,
    visibleOutputTokens: Math.max(0, output - reasoning),
    reasoningTokens: reasoning,
    outputTokens: output,
    totalTokens: positive(record.totalTokens),
  };
}

function emptyTotals(): TokenUsageTotals {
  return {
    requestCount: 0,
    inputTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
    unknownCacheInputTokens: 0,
    measuredInputTokens: 0,
    visibleOutputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function addBreakdown(
  target: Map<string, TokenUsageBreakdown>,
  key: string,
  label: string,
  usage: TokenUsageTotals,
): void {
  const row = target.get(key) ?? { key, label, ...emptyTotals() };
  addUsage(row, usage);
  target.set(key, row);
}

function addUsage(target: TokenUsageTotals, usage: TokenUsageTotals): void {
  target.requestCount += usage.requestCount;
  target.inputTokens += usage.inputTokens;
  target.cacheHitInputTokens += usage.cacheHitInputTokens;
  target.cacheMissInputTokens += usage.cacheMissInputTokens;
  target.unknownCacheInputTokens += usage.unknownCacheInputTokens;
  target.measuredInputTokens += usage.measuredInputTokens;
  target.visibleOutputTokens += usage.visibleOutputTokens;
  target.reasoningTokens += usage.reasoningTokens;
  target.outputTokens += usage.outputTokens;
  target.totalTokens += usage.totalTokens;
}

function sortedBreakdown(values: ReadonlyMap<string, TokenUsageBreakdown>): TokenUsageBreakdown[] {
  return [...values.values()].sort((left, right) => right.totalTokens - left.totalTokens);
}

function modelLabel(record: TokenUsageRecord): string {
  const provider = record.provider || "未知服务商";
  const model = record.model || "未知模型";
  return `${provider} / ${model}`;
}

function positive(value?: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
