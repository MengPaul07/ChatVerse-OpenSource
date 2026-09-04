import type {
  NarrativeBeat,
  ResolvedWorldDirectorPolicy,
  WorldActorBackgroundState,
  WorldActorDefinition,
  WorldEvent,
  WorldEventInput,
} from "../../../contracts/world.js";
import type { WorldDirectorMutation } from "../director/index.js";
import { normalizeBackground, sourceEventKey } from "./helpers.js";
import type { WorldState } from "../state.js";

export interface WorldDirectorSupportHost {
  state: WorldState;
  policy: ResolvedWorldDirectorPolicy;
  now(): number;
  isStopped(): boolean;
  hasContext(contextId: string): boolean;
  requireActor(actorId: string): WorldActorDefinition;
  appendEvent(input: WorldEventInput): WorldEvent;
}

/** Owns validation and state projection for Director mutations. */
export class WorldDirectorSupportRuntime {
  constructor(private readonly host: WorldDirectorSupportHost) {}

  actorBackgroundUpdateError(
    actorId: string,
    text: string,
    sourceEventIds: readonly string[],
  ): string | undefined {
    const actor = this.host.state.actorDefinitions.get(actorId);
    if (!actor) {
      return "Only registered AI Actors have Director-managed backgrounds.";
    }
    const current = this.host.state.actorBackgrounds.get(actorId);
    if (!current) return `Actor background is unavailable: ${actorId}`;
    if (normalizeBackground(text) === normalizeBackground(current.text)) {
      return "Actor background is unchanged.";
    }
    const sourceEvents = sourceEventIds
      .map((eventId) => this.host.state.journal.get(eventId))
      .filter((event): event is WorldEvent => Boolean(event));
    if (sourceEvents.length !== sourceEventIds.length) {
      return "Every background sourceEventId must reference a committed WorldEvent.";
    }
    if (current.revision === 0) return undefined;
    const latestSourceSequence = Math.max(...sourceEvents.map((event) => event.sequence));
    const eventDistance = latestSourceSequence - current.updatedAtSequence;
    if (eventDistance < this.host.policy.actorBackgroundMinEvents) {
      return `Actor background is cooling down: ${eventDistance}/${this.host.policy.actorBackgroundMinEvents} committed events since the previous rewrite.`;
    }
    return undefined;
  }

  spawnActorValidationError(contextId: string, name: string): string | undefined {
    if (!this.host.hasContext(contextId)) return `Unknown context: ${contextId}`;
    const normalizedName = name.trim();
    if (!normalizedName) return "Spawned Actor name is required.";
    if ([...normalizedName].length > 40) {
      return "Spawned Actor name must be at most 40 characters.";
    }
    const activePersistentActorIds = this.host.state.actorIdsInContext(contextId).filter((actorId) => (
      this.host.state.actorDefinitions.get(actorId)?.lifecycle !== "scene"
    ));
    if (activePersistentActorIds.length >= 24) {
      return `Context ${contextId} already has the maximum of 24 active Actors.`;
    }
    for (const actorId of activePersistentActorIds) {
      const actor = this.host.requireActor(actorId);
      if (actor.card.name === normalizedName) {
        return `Context ${contextId} already contains a participant named ${normalizedName}.`;
      }
    }
    return undefined;
  }

  spawnedActorValidationError(actorId: string, contextId: string): string | undefined {
    const actor = this.host.state.actorDefinitions.get(actorId);
    if (!actor) return `Unknown actor: ${actorId}`;
    if (actor.lifecycle !== "scene") {
      return `Actor ${actorId} is persistent and cannot be dismissed as a spawned Actor.`;
    }
    const presence = this.host.state.getPresence(contextId, actorId);
    if (!presence || presence.participation === "left") {
      return `Spawned Actor ${actorId} is not active in context ${contextId}.`;
    }
    return undefined;
  }

  beatSourceValidationError(
    chapterId: string,
    sourceEventIds: readonly string[],
    staged: readonly WorldDirectorMutation[],
  ): string | undefined {
    const key = sourceEventKey(sourceEventIds);
    const existing = [...this.host.state.beats.values()].find((beat) => (
      beat.chapterId === chapterId && sourceEventKey(beat.sourceEventIds) === key
    ));
    if (existing) {
      return `A Beat for Chapter ${chapterId} already covers these source events: ${existing.id}.`;
    }
    const stagedDuplicate = staged.find((mutation): mutation is Extract<WorldDirectorMutation, { type: "plan_beat" }> => (
      mutation.type === "plan_beat" &&
      mutation.chapterId === chapterId &&
      sourceEventKey(mutation.sourceEventIds) === key
    ));
    if (stagedDuplicate) {
      return `A Beat with these source events is already staged in this pass: ${stagedDuplicate.id}.`;
    }
    return undefined;
  }

  applyActorBackgroundUpdate(
    mutation: Extract<WorldDirectorMutation, { type: "update_actor_background" }>,
    causationId: string | undefined,
  ): void {
    if (this.host.isStopped()) return;
    if (this.actorBackgroundUpdateError(
      mutation.actorId,
      mutation.text,
      mutation.sourceEventIds,
    )) return;
    const previous = this.host.state.actorBackgrounds.get(mutation.actorId);
    if (!previous) return;
    const sourceEvents = mutation.sourceEventIds
      .map((eventId) => this.host.state.journal.get(eventId))
      .filter((event): event is WorldEvent => Boolean(event));
    const next: WorldActorBackgroundState = {
      actorId: mutation.actorId,
      text: mutation.text.trim(),
      revision: previous.revision + 1,
      sourceEventIds: [...mutation.sourceEventIds],
      updatedAtSequence: Math.max(...sourceEvents.map((event) => event.sequence)),
      updatedAt: this.host.now(),
    };
    this.host.state.actorBackgrounds.set(mutation.actorId, next);
    const actorState = this.host.state.actorStates.get(mutation.actorId);
    if (actorState) {
      this.host.state.actorStates.set(mutation.actorId, {
        ...actorState,
        revision: actorState.revision + 1,
        updatedAt: this.host.now(),
      });
    }
    this.host.appendEvent({
      type: "actor.background.updated",
      actorId: mutation.actorId,
      causationId,
      payload: {
        before: {
          ...previous,
          sourceEventIds: [...previous.sourceEventIds],
        },
        after: {
          ...next,
          sourceEventIds: [...next.sourceEventIds],
        },
      },
    });
  }

  actorWasSpawnedForBeat(actorId: string, beat: NarrativeBeat): boolean {
    const actor = this.host.state.actorDefinitions.get(actorId);
    if (actor?.kind !== "character" || actor.lifecycle !== "scene") return false;
    const sources = new Set(beat.sourceEventIds);
    return this.host.state.journal.all().some((event) => (
      event.type === "actor.registered" &&
      event.actorId === actorId &&
      Boolean(event.causationId && sources.has(event.causationId))
    ));
  }
}
