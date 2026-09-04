import { WORLD_BENCHMARK_SCHEMA_VERSION } from "./types.js";

export interface StudioBenchmarkScenario {
  schemaVersion: typeof WORLD_BENCHMARK_SCHEMA_VERSION;
  id: string;
  version: string;
  name: string;
  description: string;
  instruction: string;
  researchEnabled: boolean;
  budget: {
    maxProviderCalls: number;
    maxTotalTokens: number;
  };
  requirements: {
    minResearchCalls: number;
    minSources: number;
    minOperations: number;
    minActors: number;
    minContexts: number;
    minChapters: number;
    requirePlayer: boolean;
  };
}

export interface StudioBenchmarkObservation {
  schemaVersion: typeof WORLD_BENCHMARK_SCHEMA_VERSION;
  runId: string;
  scenarioId: string;
  engine: { name: string; version?: string; adapter: string };
  researchCalls: number;
  sourceCount: number;
  providerCalls: number;
  totalTokens: number;
  operationTypes: string[];
  changeSetCreated: boolean;
  summary: string;
  draft: {
    revision: number;
    actorCount: number;
    contextCount: number;
    chapterCount: number;
    hasPlayer: boolean;
    validationErrorCount: number;
  };
  failures: string[];
  raw?: unknown;
}

export interface StudioBenchmarkEngineAdapter {
  readonly name: string;
  readonly version?: string;
  run(
    scenario: StudioBenchmarkScenario,
    options?: { runId?: string; signal?: AbortSignal },
  ): Promise<StudioBenchmarkObservation>;
}

export interface StudioBenchmarkResult {
  scenario: StudioBenchmarkScenario;
  observation: StudioBenchmarkObservation;
  passed: boolean;
  percentage: number;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

export const researchToWorldStudioScenario: StudioBenchmarkScenario = {
  schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
  id: "cvwb-studio-001-research-to-world",
  version: "1.0.0",
  name: "检索后完成世界草稿",
  description: "从空白草稿出发，检索公开历史资料并在同一次 Agent 运行中形成可审查的世界修改，防止研究耗尽 loop 后空收尾。",
  instruction: "请检索赤壁之战前夕周瑜、诸葛亮与鲁肃的公开历史背景，然后据此创建一个写实但允许玩家参与的世界。玩家扮演随军书记，必须有完整玩家身份、至少两名 AI 角色、一个开场场景和一条未解决剧情线。资料不确定处请保留边界，但本轮必须形成可确认的草稿修改。",
  researchEnabled: true,
  budget: { maxProviderCalls: 12, maxTotalTokens: 150_000 },
  requirements: {
    minResearchCalls: 1,
    minSources: 0,
    minOperations: 5,
    minActors: 2,
    minContexts: 1,
    minChapters: 1,
    requirePlayer: true,
  },
};

export function createStudioBenchV1Scenarios(): StudioBenchmarkScenario[] {
  return [researchToWorldStudioScenario];
}

export async function runStudioBenchmarkScenario(
  adapter: StudioBenchmarkEngineAdapter,
  scenario: StudioBenchmarkScenario,
  options?: { runId?: string; signal?: AbortSignal },
): Promise<StudioBenchmarkResult> {
  const observation = await adapter.run(scenario, options);
  return scoreStudioBenchmark(scenario, observation);
}

export function scoreStudioBenchmark(
  scenario: StudioBenchmarkScenario,
  observation: StudioBenchmarkObservation,
): StudioBenchmarkResult {
  const requirement = scenario.requirements;
  const checks = [
    check("research", observation.researchCalls >= requirement.minResearchCalls, `${observation.researchCalls}/${requirement.minResearchCalls}`),
    check("sources", observation.sourceCount >= requirement.minSources, `${observation.sourceCount}/${requirement.minSources}`),
    check("changeset", observation.changeSetCreated, `created=${observation.changeSetCreated}`),
    check("operations", observation.operationTypes.length >= requirement.minOperations, `${observation.operationTypes.length}/${requirement.minOperations}`),
    check("actors", observation.draft.actorCount >= requirement.minActors, `${observation.draft.actorCount}/${requirement.minActors}`),
    check("contexts", observation.draft.contextCount >= requirement.minContexts, `${observation.draft.contextCount}/${requirement.minContexts}`),
    check("chapters", observation.draft.chapterCount >= requirement.minChapters, `${observation.draft.chapterCount}/${requirement.minChapters}`),
    check("player", !requirement.requirePlayer || observation.draft.hasPlayer, `present=${observation.draft.hasPlayer}`),
    check("validation", observation.draft.validationErrorCount === 0, `errors=${observation.draft.validationErrorCount}`),
    check("summary", Boolean(observation.summary.trim()) && observation.summary !== "本轮没有产生修改。", observation.summary || "(empty)"),
    check("provider-budget", observation.providerCalls <= scenario.budget.maxProviderCalls, `${observation.providerCalls}/${scenario.budget.maxProviderCalls}`),
    check("token-budget", observation.totalTokens <= scenario.budget.maxTotalTokens, `${observation.totalTokens}/${scenario.budget.maxTotalTokens}`),
    check("failures", observation.failures.length === 0, observation.failures.join("; ") || "none"),
  ];
  const passedCount = checks.filter((item) => item.passed).length;
  return {
    scenario,
    observation,
    passed: passedCount === checks.length,
    percentage: checks.length ? (passedCount / checks.length) * 100 : 100,
    checks,
  };
}

function check(id: string, passed: boolean, detail: string) {
  return { id, passed, detail };
}
