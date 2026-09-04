import { scoreScenario, scoreSuite } from "./scoring.js";
import type {
  BenchmarkEngineAdapter,
  BenchmarkJudgeScores,
  BenchmarkObservation,
  BenchmarkScenario,
  BenchmarkScore,
  BenchmarkSuiteResult,
} from "./types.js";

export interface BenchmarkRunOptions {
  repeats?: number;
  benchmarkVersion?: string;
  judgeScores?: Record<string, BenchmarkJudgeScores>;
  signal?: AbortSignal;
  onScenario?: (input: {
    scenario: BenchmarkScenario;
    repeat: number;
    totalRepeats: number;
  }) => void;
}

export interface BenchmarkScenarioRun {
  observation: BenchmarkObservation;
  score: BenchmarkScore;
}

export async function runBenchmarkScenario(
  adapter: BenchmarkEngineAdapter,
  scenario: BenchmarkScenario,
  options: {
    runId?: string;
    judgeScores?: BenchmarkJudgeScores;
    signal?: AbortSignal;
  } = {},
): Promise<BenchmarkScenarioRun> {
  const observation = await adapter.run(scenario, {
    runId: options.runId,
    signal: options.signal,
  });
  return {
    observation,
    score: scoreScenario(scenario, observation, options.judgeScores),
  };
}

/**
 * Runs scenarios serially by default. Serial execution keeps provider limits,
 * rate limits and per-run traces attributable to one scenario.
 */
export async function runBenchmarkSuite(
  adapter: BenchmarkEngineAdapter,
  scenarios: readonly BenchmarkScenario[],
  options: BenchmarkRunOptions = {},
): Promise<{
  observations: BenchmarkObservation[];
  result: BenchmarkSuiteResult;
}> {
  const repeats = Math.max(1, Math.floor(options.repeats ?? 1));
  const observations: BenchmarkObservation[] = [];
  for (const scenario of scenarios) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      options.onScenario?.({ scenario, repeat: repeat + 1, totalRepeats: repeats });
      const observation = await adapter.run(scenario, {
        runId: `${scenario.id}-run-${repeat + 1}`,
        signal: options.signal,
      });
      observations.push(observation);
    }
  }
  return {
    observations,
    result: scoreSuite(
      scenarios,
      observations,
      options.judgeScores,
      options.benchmarkVersion,
    ),
  };
}
