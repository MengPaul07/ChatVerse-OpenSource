import type { ChatMessage } from "../../../contracts/chat.js";
import { truncateText } from "../runtime/helpers.js";
import type { WorldState } from "../state.js";

export interface WorldInspectionHostOptions {
  state: WorldState;
  getContextMessages: (contextId: string) => readonly ChatMessage[];
  getActorGenerationStatus: (actorId: string) => string;
  getActorWakeStatus: (contextId: string, actorId: string) => string;
}

/**
 * Read-only views used by Director tools. Keeping these queries out of the
 * aggregate root makes it harder for an inspection path to mutate runtime
 * state while still allowing it to observe the latest committed projection.
 */
export class WorldInspectionHost {
  constructor(private readonly options: WorldInspectionHostOptions) {}

  inspectContext(contextId: string, limit: number): string {
    const messages = this.options.getContextMessages(contextId).slice(-limit);
    if (messages.length === 0) return "(no committed messages)";
    return messages.map((message) => (
      `${message.characterName}: ${message.message}`
    )).join("\n");
  }

  queryNarrative(
    query: string,
    chapterId: string | undefined,
    beatId: string | undefined,
    limit: number,
  ): string {
    const { state } = this.options;
    const normalized = query.trim().toLocaleLowerCase();
    const cappedLimit = Math.max(1, Math.min(20, limit));
    const chapters = [...state.chapters.values()]
      .filter((chapter) => {
        if (chapterId) return chapter.id === chapterId;
        if (!normalized) return true;
        return [chapter.id, chapter.title, chapter.treatment, chapter.targetOutcome, ...chapter.actorIds, ...chapter.contextIds]
          .join("\n")
          .toLocaleLowerCase()
          .includes(normalized);
      })
      .slice(0, cappedLimit);
    const matchingChapterIds = new Set(chapters.map((chapter) => chapter.id));
    const beats = [...state.beats.values()]
      .filter((beat) => {
        if (beatId) return beat.id === beatId;
        if (chapterId) return beat.chapterId === chapterId;
        if (!normalized) return matchingChapterIds.has(beat.chapterId);
        return [beat.id, beat.chapterId, beat.title, beat.brief, beat.outcome, ...beat.actorIds, ...beat.contextIds]
          .join("\n")
          .toLocaleLowerCase()
          .includes(normalized);
      })
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, cappedLimit);
    const matchingBeatIds = new Set(beats.map((beat) => beat.id));
    const edges = [...state.edges.values()]
      .filter((edge) => matchingBeatIds.has(edge.fromBeatId) || matchingBeatIds.has(edge.toBeatId))
      .slice(-cappedLimit);
    return truncateText([
      "[Chapters]",
      ...chapters.map((chapter) => `chapter=${chapter.id} [${chapter.status}] ${chapter.title}: ${chapter.treatment}; target=${chapter.targetOutcome}; beatCount=${chapter.beatIds.length}`),
      "[Beats]",
      ...beats.map((beat) => `beat=${beat.id} [${beat.status}] chapter=${beat.chapterId} ${beat.title}: ${beat.outcome ?? beat.script.result}; cause=${beat.script.cause}; turningPoint=${beat.script.turningPoint}; result=${beat.script.result}`),
      "[Edges]",
      ...edges.map((edge) => `fromBeat=${edge.fromBeatId} -[${edge.type}]-> toBeat=${edge.toBeatId}${edge.description ? `: ${edge.description}` : ""}`),
    ].join("\n"), 12_000);
  }

  inspectActor(actorId: string): string {
    const { state } = this.options;
    const actor = state.getActorDefinition(actorId);
    if (!actor) throw new Error(`Unknown world actor: ${actorId}`);
    const actorState = state.actorStates.get(actorId);
    const control = state.actorControls.get(actorId);
    const contexts = state.definition.contexts
      .filter((context) => state.getPresence(context.id, actorId))
      .map((context) => {
        const local = state.getPresence(context.id, actorId);
        return `context=${context.id}:${local?.participation ?? "unknown"} runtime=${this.options.getActorWakeStatus(context.id, actorId)}`;
      })
      .join(", ");
    const background = state.actorBackgrounds.get(actorId);
    return [
      `actor=${actorId} name=${actor.card.name} kind=${actor.kind}`,
      `presence=${actorState?.presence ?? "unknown"} status=${actorState?.status ?? ""}`,
      `generation=${this.options.getActorGenerationStatus(actorId)}`,
      background
        ? `backgroundRevision=${background.revision} backgroundUpdatedAtSequence=${background.updatedAtSequence}\nbackground=${background.text}`
        : "background=(not applicable)",
      `director=${control?.policy.directorAuthority ?? "unknown"}`,
      `contexts=${contexts || "(none)"}`,
    ].join("\n");
  }

  searchActors(query: string, contextId: string | undefined, limit: number): string {
    const { state } = this.options;
    const normalized = query.trim().toLocaleLowerCase();
    const results = [...state.actorDefinitions.values()]
      .filter((actor) => {
        if (!normalized) return true;
        const actorState = state.actorStates.get(actor.id);
        const text = [
          actor.id,
          actor.card.name,
          actor.card.description,
          actor.card.personality,
          actorState?.status,
        ].filter(Boolean).join("\n");
        return text.toLocaleLowerCase().includes(normalized);
      })
      .slice(0, Math.max(1, Math.min(20, limit)))
      .map((actor) => {
        const actorState = state.actorStates.get(actor.id);
        const participation = contextId
          ? state.getPresence(contextId, actor.id)?.participation ?? "not_joined"
          : undefined;
        return `actor=${actor.id} (${actor.card.name}, ${actor.kind}) presence=${actorState?.presence ?? "unknown"} generation=${this.options.getActorGenerationStatus(actor.id)}${participation ? ` participation=${participation}` : ""}`;
      });
    return results.join("\n") || "(no matching registered Actors)";
  }
}
