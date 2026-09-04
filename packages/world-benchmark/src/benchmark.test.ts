import { describe, expect, it } from "vitest";
import {
  createWorldBenchV1Scenarios,
  createCVWBSuiteRegistry,
  findCVWBScenario,
  evaluateAssertion,
  runBenchmarkSuite,
  researchToWorldStudioScenario,
  scoreStudioBenchmark,
  scoreScenario,
  scoreSuite,
  witnessSpawnScenario,
} from "./index.js";
import type { BenchmarkEngineAdapter, BenchmarkObservation } from "./types.js";

function observation(overrides: Partial<BenchmarkObservation> = {}): BenchmarkObservation {
  return {
    schemaVersion: 1,
    runId: "run-test",
    scenarioId: witnessSpawnScenario.id,
    engine: { name: "test-engine", adapter: "test-adapter" },
    capabilities: ["scene_arbitration", "scene_actor_planning", "actor_performance"],
    actions: [{ id: "request-witness", type: "player_message", status: "completed", eventSequenceBefore: 1, eventSequenceAfter: 2 }],
    entries: [{ sequence: 3, actorId: "runtime-generated-id", speaker: "东路目击者", kind: "message", text: "我亲眼看见车辙从东路转向石亭。" }],
    actors: [{ id: "runtime-generated-id", name: "东路目击者", lifecycle: "scene", joinedAtSequence: 3, messageCount: 1 }],
    operations: [
      { sequence: 3, component: "tool", name: "plan_beat", outcome: "accepted" },
      { sequence: 3, component: "narrator", name: "turn", outcome: "completed" },
    ],
    toolCalls: [{ sequence: 3, name: "plan_beat", outcome: "accepted", component: "tool" }],
    metrics: { providerCalls: 3, directorCalls: 1, narratorCalls: 1, actorCalls: 1, totalTokens: 1000, cacheHitRate: 0.9, wallTimeMs: 100, stallCount: 0 },
    failures: [],
    ...overrides,
  };
}

describe("WorldBench v1", () => {
  it("scores a result without depending on the engine's class names", () => {
    const score = scoreScenario(witnessSpawnScenario, observation(), {
      clarity: 4,
      continuity: 4,
    });
    expect(score.status).toBe("complete");
    expect(score.hardGateTriggered).toBe(false);
    expect(score.percentage).toBeGreaterThan(90);
  });

  it("keeps a missing semantic judge score explicit", () => {
    const score = scoreScenario(witnessSpawnScenario, observation());
    expect(score.status).toBe("needs_judge");
    expect(score.criteria.some((criterion) => criterion.pendingJudge)).toBe(true);
  });

  it("ships a scenario registry with diverse capabilities", () => {
    const scenarios = createWorldBenchV1Scenarios();
    expect(scenarios).toHaveLength(5);
    expect(new Set(scenarios.flatMap((scenario) => scenario.tags)).size).toBeGreaterThan(8);
    expect(scenarios.some((scenario) => scenario.requiredCapabilities.includes("scene_actor_planning"))).toBe(true);
    expect(scenarios.some((scenario) => scenario.requiredCapabilities.includes("snapshot_restore"))).toBe(true);
  });

  it("keeps world and Studio profiles in one CVWB catalog", () => {
    const registry = createCVWBSuiteRegistry();
    expect(registry.version).toBe("1.0.0");
    expect(registry.world.map((scenario) => scenario.id)).toEqual(
      createWorldBenchV1Scenarios().map((scenario) => scenario.id),
    );
    expect(registry.studio.map((scenario) => scenario.id)).toContain("cvwb-studio-001-research-to-world");
    expect(findCVWBScenario("cvwb-001-absent-witness")?.profile).toBe("world");
    expect(findCVWBScenario("cvwb-studio-001-research-to-world")?.profile).toBe("studio");
  });

  it("publishes only actions supported by the ChatVerse adapter", () => {
    const unsupported = createWorldBenchV1Scenarios()
      .flatMap((scenario) => scenario.actions)
      .filter((action) => action.type === "provider_fault" || action.type === "advance_time");
    expect(unsupported).toEqual([]);
  });

  it("can verify an engine-generated scene actor without relying on its generated id", () => {
    const result = evaluateAssertion({
      kind: "actor_lifecycle",
      lifecycle: "scene",
      joined: true,
      spoke: true,
    }, observation());
    expect(result.passed).toBe(true);
  });

  it("can verify visible output from a generated scene actor without fixing its name", () => {
    const result = evaluateAssertion({
      kind: "entry_contains",
      actorLifecycle: "scene",
      text: "车辙",
    }, observation());
    expect(result.passed).toBe(true);
  });

  it("aggregates scenario scores and preserves hard-gate failures", () => {
    const result = scoreSuite([witnessSpawnScenario], [observation({ failures: ["deadlock"] })], {
      "run-test": { clarity: 4, continuity: 4 },
    });
    expect(result.aggregate.status).toBe("failed");
    expect(result.aggregate.hardGateCount).toBe(1);
    expect(result.aggregate.percentage).toBeLessThanOrEqual(39);
  });

  it("runs the same scenario contract through an engine adapter", async () => {
    const adapter: BenchmarkEngineAdapter = {
      name: "fake-engine",
      async run(scenario, options) {
        return observation({
          runId: options?.runId ?? "adapter-run",
          scenarioId: scenario.id,
        });
      },
    };
    const result = await runBenchmarkSuite(adapter, [witnessSpawnScenario], { repeats: 2 });
    expect(result.observations).toHaveLength(2);
    expect(result.result.aggregate.scenarioCount).toBe(2);
  });

  it("passes repeat-specific judge scores into suite scoring", async () => {
    const adapter: BenchmarkEngineAdapter = {
      name: "judge-engine",
      async run(scenario, options) {
        return observation({
          runId: options?.runId ?? "judge-run",
          scenarioId: scenario.id,
        });
      },
    };
    const result = await runBenchmarkSuite(adapter, [witnessSpawnScenario], {
      judgeScores: {
        "cvwb-001-absent-witness-run-1": { clarity: 4, continuity: 4 },
      },
    });
    expect(result.result.scores[0]?.status).toBe("complete");
  });

  it("scores the Studio research-to-draft loop by final artifacts", () => {
    const result = scoreStudioBenchmark(researchToWorldStudioScenario, {
      schemaVersion: 1,
      runId: "studio-run",
      scenarioId: researchToWorldStudioScenario.id,
      engine: { name: "Studio", adapter: "test" },
      researchCalls: 1,
      sourceCount: 2,
      providerCalls: 7,
      totalTokens: 20_000,
      operationTypes: ["set_metadata", "set_premise", "set_player", "upsert_actor", "upsert_actor", "upsert_context", "upsert_chapter"],
      changeSetCreated: true,
      summary: "已创建赤壁世界草稿。",
      draft: {
        revision: 7,
        actorCount: 2,
        contextCount: 1,
        chapterCount: 1,
        hasPlayer: true,
        validationErrorCount: 0,
      },
      failures: [],
    });
    expect(result.passed).toBe(true);
    expect(result.percentage).toBe(100);
  });
});
