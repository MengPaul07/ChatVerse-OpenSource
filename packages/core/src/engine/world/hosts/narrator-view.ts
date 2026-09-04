import type {
  NarrativeBeat,
  WorldEvent,
} from "../../../contracts/world.js";
import type { PresentationController } from "../presentation/controller.js";
import { createDirectorReferenceTable } from "../director/references.js";
import type { NarratorView } from "../narrator/index.js";
import type { ChatContextRuntime } from "../runtime/context-runtime.js";
import type { TimelineRuntime } from "../runtime/timeline-runtime.js";
import type { WorldState } from "../state.js";
import {
  maximumBeatActorTurns,
  minimumBeatActorTurns,
} from "../narrative/beat-metrics.js";
import {
  isPlayerControlledActor,
} from "../persistence/definition.js";
import {
  memoryEventText,
  truncateText,
} from "../runtime/helpers.js";

interface NarratorViewServices {
  state: WorldState;
  presentation: PresentationController;
  timeline: TimelineRuntime;
  getContext(contextId: string): ChatContextRuntime;
  playerActorId(contextId: string): string | undefined;
  actorWasSpawnedForBeat(actorId: string, beat: NarrativeBeat): boolean;
  actorWakeValidationError(actorId: string, contextId: string): string | undefined;
}

/** Builds the compact, read-only view consumed by the Narrator. */
export class NarratorViewBuilder {
  constructor(private readonly services: NarratorViewServices) {}

  build(
    contextId: string,
    beat: NarrativeBeat,
    sourceEventIds: readonly string[],
    direction?: string,
  ): NarratorView {
    const {
      state,
      presentation,
      timeline,
    } = this.services;
    const runtime = this.services.getContext(contextId);
    const projected = state.contexts.get(contextId);
    const actorIds = state.actorIdsInContext(contextId).filter((actorId) => (
      state.actorStates.get(actorId)?.presence !== "offline"
    ));
    const playerActorId = this.services.playerActorId(contextId);
    const wakeableActorIds = actorIds.filter((actorId) => {
      const actor = state.actorDefinitions.get(actorId);
      return actor != null && (
        !isPlayerControlledActor(actor) || actorId === playerActorId
      );
    });
    const latestParticipant = runtime.definition.presentation?.kind === "galgame"
      ? presentation.latestQueuedParticipant(contextId)
      : undefined;
    const latestParticipantActorId = latestParticipant?.type === "actor" || latestParticipant?.type === "player"
      ? latestParticipant.actorId
      : undefined;
    const alternativeActorExists = latestParticipantActorId != null && wakeableActorIds.some((actorId) => (
      actorId !== latestParticipantActorId &&
      (actorId === playerActorId || this.services.actorWakeValidationError(actorId, contextId) == null)
    ));
    const immediatePreviousActorId = alternativeActorExists
      ? latestParticipantActorId
      : undefined;
    const sourceEvents = sourceEventIds
      .map((eventId) => state.journal.get(eventId))
      .filter((event): event is WorldEvent => Boolean(event));
    const references = createDirectorReferenceTable({
      actorIds,
      contextIds: [contextId],
      chapterIds: [beat.chapterId],
      beatIds: [beat.id],
      eventIds: sourceEvents.map((event) => event.id),
    });
    const cast = actorIds.map((actorId) => {
      const actor = state.getActorDefinition(actorId);
      if (!actor) throw new Error(`Unknown world actor: ${actorId}`);
      const name = actor.card.name;
      const role = actor.card.description;
      const knowledgeBoundary = isPlayerControlledActor(actor) && actor.playerCard
        ? `${actor.playerCard.identity}。${actor.playerCard.background}`
        : state.actorBackgrounds.get(actorId)?.text || actor.card.scenario;
      const participantKind = isPlayerControlledActor(actor) ? "player" : "actor";
      const beatEntry = this.services.actorWasSpawnedForBeat(actorId, beat)
        ? " [本幕新角色：open_beat 时优先给予首次表达机会]"
        : "";
      return `${name} [${participantKind}]`
        + `${role ? ` | role=${truncateText(role, 80)}` : ""}`
        + `${knowledgeBoundary ? ` | known=${truncateText(knowledgeBoundary, 180)}` : ""}`
        + beatEntry;
    }).join("\n");
    const latestSourceEvent = [...sourceEvents]
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    const triggerSource = !latestSourceEvent?.actorId
      ? "world" as const
      : isPlayerControlledActor(state.actorDefinitions.get(latestSourceEvent.actorId)!)
        ? "player" as const
        : "actor" as const;
    const triggerEvents = sourceEventIds
      .map((eventId) => state.journal.get(eventId))
      .filter((event): event is WorldEvent => Boolean(event))
      .slice(-6)
      .map((event) => {
        const sourceActor = event.actorId
          ? state.actorDefinitions.get(event.actorId)
          : undefined;
        const source = sourceActor
          ? `${isPlayerControlledActor(sourceActor) ? "player" : "actor"}=${sourceActor.card.name}`
          : "world";
        return `${references.refFor("event", event.id)} ${event.type} ${source}: ${truncateText(memoryEventText(event), 600)}`;
      })
      .join("\n");
    const ambientTriggered = sourceEvents.some((event) => (
      event.type === "world.progression.requested" &&
      event.payload.reason === "ambient"
    ));
    return {
      world: `${state.definition.metadata.name}\n${state.definition.metadata.description ?? ""}`,
      context: `${runtime.definition.name}\n${runtime.definition.scene.topic}\n${runtime.definition.scene.atmosphere}`,
      beat,
      sceneNow: projected?.scene?.text ?? runtime.definition.scene.topic,
      cast,
      availableActorIds: immediatePreviousActorId
        ? wakeableActorIds.filter((actorId) => actorId !== immediatePreviousActorId)
        : wakeableActorIds,
      actorNamesById: new Map(actorIds.map((actorId) => [
        actorId,
        runtime.actorNameById.get(actorId) ?? state.getActorDefinition(actorId)?.card.name ?? actorId,
      ])),
      references,
      ...(immediatePreviousActorId ? { immediatePreviousActorId } : {}),
      timeline: timeline.contextProjection(contextId, sourceEvents),
      triggerEvents,
      triggerSource,
      ambient: {
        triggered: ambientTriggered,
        noopCount: projected?.activity?.ambientNoopCount ?? 0,
      },
      progress: {
        actorTurns: this.beatActorTurnCount(beat),
        minimumActorTurns: minimumBeatActorTurns(beat),
        maximumActorTurns: maximumBeatActorTurns(beat),
        actorTurnsSinceNarration: this.beatActorTurnsSinceNarration(beat),
      },
      maxTokens: runtime.beatRuntime.narrationMaxTokens,
      presentation: runtime.definition.presentation?.kind === "galgame" ? "galgame" : "standard",
      ...(direction ? { direction } : {}),
    };
  }

  beatActorTurnCount(beat: NarrativeBeat): number {
    const sourceSequence = this.sourceSequence(beat);
    const contextIds = new Set(beat.contextIds);
    const turnIds = this.services.state.journal.all().filter((event) => (
      event.sequence > sourceSequence &&
      Boolean(event.contextId && contextIds.has(event.contextId)) &&
      Boolean(event.actorId) &&
      (event.type === "context.message.committed" || event.type === "context.action.committed")
    )).map((event) => event.correlationId ?? event.id);
    return new Set(turnIds).size;
  }

  beatActorTurnsSinceNarration(beat: NarrativeBeat): number {
    const sourceSequence = this.sourceSequence(beat);
    const contextIds = new Set(beat.contextIds);
    const lastNarrationSequence = this.services.state.journal.all()
      .filter((event) => (
        event.sequence > sourceSequence &&
        Boolean(event.contextId && contextIds.has(event.contextId)) &&
        event.type === "narrative.narration.committed"
      ))
      .at(-1)?.sequence ?? sourceSequence;
    const turnIds = this.services.state.journal.all().filter((event) => (
      event.sequence > lastNarrationSequence &&
      Boolean(event.contextId && contextIds.has(event.contextId)) &&
      Boolean(event.actorId) &&
      (event.type === "context.message.committed" || event.type === "context.action.committed")
    )).map((event) => event.correlationId ?? event.id);
    return new Set(turnIds).size;
  }

  latestContextEventIds(contextId: string, limit: number): string[] {
    return this.services.state.journal.all()
      .filter((event) => (
        event.contextId === contextId &&
        (event.type === "context.message.committed" || event.type === "context.action.committed")
      ))
      .slice(-limit)
      .map((event) => event.id);
  }

  private sourceSequence(beat: NarrativeBeat): number {
    return Math.max(
      0,
      ...beat.sourceEventIds.map((eventId) => this.services.state.journal.get(eventId)?.sequence ?? 0),
    );
  }
}
