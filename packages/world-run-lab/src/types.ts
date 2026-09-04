import type {
  ChatProvider,
  RuntimeHost,
  WorldDebugConfig,
  WorldDebugEvent,
  WorldDefinition,
  WorldEvent,
  WorldNotification,
  PlayerPerformance,
  WorldSnapshot,
  WorldSourceProvider,
  WorldTokenUsageBreakdown,
  WorldTokenUsageTotals,
} from "@chatverse/core";

export interface WorldRunStepBase {
  id?: string;
  label: string;
  /**
   * Controls when the lab advances to the next scripted input.
   * `observable` measures user-visible responsiveness without waiting for the
   * whole Beat; `immediate` only enqueues the input.
   */
  completion?: "settled" | "observable" | "immediate";
}

export type WorldRunStep =
  | (WorldRunStepBase & {
      type: "progression";
      contextId: string;
      reason?: "bootstrap" | "observer_continue" | "ambient";
    })
  | (WorldRunStepBase & {
      type: "message";
      contextId: string;
      actorId: string;
      message: string;
    })
  | (WorldRunStepBase & {
      type: "player_turn";
      contextId: string;
      actorId: string;
      /** Use the current proposal's generated performance, or skip it. */
      mode?: "auto" | "skip";
      performance?: PlayerPerformance;
      proposalId?: string;
      /** A no-op when this step is reached before Narrator opens a player gate. */
      optional?: boolean;
    })
  | (WorldRunStepBase & {
      type: "directive";
      contextId: string;
      instruction: string;
      actorId?: string;
    })
  | (WorldRunStepBase & {
      type: "event";
      message: string;
      contextIds?: string[];
      actorIds?: string[];
    })
  | (WorldRunStepBase & {
      type: "wait";
      durationMs: number;
    })
  | (WorldRunStepBase & {
      type: "pause" | "resume" | "snapshot" | "restore";
    });

export interface WorldRunScenario {
  id: string;
  name: string;
  description: string;
  definition: WorldDefinition;
  steps: WorldRunStep[];
  targetEventCount: number;
  checkpointSequences: number[];
  /** Run every scripted step even after the event lower bound is reached. */
  runAllSteps?: boolean;
  checks?: WorldRunCheck[];
  /** Stop after a settled step once the scenario-specific narrative goal is committed. */
  stopWhen?: (state: {
    events: readonly WorldEvent[];
    snapshot: WorldSnapshot;
  }) => boolean;
}

export interface WorldRunProviders {
  director: ChatProvider;
  character: ChatProvider;
  mode: "scripted" | "live";
}

export interface WorldRunLabOptions {
  scenario: WorldRunScenario;
  providers: WorldRunProviders;
  /** Override the World Director thinking mode for this isolated run. */
  directorReasoning?: boolean;
  runtime?: RuntimeHost;
  initialSnapshot?: WorldSnapshot;
  /** Optional immutable long-text source catalog available to the World Director. */
  sourceProvider?: WorldSourceProvider;
  /** Accelerated mode drives a deterministic ManualRuntimeHost without wall-clock waits. */
  timeMode?: "realtime" | "accelerated";
  quietPeriodMs?: number;
  pollIntervalMs?: number;
  stepTimeoutMs?: number;
  /** Default completion boundary for steps that do not override it. */
  stepCompletion?: "settled" | "observable" | "immediate";
  /**
   * Maximum visible presentation turns acknowledged while settling one step.
   * Keep this bounded so a single scripted input cannot start an unobserved
   * autonomous run. Defaults to one turn.
   */
  maxPresentationAcksPerStep?: number;
  /**
   * 步骤预算结束后，为已进入发送队列的消息保留一次有限排空窗口。
   * 这段时间只等待已生成的输出，不会延长 Provider 或新的剧情链。
   */
  scheduledDrainGraceMs?: number;
  /** Maximum time reserved for background memory work after the target is met. */
  backgroundTimeoutMs?: number;
  maxPumpIterations?: number;
  debug?: boolean | WorldDebugConfig;
  /** 增量时间线归档阈值行数,透传给 createWorld。 */
  timelineCuratorMinRows?: number;
  onProgress?: (progress: WorldRunProgress) => void;
}

export interface WorldRunProgress {
  phase: "starting" | "step" | "provider" | "checkpoint" | "completed" | "failed";
  message: string;
  stepIndex?: number;
  eventSequence?: number;
}

export interface WorldRunCheckpoint {
  requestedSequence: number;
  capturedSequence: number;
  capturedAt: number;
  restored: boolean;
  snapshot: WorldSnapshot;
}

export interface WorldRunDebugRecord {
  runtimeGeneration: number;
  event: WorldDebugEvent;
}

export interface WorldRunStepResult {
  index: number;
  id?: string;
  label: string;
  type: WorldRunStep["type"];
  startedAt: number;
  finishedAt: number;
  eventSequenceBefore: number;
  eventSequenceAfter: number;
  status: "passed" | "failed";
  error?: string;
}

export interface WorldRunTranscriptEntry {
  sequence: number;
  occurredAt: number;
  contextId?: string;
  actorId?: string;
  kind: "message" | "action" | "narration";
  speaker?: string;
  text: string;
}

export type WorldRunPromptProvider = "director" | "character";

export type WorldRunPromptOperation = "complete" | "stream" | "chat";

/**
 * Prompt diagnostics deliberately contain no prompt正文. Hashes and sizes are
 * enough to locate the first unstable section without leaking world content
 * into benchmark artifacts.
 */
export interface WorldRunPromptSegment {
  scope: "system" | "user" | "message";
  name: string;
  chars: number;
  estimatedTokens: number;
  hash: string;
  sameAsPrevious: boolean;
}

export interface WorldRunPromptUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
}

export interface WorldRunPromptTrace {
  id: string;
  provider: WorldRunPromptProvider;
  operation: WorldRunPromptOperation;
  purpose?: string;
  turnId?: string;
  contextId?: string;
  actorId?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: "completed" | "error";
  comparedToPrevious: boolean;
  totalChars: number;
  estimatedTokens: number;
  stablePrefixChars: number;
  stablePrefixRate: number;
  firstChangedSegment?: string;
  segments: WorldRunPromptSegment[];
  usage?: WorldRunPromptUsage;
}

export interface WorldRunToolUsage {
  totalCalls: number;
  byName: Record<string, number>;
}

export interface WorldRunDirectorMetrics {
  scheduledCount: number;
  callCount: number;
  immediateScheduleCount: number;
  batchScheduleCount: number;
  scheduleReasons: Record<string, number>;
  averageEventsPerCall: number;
  taskCount: number;
  taskCompleteCount: number;
  taskPartialCount: number;
  taskEmptyCount: number;
  taskRetryCount: number;
  taskCompletionRate: number;
  taskToolComplianceRate: number;
}

export interface WorldRunLatencyMetrics {
  sampleCount: number;
  averageMs: number;
  maximumMs: number;
  p95Ms: number;
}

export interface WorldRunStabilityMetrics {
  timeMode: "realtime" | "accelerated";
  settleCount: number;
  timeoutCount: number;
  stallCount: number;
  backgroundDrainTimeoutCount: number;
  maxSettleWallMs: number;
  maxSettleVirtualMs: number;
  maxPumpIterations: number;
  finalPendingTasks: number;
  maxConcurrentOperations: number;
  maxOperationAgeMs: number;
  activeOperationsAtFinish: number;
}

export type WorldRunOperationKind = "director" | "actor" | "memory";

export type WorldRunOperationOutcome =
  | "completed"
  | "error"
  | "timeout"
  | "cancelled";

export interface WorldRunOperationRecord {
  id: string;
  kind: WorldRunOperationKind;
  actorId?: string;
  contextId?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  outcome: WorldRunOperationOutcome;
}

export interface WorldRunMetrics {
  eventCount: number;
  eventsByType: Record<string, number>;
  notificationCount: number;
  notificationsByType: Record<string, number>;
  debugEventCount: number;
  debugEventsByType: Record<string, number>;
  tokenUsage: WorldTokenUsageTotals & {
    cacheableInputTokens: number;
    cacheHitRate: number;
    averageInputTokensPerRequest: number;
    averageOutputTokensPerRequest: number;
    inputTokensPerEvent: number;
    totalTokensPerEvent: number;
    byRole: WorldTokenUsageBreakdown[];
    byPurpose: WorldTokenUsageBreakdown[];
    byActor: WorldTokenUsageBreakdown[];
    byModel: WorldTokenUsageBreakdown[];
  };
  toolUsage: WorldRunToolUsage;
  director: WorldRunDirectorMetrics;
  providerLatency: WorldRunLatencyMetrics;
  stability: WorldRunStabilityMetrics;
  checkpointCount: number;
  restoreCount: number;
}

export interface WorldRunCheckContext {
  scenario: WorldRunScenario;
  events: readonly WorldEvent[];
  notifications: readonly WorldNotification[];
  debug: readonly WorldRunDebugRecord[];
  operations: readonly WorldRunOperationRecord[];
  promptTraces: readonly WorldRunPromptTrace[];
  checkpoints: readonly WorldRunCheckpoint[];
  finalSnapshot: WorldSnapshot;
  metrics: WorldRunMetrics;
}

export interface WorldRunCheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface WorldRunCheck {
  id: string;
  label: string;
  evaluate(context: WorldRunCheckContext): Omit<WorldRunCheckResult, "id" | "label">;
}

export interface WorldRunReport {
  schemaVersion: 1;
  runId: string;
  scenario: {
    id: string;
    name: string;
    description: string;
    providerMode: WorldRunProviders["mode"];
    timeMode: "realtime" | "accelerated";
    directorBatchSize: number;
    targetEventCount: number;
  };
  status: "passed" | "failed";
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: WorldRunStepResult[];
  checkpoints: WorldRunCheckpoint[];
  events: WorldEvent[];
  notifications: WorldNotification[];
  debug: WorldRunDebugRecord[];
  operations: WorldRunOperationRecord[];
  promptTraces: WorldRunPromptTrace[];
  transcript: WorldRunTranscriptEntry[];
  metrics: WorldRunMetrics;
  checks: WorldRunCheckResult[];
  errors: string[];
  finalSnapshot: WorldSnapshot;
}
