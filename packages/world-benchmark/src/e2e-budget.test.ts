import { describe, expect, it } from "vitest";
import {
  DEFAULT_E2E_BUDGET,
  evaluateE2eBudget,
  resolveE2eBudget,
  summarizeE2eUsage,
} from "./index.js";

describe("CVWB release budgets", () => {
  it("summarizes provider usage by phase, role, and model", () => {
    const summary = summarizeE2eUsage([
      usage("bootstrap", "world_director", "director-model", 1_000, 100, 700, 300),
      usage("bootstrap", "world_narrator", "shared-model", 800, 80, 500, 300),
      usage("player-message", "character", "shared-model", 600, 60, 400, 200),
      {
        kind: "world_notification",
        observedPhase: "observer-progression",
        notification: { type: "context.ambient_triggered" },
      },
    ], { bootstrap: 2_000, "player-message": 1_000 });

    expect(summary.total.providerCalls).toBe(3);
    expect(summary.total.totalTokens).toBe(2_640);
    expect(summary.total.cacheHitRate).toBe(1_600 / 2_400);
    expect(summary.phases.bootstrap.byRole.world_director!.calls).toBe(1);
    expect(summary.phases.bootstrap.byModel["shared-model"]!.calls).toBe(1);
    expect(summary.phases["player-message"].byRole.character!.calls).toBe(1);
    expect(summary.total.ambientTriggers).toBe(1);
    expect(summary.phases.bootstrap.durationMs).toBe(2_000);
  });

  it("reports every exceeded hard budget", () => {
    const summary = summarizeE2eUsage([
      usage("bootstrap", "world_director", "model", 1_000, 100, 500, 500),
      usage("bootstrap", "world_director", "model", 1_000, 100, 500, 500),
      usage("player-message", "character", "model", 1_000, 100, 500, 500),
      usage("player-message", "character", "model", 1_000, 100, 500, 500),
    ]);
    const evaluation = evaluateE2eBudget(summary, {
      maxProviderCalls: 3,
      maxTotalTokens: 4_000,
      minCacheHitRate: 0.75,
      maxBootstrapDirectorCalls: 1,
      maxPlayerActorCalls: 1,
      maxAmbientTriggers: 0,
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([
      "provider_calls",
      "total_tokens",
      "cache_hit_rate",
      "bootstrap_director_calls",
      "player_actor_calls",
    ]);
  });

  it("passes when every release budget stays within its boundary", () => {
    const summary = summarizeE2eUsage([
      usage("bootstrap", "world_director", "model", 1_000, 100, 900, 100),
      usage("bootstrap", "world_narrator", "model", 1_000, 100, 900, 100),
      usage("player-message", "character", "model", 1_000, 100, 900, 100),
    ]);
    const evaluation = evaluateE2eBudget(summary, {
      maxProviderCalls: 3,
      maxTotalTokens: 3_300,
      minCacheHitRate: 0.85,
      maxBootstrapDirectorCalls: 1,
      maxPlayerActorCalls: 1,
      maxAmbientTriggers: 0,
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.every((check) => check.passed)).toBe(true);
  });

  it("reads optional budget overrides without weakening invalid values", () => {
    const budget = resolveE2eBudget({
      WORLD_E2E_MAX_CALLS: "30",
      WORLD_E2E_MAX_TOKENS: "90000",
      WORLD_E2E_MIN_CACHE_HIT_RATE: "0.8",
      WORLD_E2E_MAX_AMBIENT_TRIGGERS: "-1",
    });

    expect(budget.maxProviderCalls).toBe(30);
    expect(budget.maxTotalTokens).toBe(90_000);
    expect(budget.minCacheHitRate).toBe(0.8);
    expect(budget.maxAmbientTriggers).toBe(DEFAULT_E2E_BUDGET.maxAmbientTriggers);
  });
});

function usage(
  phase: string,
  role: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheHitInputTokens: number,
  cacheMissInputTokens: number,
) {
  return {
    kind: "usage_recorded" as const,
    observedPhase: phase,
    record: {
      providerRole: role,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheHitInputTokens,
      cacheMissInputTokens,
      cacheMetricsReported: true,
    },
  };
}
