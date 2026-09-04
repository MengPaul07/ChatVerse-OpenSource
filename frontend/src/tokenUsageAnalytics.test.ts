import { describe, expect, it } from "vitest";
import { buildTokenUsageAnalytics } from "./tokenUsageAnalytics";
import type { TokenUsageRecord } from "./world/types";

describe("token usage analytics", () => {
  it("separates cached input, visible output, and reasoning without double counting", () => {
    const analytics = buildTokenUsageAnalytics([
      usage({
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
        cacheHitInputTokens: 70,
        cacheMissInputTokens: 30,
        reasoningTokens: 10,
        cacheMetricsReported: true,
      }),
    ]);

    expect(analytics.totals).toMatchObject({
      inputTokens: 100,
      cacheHitInputTokens: 70,
      cacheMissInputTokens: 30,
      visibleOutputTokens: 20,
      reasoningTokens: 10,
      outputTokens: 30,
      totalTokens: 130,
    });
  });

  it("keeps the remainder unknown when only cache hit is reported", () => {
    const analytics = buildTokenUsageAnalytics([
      usage({ inputTokens: 100, cacheHitInputTokens: 70, cacheMetricsReported: true }),
    ]);

    expect(analytics.totals.cacheHitInputTokens).toBe(70);
    expect(analytics.totals.cacheMissInputTokens).toBe(0);
    expect(analytics.totals.unknownCacheInputTokens).toBe(30);
  });

  it("keeps input with unavailable cache metrics in an unknown segment", () => {
    const analytics = buildTokenUsageAnalytics([
      usage({ inputTokens: 80, outputTokens: 20, totalTokens: 100 }),
    ]);

    expect(analytics.totals.unknownCacheInputTokens).toBe(80);
    expect(analytics.totals.measuredInputTokens).toBe(0);
  });

  it("filters all breakdowns with the same world and model scope", () => {
    const records = [
      usage({ id: "one", worldId: "a", worldName: "甲", model: "m1", totalTokens: 10 }),
      usage({ id: "two", worldId: "b", worldName: "乙", model: "m2", totalTokens: 20 }),
    ];
    const analytics = buildTokenUsageAnalytics(records, { worldId: "b", modelKey: "deepseek/m2" });

    expect(analytics.totals.totalTokens).toBe(20);
    expect(analytics.byWorld.map((row) => row.label)).toEqual(["乙"]);
    expect(analytics.byModel.map((row) => row.label)).toEqual(["deepseek / m2"]);
  });
});

function usage(overrides: Partial<TokenUsageRecord>): TokenUsageRecord {
  return {
    schemaVersion: 1,
    id: "usage",
    occurredAt: Date.now(),
    providerRole: "character",
    operation: "chat",
    purpose: "actor_response",
    provider: "deepseek",
    model: "chat",
    worldId: "world",
    worldName: "测试世界",
    roomId: "room",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheMetricsReported: false,
    ...overrides,
  };
}
