import type {
  ResolvedWorldActorMemoryPolicy,
  ResolvedWorldActorRuntimePolicy,
  ResolvedWorldDirectorPolicy,
  WorldActorMemoryPolicy,
  WorldActorRuntimePolicy,
  WorldBeatRuntimeConfig,
  WorldDirectorPolicy,
} from "../../../contracts/world.js";

export interface ResolvedBeatRuntimeConfig {
  maxAttemptsPerTurn: number;
  retryBackoffMs: number[];
  narrationMaxTokens: number;
  playerMaxTokens: number;
  actorMaxTokens: number;
  presentationPrefetchLimit: number;
}

const DEFAULT_DIRECTOR_POLICY: ResolvedWorldDirectorPolicy = {
  enabled: true,
  reasoning: false,
  batchSize: 8,
  debounceMs: 10_000,
  minIntervalMs: 30_000,
  maxBatchSize: 24,
  maxToolRounds: 2,
  narratorDebounceMs: 1_800,
  maxProviderRetries: 2,
  contextSuspendAfterMs: 120_000,
  actorBackgroundMinEvents: 12,
  actorAuthority: "coordinate",
};

const DEFAULT_ACTOR_MEMORY_POLICY: ResolvedWorldActorMemoryPolicy = {
  enabled: false,
  idleExtractionMs: 120_000,
  boundaryDebounceMs: 4_000,
  maxEvidenceEvents: 18,
  maxOperationsPerUpdate: 4,
  maxCreatedNotesPerUpdate: 1,
  maxNotesPerActor: 20,
  maxArchivedNotesPerActor: 40,
  checkpointOnContextSuspend: true,
};

export function resolveWorldDirectorPolicy(
  ...inputs: Array<WorldDirectorPolicy | undefined>
): ResolvedWorldDirectorPolicy {
  const merged = Object.assign({}, ...inputs.filter(Boolean));
  return {
    enabled: merged.enabled ?? DEFAULT_DIRECTOR_POLICY.enabled,
    reasoning: merged.reasoning ?? DEFAULT_DIRECTOR_POLICY.reasoning,
    batchSize: clampInteger(merged.batchSize, DEFAULT_DIRECTOR_POLICY.batchSize, 1, 100),
    debounceMs: clampInteger(merged.debounceMs, DEFAULT_DIRECTOR_POLICY.debounceMs, 0, 300_000),
    minIntervalMs: clampInteger(merged.minIntervalMs, DEFAULT_DIRECTOR_POLICY.minIntervalMs, 0, 3_600_000),
    maxBatchSize: clampInteger(merged.maxBatchSize, DEFAULT_DIRECTOR_POLICY.maxBatchSize, 1, 200),
    maxToolRounds: clampInteger(merged.maxToolRounds, DEFAULT_DIRECTOR_POLICY.maxToolRounds, 1, 8),
    narratorDebounceMs: clampInteger(merged.narratorDebounceMs, DEFAULT_DIRECTOR_POLICY.narratorDebounceMs, 0, 30_000),
    maxProviderRetries: clampInteger(merged.maxProviderRetries, DEFAULT_DIRECTOR_POLICY.maxProviderRetries, 0, 5),
    contextSuspendAfterMs: clampInteger(merged.contextSuspendAfterMs, DEFAULT_DIRECTOR_POLICY.contextSuspendAfterMs, 10_000, 86_400_000),
    actorBackgroundMinEvents: clampInteger(merged.actorBackgroundMinEvents, DEFAULT_DIRECTOR_POLICY.actorBackgroundMinEvents, 1, 100),
    actorAuthority: isDirectorAuthority(merged.actorAuthority)
      ? merged.actorAuthority
      : DEFAULT_DIRECTOR_POLICY.actorAuthority,
  };
}

export function resolveWorldActorRuntimePolicy(
  input: WorldActorRuntimePolicy | undefined,
  directorEnabled: boolean,
): ResolvedWorldActorRuntimePolicy {
  const activation = input?.activation ?? (directorEnabled ? "beat_runtime" : "autonomous_idle");
  if (activation === "beat_runtime" && !directorEnabled) {
    throw new Error("World actorRuntime.activation=beat_runtime requires an enabled World Director.");
  }
  return {
    activation,
    playerRouting: input?.playerRouting ?? "focus_actor",
    ambient: input?.ambient ?? (activation === "beat_runtime" ? "low" : "off"),
  };
}

export function resolveWorldBeatRuntimeConfig(
  input: WorldBeatRuntimeConfig | undefined,
): ResolvedBeatRuntimeConfig {
  return {
    maxAttemptsPerTurn: clampInteger(input?.maxAttemptsPerTurn, 2, 1, 3),
    retryBackoffMs: normalizeRetryBackoff(input?.retryBackoffMs),
    narrationMaxTokens: clampInteger(input?.narratorMaxTokens, 900, 420, 2_000),
    playerMaxTokens: clampInteger(input?.playerMaxTokens, 1_200, 520, 2_000),
    actorMaxTokens: clampInteger(input?.actorMaxTokens, 1_000, 700, 2_400),
    presentationPrefetchLimit: clampInteger(input?.presentationPrefetchLimit, 5, 0, 10),
  };
}

export function resolveWorldActorMemoryPolicy(
  ...inputs: Array<WorldActorMemoryPolicy | undefined>
): ResolvedWorldActorMemoryPolicy {
  const merged = Object.assign({}, ...inputs.filter(Boolean));
  return {
    enabled: merged.enabled ?? DEFAULT_ACTOR_MEMORY_POLICY.enabled,
    idleExtractionMs: clampInteger(merged.idleExtractionMs, DEFAULT_ACTOR_MEMORY_POLICY.idleExtractionMs, 10_000, 1_800_000),
    boundaryDebounceMs: clampInteger(merged.boundaryDebounceMs, DEFAULT_ACTOR_MEMORY_POLICY.boundaryDebounceMs, 0, 60_000),
    maxEvidenceEvents: clampInteger(merged.maxEvidenceEvents, DEFAULT_ACTOR_MEMORY_POLICY.maxEvidenceEvents, 4, 100),
    maxOperationsPerUpdate: clampInteger(merged.maxOperationsPerUpdate, DEFAULT_ACTOR_MEMORY_POLICY.maxOperationsPerUpdate, 1, 12),
    maxCreatedNotesPerUpdate: clampInteger(merged.maxCreatedNotesPerUpdate, DEFAULT_ACTOR_MEMORY_POLICY.maxCreatedNotesPerUpdate, 1, 6),
    maxNotesPerActor: clampInteger(merged.maxNotesPerActor, DEFAULT_ACTOR_MEMORY_POLICY.maxNotesPerActor, 8, 256),
    maxArchivedNotesPerActor: clampInteger(merged.maxArchivedNotesPerActor, DEFAULT_ACTOR_MEMORY_POLICY.maxArchivedNotesPerActor, 0, 1_024),
    checkpointOnContextSuspend: merged.checkpointOnContextSuspend ?? DEFAULT_ACTOR_MEMORY_POLICY.checkpointOnContextSuspend,
  };
}

export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(min, Math.min(max, parsed)));
}

function normalizeRetryBackoff(input: number[] | undefined): number[] {
  if (!Array.isArray(input) || input.length === 0) return [0, 300, 1_000];
  return input.slice(0, 5).map((value) => (
    Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.round(value))) : 0
  ));
}

function isDirectorAuthority(value: unknown): value is ResolvedWorldDirectorPolicy["actorAuthority"] {
  return value === "observe" || value === "coordinate" || value === "manage";
}
