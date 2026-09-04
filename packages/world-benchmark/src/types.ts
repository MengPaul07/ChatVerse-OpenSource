export const WORLD_BENCHMARK_NAME = "ChatVerse WorldBench";
export const WORLD_BENCHMARK_ABBREVIATION = "CVWB";
export const WORLD_BENCHMARK_SCHEMA_VERSION = 1 as const;

export type BenchmarkActorKind = "ai" | "human";
export type BenchmarkActionType =
  | "start"
  | "player_message"
  | "player_directive"
  | "world_event"
  | "advance_time"
  | "pause"
  | "resume"
  | "snapshot"
  | "restore"
  | "provider_fault"
  | "wait";

export interface BenchmarkActorFixture {
  id: string;
  name: string;
  kind: BenchmarkActorKind;
  role: string;
  publicKnowledge: string[];
  privateKnowledge?: string[];
  capabilities?: string[];
  lifecycle?: "persistent" | "scene";
}

export interface BenchmarkContextFixture {
  id: string;
  name: string;
  premise: string;
  actorIds: string[];
  rules: string[];
}

export interface BenchmarkWorldFixture {
  name: string;
  premise: string;
  rules: string[];
  actors: BenchmarkActorFixture[];
  contexts: BenchmarkContextFixture[];
  initialFacts?: string[];
  initialChapters?: string[];
}

export interface BenchmarkActionBase {
  id: string;
  label: string;
}

export type BenchmarkAction =
  | (BenchmarkActionBase & {
      type: "start";
      contextId: string;
    })
  | (BenchmarkActionBase & {
      type: "player_message";
      contextId: string;
      actorId: string;
      message: string;
    })
  | (BenchmarkActionBase & {
      type: "player_directive";
      contextId: string;
      instruction: string;
      actorId?: string;
    })
  | (BenchmarkActionBase & {
      type: "world_event";
      message: string;
      contextIds?: string[];
      actorIds?: string[];
    })
  | (BenchmarkActionBase & {
      type: "advance_time";
      seconds: number;
      reason?: string;
    })
  | (BenchmarkActionBase & {
      type: "pause" | "resume" | "snapshot" | "restore";
    })
  | (BenchmarkActionBase & {
      type: "provider_fault";
      provider: "director" | "narrator" | "actor" | "any";
      mode: "invalid_json" | "error" | "timeout";
      count: number;
    })
  | (BenchmarkActionBase & {
      type: "wait";
      durationMs: number;
    });

export type BenchmarkCapability =
  | "scene_arbitration"
  | "actor_performance"
  | "macro_progression"
  | "scene_actor_planning"
  | "macro_dismiss"
  | "context_inspection"
  | "narrative_retrieval"
  | "world_time"
  | "actor_tool"
  | "snapshot_restore"
  | "fault_recovery";

export interface BenchmarkBudget {
  maxProviderCalls?: number;
  maxDirectorCalls?: number;
  maxNarratorCalls?: number;
  maxActorCalls?: number;
  maxTotalTokens?: number;
  minCacheHitRate?: number;
  maxWallTimeMs?: number;
  maxStallCount?: number;
}

export type BenchmarkAssertion =
  | {
      kind: "entry_count";
      entryKind?: BenchmarkVisibleEntry["kind"];
      min?: number;
      max?: number;
    }
  | {
      kind: "entry_contains";
      text: string;
      entryKind?: BenchmarkVisibleEntry["kind"];
      actorId?: string;
      actorLifecycle?: BenchmarkActorObservation["lifecycle"];
      speaker?: string;
      min?: number;
    }
  | {
      kind: "entry_excludes";
      text: string;
      entryKind?: BenchmarkVisibleEntry["kind"];
    }
  | {
      kind: "ordered_entries";
      steps: Array<{
        text: string;
        actorId?: string;
        kind?: BenchmarkVisibleEntry["kind"];
      }>;
    }
  | {
      kind: "actor_lifecycle";
      actorId?: string;
      actorName?: string;
      lifecycle?: BenchmarkActorObservation["lifecycle"];
      joined?: boolean;
      spoke?: boolean;
      left?: boolean;
      joinedAfterActionId?: string;
    }
  | {
      kind: "tool_call";
      name: string;
      min?: number;
      max?: number;
      outcome?: "accepted" | "rejected" | "error";
    }
  | {
      kind: "component_call";
      component: BenchmarkOperation["component"];
      min?: number;
      max?: number;
    }
  | {
      kind: "metric_budget";
      metric: keyof BenchmarkMetrics;
      max?: number;
      min?: number;
    }
  | {
      kind: "no_failures";
    }
  | {
      kind: "no_duplicate_entries";
      minDistinctRatio?: number;
    };

export interface BenchmarkCriterion {
  id: string;
  label: string;
  weight: number;
  source: "objective" | "metric" | "judge";
  hardGate?: boolean;
  assertion?: BenchmarkAssertion;
  judgePrompt?: string;
}

export interface BenchmarkScenario {
  schemaVersion: typeof WORLD_BENCHMARK_SCHEMA_VERSION;
  id: string;
  version: string;
  name: string;
  description: string;
  tags: string[];
  requiredCapabilities: BenchmarkCapability[];
  fixture: BenchmarkWorldFixture;
  actions: BenchmarkAction[];
  criteria: BenchmarkCriterion[];
  budget: BenchmarkBudget;
}

export interface BenchmarkVisibleEntry {
  sequence: number;
  contextId?: string;
  actorId?: string;
  speaker?: string;
  kind: "message" | "action" | "narration";
  text: string;
}

export interface BenchmarkActorObservation {
  id: string;
  name: string;
  lifecycle: "persistent" | "scene";
  joinedAtSequence?: number;
  leftAtSequence?: number;
  messageCount: number;
}

export interface BenchmarkOperation {
  sequence: number;
  component: "director" | "narrator" | "actor" | "tool" | "runtime";
  name: string;
  outcome: "accepted" | "rejected" | "error" | "completed";
  actorId?: string;
  actionId?: string;
}

export interface BenchmarkMetrics {
  providerCalls: number;
  directorCalls: number;
  narratorCalls: number;
  actorCalls: number;
  totalTokens: number;
  cacheHitRate: number;
  wallTimeMs: number;
  stallCount: number;
}

export interface BenchmarkObservation {
  schemaVersion: typeof WORLD_BENCHMARK_SCHEMA_VERSION;
  runId: string;
  scenarioId: string;
  engine: {
    name: string;
    version?: string;
    revision?: string;
    adapter: string;
  };
  capabilities: BenchmarkCapability[];
  actions: Array<{
    id: string;
    type: BenchmarkActionType;
    status: "completed" | "failed";
    eventSequenceBefore: number;
    eventSequenceAfter: number;
    error?: string;
  }>;
  entries: BenchmarkVisibleEntry[];
  actors: BenchmarkActorObservation[];
  operations: BenchmarkOperation[];
  toolCalls: Array<{
    sequence: number;
    name: string;
    outcome: "accepted" | "rejected" | "error";
    component?: BenchmarkOperation["component"];
  }>;
  metrics: BenchmarkMetrics;
  failures: string[];
  raw?: unknown;
}

export interface BenchmarkEngineAdapter {
  readonly name: string;
  readonly version?: string;
  readonly revision?: string;
  run(
    scenario: BenchmarkScenario,
    options?: { runId?: string; signal?: AbortSignal },
  ): Promise<BenchmarkObservation>;
}

export interface BenchmarkAssertionResult {
  passed: boolean;
  score: number;
  detail: string;
}

export interface BenchmarkCriterionResult extends BenchmarkAssertionResult {
  id: string;
  label: string;
  source: BenchmarkCriterion["source"];
  weight: number;
  hardGate: boolean;
  pendingJudge: boolean;
}

export interface BenchmarkScore {
  scenarioId: string;
  runId: string;
  status: "complete" | "needs_judge" | "failed";
  earnedWeight: number;
  availableWeight: number;
  totalWeight: number;
  percentage: number;
  hardGateTriggered: boolean;
  criteria: BenchmarkCriterionResult[];
}

export interface BenchmarkJudgeScores {
  [criterionId: string]: number;
}

export interface BenchmarkSuiteResult {
  name: typeof WORLD_BENCHMARK_NAME;
  abbreviation: typeof WORLD_BENCHMARK_ABBREVIATION;
  schemaVersion: typeof WORLD_BENCHMARK_SCHEMA_VERSION;
  benchmarkVersion: string;
  scores: BenchmarkScore[];
  aggregate: {
    status: "complete" | "needs_judge" | "failed";
    percentage: number;
    scenarioCount: number;
    passedScenarioCount: number;
    hardGateCount: number;
  };
}
