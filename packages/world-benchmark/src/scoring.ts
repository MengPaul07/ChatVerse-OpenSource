import type {
  BenchmarkAssertion,
  BenchmarkAssertionResult,
  BenchmarkCriterion,
  BenchmarkCriterionResult,
  BenchmarkJudgeScores,
  BenchmarkObservation,
  BenchmarkScore,
  BenchmarkScenario,
  BenchmarkSuiteResult,
} from "./types.js";
import {
  WORLD_BENCHMARK_ABBREVIATION,
  WORLD_BENCHMARK_NAME,
  WORLD_BENCHMARK_SCHEMA_VERSION,
} from "./types.js";

export function evaluateAssertion(
  assertion: BenchmarkAssertion,
  observation: BenchmarkObservation,
): BenchmarkAssertionResult {
  switch (assertion.kind) {
    case "entry_count": {
      const count = observation.entries.filter((entry) => (
        !assertion.entryKind || entry.kind === assertion.entryKind
      )).length;
      return rangeResult(count, assertion.min, assertion.max, `entries=${count}`);
    }
    case "entry_contains": {
      const count = observation.entries.filter((entry) => (
        (!assertion.entryKind || entry.kind === assertion.entryKind) &&
        (!assertion.actorId || entry.actorId === assertion.actorId) &&
        (!assertion.actorLifecycle || observation.actors.some((actor) => (
          actor.id === entry.actorId && actor.lifecycle === assertion.actorLifecycle
        ))) &&
        (!assertion.speaker || entry.speaker === assertion.speaker) &&
        entry.text.includes(assertion.text)
      )).length;
      const min = assertion.min ?? 1;
      return {
        passed: count >= min,
        score: count >= min ? 1 : Math.min(0.99, count / min),
        detail: `found=${count}, required=${min}`,
      };
    }
    case "entry_excludes": {
      const count = observation.entries.filter((entry) => (
        (!assertion.entryKind || entry.kind === assertion.entryKind) &&
        entry.text.includes(assertion.text)
      )).length;
      return {
        passed: count === 0,
        score: count === 0 ? 1 : 0,
        detail: `matches=${count}`,
      };
    }
    case "ordered_entries": {
      let cursor = -1;
      let matched = 0;
      for (const step of assertion.steps) {
        const index = observation.entries.findIndex((entry, entryIndex) => (
          entryIndex > cursor &&
          (!step.kind || entry.kind === step.kind) &&
          (!step.actorId || entry.actorId === step.actorId) &&
          entry.text.includes(step.text)
        ));
        if (index < 0) break;
        cursor = index;
        matched++;
      }
      return {
        passed: matched === assertion.steps.length,
        score: assertion.steps.length > 0 ? matched / assertion.steps.length : 1,
        detail: `matched=${matched}/${assertion.steps.length}`,
      };
    }
    case "actor_lifecycle": {
      const actor = observation.actors.find((item) => {
        if (assertion.actorId !== undefined && item.id !== assertion.actorId) return false;
        if (assertion.actorName !== undefined && item.name !== assertion.actorName) return false;
        if (assertion.lifecycle !== undefined && item.lifecycle !== assertion.lifecycle) return false;
        return assertion.actorId !== undefined || assertion.actorName !== undefined || assertion.lifecycle !== undefined;
      });
      const joined = Boolean(actor?.joinedAtSequence !== undefined);
      const spoke = Boolean(actor && actor.messageCount > 0);
      const left = Boolean(actor?.leftAtSequence !== undefined);
      const checks = [
        assertion.joined === undefined || joined === assertion.joined,
        assertion.spoke === undefined || spoke === assertion.spoke,
        assertion.left === undefined || left === assertion.left,
        assertion.joinedAfterActionId === undefined || joinedAfterAction(
          actor?.joinedAtSequence,
          assertion.joinedAfterActionId,
          observation,
        ),
      ];
      const passed = checks.every(Boolean);
      return { passed, score: checks.filter(Boolean).length / checks.length, detail: `joined=${joined}, spoke=${spoke}, left=${left}` };
    }
    case "tool_call": {
      const calls = observation.toolCalls.filter((call) => (
        call.name === assertion.name &&
        (!assertion.outcome || call.outcome === assertion.outcome)
      ));
      return rangeResult(calls.length, assertion.min, assertion.max, `tool=${assertion.name}, count=${calls.length}`);
    }
    case "component_call": {
      const count = observation.operations.filter((operation) => operation.component === assertion.component).length;
      return rangeResult(count, assertion.min, assertion.max, `component=${assertion.component}, count=${count}`);
    }
    case "metric_budget": {
      const value = observation.metrics[assertion.metric];
      return rangeResult(value, assertion.min, assertion.max, `${assertion.metric}=${value}`);
    }
    case "no_failures": {
      return {
        passed: observation.failures.length === 0,
        score: observation.failures.length === 0 ? 1 : 0,
        detail: `failures=${observation.failures.length}`,
      };
    }
    case "no_duplicate_entries": {
      const distinct = new Set(observation.entries.map((entry) => normalize(entry.text))).size;
      const total = observation.entries.length;
      const ratio = total > 0 ? distinct / total : 1;
      const minimum = assertion.minDistinctRatio ?? 1;
      return {
        passed: ratio >= minimum,
        score: Math.min(1, ratio / minimum),
        detail: `distinctRatio=${ratio.toFixed(3)}, required=${minimum.toFixed(3)}`,
      };
    }
  }
}

export function scoreScenario(
  scenario: BenchmarkScenario,
  observation: BenchmarkObservation,
  judgeScores: BenchmarkJudgeScores = {},
): BenchmarkScore {
  const criteria = scenario.criteria.map((criterion) => scoreCriterion(criterion, observation, judgeScores));
  const hardGateTriggered = criteria.some((criterion) => (
    criterion.hardGate && !criterion.pendingJudge && criterion.score < 1
  ));
  const pendingJudge = criteria.some((criterion) => criterion.pendingJudge);
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const earnedWeight = criteria.reduce((sum, criterion) => sum + criterion.weight * criterion.score, 0);
  const availableWeight = criteria
    .filter((criterion) => !criterion.pendingJudge)
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const rawPercentage = availableWeight > 0 ? earnedWeight / availableWeight : 0;
  const percentage = hardGateTriggered ? Math.min(rawPercentage * 100, 39) : rawPercentage * 100;
  return {
    scenarioId: scenario.id,
    runId: observation.runId,
    status: hardGateTriggered ? "failed" : pendingJudge ? "needs_judge" : "complete",
    earnedWeight,
    availableWeight,
    totalWeight,
    percentage: Math.round(percentage * 100) / 100,
    hardGateTriggered,
    criteria,
  };
}

export function scoreSuite(
  scenarios: readonly BenchmarkScenario[],
  observations: readonly BenchmarkObservation[],
  judgeScores: Record<string, BenchmarkJudgeScores> = {},
  benchmarkVersion = "1.0.0",
): BenchmarkSuiteResult {
  const scores = observations.map((observation) => {
    const scenario = scenarios.find((item) => item.id === observation.scenarioId);
    if (!scenario) throw new Error(`Unknown benchmark scenario: ${observation.scenarioId}`);
    return scoreScenario(scenario, observation, judgeScores[observation.runId]);
  });
  const complete = scores.every((score) => score.status === "complete");
  const failed = scores.some((score) => score.status === "failed");
  const percentage = scores.length > 0
    ? scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length
    : 0;
  return {
    name: WORLD_BENCHMARK_NAME,
    abbreviation: WORLD_BENCHMARK_ABBREVIATION,
    schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
    benchmarkVersion,
    scores,
    aggregate: {
      status: failed ? "failed" : complete ? "complete" : "needs_judge",
      percentage: Math.round(percentage * 100) / 100,
      scenarioCount: scores.length,
      passedScenarioCount: scores.filter((score) => score.status === "complete" && !score.hardGateTriggered).length,
      hardGateCount: scores.filter((score) => score.hardGateTriggered).length,
    },
  };
}

function scoreCriterion(
  criterion: BenchmarkCriterion,
  observation: BenchmarkObservation,
  judgeScores: BenchmarkJudgeScores,
): BenchmarkCriterionResult {
  if (criterion.source === "judge") {
    const score = judgeScores[criterion.id];
    if (score === undefined) {
      return {
        id: criterion.id,
        label: criterion.label,
        source: criterion.source,
        weight: criterion.weight,
        hardGate: criterion.hardGate ?? false,
        pendingJudge: true,
        passed: false,
        score: 0,
        detail: "等待盲评 Judge 分数",
      };
    }
    const normalized = Math.max(0, Math.min(1, score / 4));
    return {
      id: criterion.id,
      label: criterion.label,
      source: criterion.source,
      weight: criterion.weight,
      hardGate: criterion.hardGate ?? false,
      pendingJudge: false,
      passed: normalized >= 0.75,
      score: normalized,
      detail: `judge=${score.toFixed(2)}/4`,
    };
  }
  if (!criterion.assertion) {
    return {
      id: criterion.id,
      label: criterion.label,
      source: criterion.source,
      weight: criterion.weight,
      hardGate: criterion.hardGate ?? false,
      pendingJudge: false,
      passed: false,
      score: 0,
      detail: "缺少可执行断言",
    };
  }
  const result = evaluateAssertion(criterion.assertion, observation);
  return {
    ...result,
    id: criterion.id,
    label: criterion.label,
    source: criterion.source,
    weight: criterion.weight,
    hardGate: criterion.hardGate ?? false,
    pendingJudge: false,
  };
}

function rangeResult(value: number, min?: number, max?: number, detail = ""): BenchmarkAssertionResult {
  const lower = min ?? Number.NEGATIVE_INFINITY;
  const upper = max ?? Number.POSITIVE_INFINITY;
  const passed = value >= lower && value <= upper;
  const distance = value < lower ? lower - value : value > upper ? value - upper : 0;
  const finiteBounds = [lower, upper].filter(Number.isFinite);
  const scale = Math.max(1, ...finiteBounds.map((bound) => Math.abs(bound)));
  return { passed, score: passed ? 1 : Math.max(0, 1 - distance / scale), detail };
}

function joinedAfterAction(
  joinedAtSequence: number | undefined,
  actionId: string,
  observation: BenchmarkObservation,
): boolean {
  if (joinedAtSequence === undefined) return false;
  const action = observation.actions.find((item) => item.id === actionId);
  return action !== undefined && joinedAtSequence > action.eventSequenceAfter;
}

function normalize(value: string): string {
  return value.replace(/[\s，。！？、,.!?;；:："“”'‘’()（）]/g, "").toLowerCase();
}
