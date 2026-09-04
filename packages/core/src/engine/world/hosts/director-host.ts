import type { WorldDirectorHost } from "../director/types.js";
import type { WorldDirectorMutation } from "../director/index.js";
import type { WorldState } from "../state.js";
import { WorldInspectionHost } from "./inspection-host.js";
import { WorldSourceHost } from "./source-host.js";

interface DirectorHostServices {
  state: WorldState;
  inspection: WorldInspectionHost;
  source: WorldSourceHost;
  now(): number;
  nextId(): string;
  canControlActor(
    actorId: string,
    operation: "participation" | "presence",
  ): boolean;
  hasContext(contextId: string): boolean;
  validateActorBackgroundUpdate(
    actorId: string,
    text: string,
    sourceEventIds: readonly string[],
  ): string | undefined;
  validateSpawnActor(contextId: string, name: string): string | undefined;
  validateSpawnedActor(actorId: string, contextId: string): string | undefined;
  validateBeatSources(
    chapterId: string,
    sourceEventIds: readonly string[],
    staged: readonly WorldDirectorMutation[],
  ): string | undefined;
}

/**
 * Builds the Director tool host from read-only services and World-owned
 * validators. The Director runtime can keep this host stable without owning
 * any World state or knowing how those services are assembled.
 */
export function createWorldDirectorHost(services: DirectorHostServices): WorldDirectorHost {
  const { state, inspection, source } = services;
  return {
    now: services.now,
    nextId: services.nextId,
    inspectContext: inspection.inspectContext.bind(inspection),
    queryNarrative: inspection.queryNarrative.bind(inspection),
    inspectActor: inspection.inspectActor.bind(inspection),
    searchActors: inspection.searchActors.bind(inspection),
    retrieveSource: source.retrieve.bind(source),
    validateSourceBundleId: source.hasBinding.bind(source),
    validateSourceChunkIds: source.validateChunkIds.bind(source),
    sourceBindingRevision: source.bindingRevision.bind(source),
    canControlActor: services.canControlActor,
    validateContextId: services.hasContext,
    validateActorId: (actorId) => state.actorStates.has(actorId),
    validateActorBackgroundUpdate: services.validateActorBackgroundUpdate,
    validateSpawnActor: services.validateSpawnActor,
    validateSpawnedActor: services.validateSpawnedActor,
    validateEventId: (eventId) => state.journal.all().some((event) => event.id === eventId),
    validateBeatId: (beatId, staged) => (
      state.beats.has(beatId) ||
      staged.some((mutation) => mutation.type === "plan_beat" && mutation.id === beatId)
    ),
    validateChapterId: (chapterId) => (
      state.chapters.has(chapterId)
    ),
    validateBeatSources: services.validateBeatSources,
  };
}
