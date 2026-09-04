import type { WorldEvent, WorldSourceBinding } from "../../../contracts/world.js";
import type { DirectorReferenceTable } from "./references.js";
import type { WorldDirectorMutation, WorldDirectorTaskMode } from "./tools.js";

export interface WorldDirectorView {
  worldSummary: string;
  actorSummary: string;
  contextSummary: string;
  runtimeSummary: string;
  chapterSummary: string;
  recentBeatSummary: string;
  edgeSummary: string;
  sourceSummary: string;
  sourceBindings: WorldSourceBinding[];
  eventBatch: WorldEvent[];
  /** Ephemeral aliases used only by this Director invocation. */
  references: DirectorReferenceTable;
  /** Host-owned active Chapter id; never inferred by parsing prompt text. */
  foregroundChapterId?: string;
  task?: WorldDirectorTask;
}

export interface WorldDirectorTask {
  mode?: WorldDirectorTaskMode;
  objective: string;
  sourceEventIds: string[];
  requiredToolNames: string[];
}

export interface WorldDirectorHost {
  now(): number;
  nextId(): string;
  inspectContext(contextId: string, limit: number): string;
  queryNarrative(
    query: string,
    chapterId: string | undefined,
    beatId: string | undefined,
    limit: number,
  ): string;
  inspectActor(actorId: string): string;
  searchActors(query: string, contextId: string | undefined, limit: number): string;
  retrieveSource(bundleId: string, query: string, limit: number): {
    chunkIds: string[];
    content: string;
  };
  validateSourceBundleId(bundleId: string): boolean;
  validateSourceChunkIds(bundleId: string, chunkIds: readonly string[]): boolean;
  sourceBindingRevision(bundleId: string): number | undefined;
  canControlActor(
    actorId: string,
    operation: "participation" | "presence",
  ): boolean;
  validateContextId(contextId: string): boolean;
  validateActorId(actorId: string): boolean;
  validateActorBackgroundUpdate(
    actorId: string,
    text: string,
    sourceEventIds: readonly string[],
  ): string | undefined;
  validateSpawnActor(contextId: string, name: string): string | undefined;
  validateSpawnedActor(actorId: string, contextId: string): string | undefined;
  validateEventId(eventId: string): boolean;
  validateBeatId(beatId: string, staged: readonly WorldDirectorMutation[]): boolean;
  validateChapterId(chapterId: string, staged: readonly WorldDirectorMutation[]): boolean;
  validateBeatSources(
    chapterId: string,
    sourceEventIds: readonly string[],
    staged: readonly WorldDirectorMutation[],
  ): string | undefined;
}

export interface WorldDirectorResult {
  mutations: WorldDirectorMutation[];
  toolNames: string[];
  failedToolNames: string[];
  taskRetryCount: number;
  taskStatus?: "complete" | "partial" | "empty";
  missingToolNames: string[];
}

export interface WorldDirectorRunOptions {
  planId?: string;
  progressionRequired?: boolean;
  taskMode?: WorldDirectorTaskMode;
}

export interface WorldDirectorTrace {
  type: "prompt" | "response" | "tool_result" | "task_retry";
  round: number;
  payload: Record<string, unknown>;
}
