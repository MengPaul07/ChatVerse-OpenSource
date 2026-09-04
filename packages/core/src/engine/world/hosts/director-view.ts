import type {
  WorldDefinition,
  WorldEvent,
  WorldSourceProvider,
} from "../../../contracts/world.js";
import { compactNarratorEvent, eventRelatedChapterIds, truncateText } from "../runtime/helpers.js";
import { isPlayerControlledActor } from "../persistence/definition.js";
import type { ActorGenerationCoordinator } from "../actor-coordinator.js";
import type { WorldState } from "../state.js";
import {
  createDirectorReferenceTable,
  type DirectorReferenceTable,
  type WorldDirectorTask,
  type WorldDirectorView,
} from "../director/index.js";

const CHAPTER_FRONTIER_LIMIT = 4;
const RECENT_BEAT_LIMIT = 3;
const RECENT_EDGE_LIMIT = 4;
const CONTEXT_INDEX_LIMIT = 12;
const CONTEXT_RUNTIME_LIMIT = 12;
const LORE_ENTRY_LIMIT = 8;
const LORE_MAX_CHARS = 2_400;

export interface DirectorViewBuilderOptions {
  state: WorldState;
  actorCoordinator: ActorGenerationCoordinator;
  sourceProvider?: WorldSourceProvider;
}

/** Builds the bounded, read-only prompt projection consumed by WorldDirector. */
export class DirectorViewBuilder {
  constructor(private readonly options: DirectorViewBuilderOptions) {}

  build(events: WorldEvent[], task?: WorldDirectorTask): WorldDirectorView {
    const { state } = this.options;
    const foregroundChapterId = state.foregroundChapterId
      ?? [...state.chapters.values()].find((chapter) => chapter.status === "active")?.id;
    const sourceBindings = state.definition.sources ?? [];
    const references = createDirectorReferenceTable({
      actorIds: [...state.actorDefinitions.keys()],
      contextIds: state.definition.contexts.map((context) => context.id),
      chapterIds: [...state.chapters.keys()],
      beatIds: [...state.beats.keys()],
      eventIds: [...new Set([
        ...events.map((event) => event.id),
        ...(task?.sourceEventIds ?? []),
        ...state.journal.all().map((event) => event.id),
      ])],
      sourceIds: sourceBindings.map((binding) => binding.bundleId),
    });
    const relevantActorIds = new Set(
      [...state.presences.values()]
        .filter((presence) => presence.participation !== "left")
        .map((presence) => presence.actorId),
    );
    for (const event of events) {
      if (event.actorId) relevantActorIds.add(event.actorId);
      if (event.type === "world.event.emitted") {
        for (const actorId of event.payload.actorIds) relevantActorIds.add(actorId);
      }
    }
    for (const chapter of state.chapters.values()) {
      if (chapter.status === "completed" || chapter.status === "abandoned") continue;
      for (const actorId of chapter.actorIds) relevantActorIds.add(actorId);
    }

    const visibleActors = [...state.actorDefinitions.values()]
      .filter((actor) => relevantActorIds.has(actor.id))
      .slice(0, 24);
    const indexedActors = state.definition.actors.slice(0, 24);
    const actorLines = indexedActors.map((actor) => {
      const participantKind = isPlayerControlledActor(actor) ? "player" : "actor";
      return `${referenceFor(references, "actor", actor.id)} (${actor.card.name}, ${participantKind}) lifecycle=${actor.lifecycle ?? "persistent"} role=${truncateText(actor.card.description || "(unspecified)", 240)}`;
    });
    const actorRuntimeLines = visibleActors.map((actor) => {
      const stateValue = state.actorStates.get(actor.id);
      const control = state.actorControls.get(actor.id);
      const background = state.actorBackgrounds.get(actor.id);
      const backgroundSummary = background
        ? ` background=r${background.revision}@${background.updatedAtSequence} "${truncateText(background.text, 180)}"`
        : "";
      const participantKind = isPlayerControlledActor(actor) ? "player" : "actor";
      return `${referenceFor(references, "actor", actor.id)} (${actor.card.name}, ${participantKind}) presence=${stateValue?.presence ?? "unknown"}${stateValue?.status ? ` status=${stateValue.status}` : ""} generation=${this.options.actorCoordinator.getStatus(actor.id)} director=${control?.policy.directorAuthority ?? "unknown"}${backgroundSummary}`;
    });
    const hiddenActorCount = Math.max(0, state.definition.actors.length - indexedActors.length);
    if (hiddenActorCount > 0) {
      actorLines.push(`(${hiddenActorCount} registered Actors are not active here; use query_actors when needed.)`);
    }

    const indexedContexts = state.definition.contexts.slice(0, CONTEXT_INDEX_LIMIT);
    const contextLines = indexedContexts.map((context) => {
      const actorIds = context.actorIds.slice(0, 24);
      const hidden = Math.max(0, context.actorIds.length - actorIds.length);
      return `${referenceFor(references, "context", context.id)} (${context.name}) actors=[${actorIds.map((actorId) => referenceFor(references, "actor", actorId)).join(",")}${hidden ? `,+${hidden} more` : ""}]`;
    });
    const hiddenContextCount = Math.max(0, state.definition.contexts.length - indexedContexts.length);
    if (hiddenContextCount > 0) {
      contextLines.push(`(${hiddenContextCount} additional Contexts omitted from the stable index.)`);
    }

    const eventContextIds = new Set(events.flatMap((event) => event.contextId ? [event.contextId] : []));
    const runtimeContexts = state.definition.contexts
      .filter((context) => eventContextIds.has(context.id) || state.contexts.get(context.id)?.status === "active")
      .slice(0, CONTEXT_RUNTIME_LIMIT);
    const contextRuntimeLines = runtimeContexts.map((context) => {
      const stateValue = state.contexts.get(context.id);
      const participation = state.actorIdsInContext(context.id, true).map((actorId) => {
        const local = state.getPresence(context.id, actorId);
        return `${referenceFor(references, "actor", actorId)}:${local?.participation ?? "unknown"}`;
      }).join(",");
      const scene = stateValue?.scene?.text ?? `${context.scene.topic} ${context.scene.atmosphere}`.trim();
      return `${referenceFor(references, "context", context.id)} status=${stateValue?.status ?? "unknown"} scene=${truncateText(scene || "(none)", 800)} actors=[${participation}]`;
    }).join("\n");

    const recentBeats = [...state.beats.values()]
      .sort((left, right) => left.occurredAt - right.occurredAt)
      .slice(-RECENT_BEAT_LIMIT);
    const recentBeatSummary = recentBeats
      .map((beat) => `${referenceFor(references, "beat", beat.id)} [${beat.status}] chapter=${referenceFor(references, "chapter", beat.chapterId)} ${truncateText(beat.title, 120)}: ${truncateText(beat.outcome ?? beat.script.result, 500)}; kind=${beat.kind ?? "full_scene"}; stages=${beat.script.stages?.map((stage) => stage.id).join(" -> ") || "(derived)"}; cause=${truncateText(beat.script.cause, 240)}; result=${truncateText(beat.script.result, 240)}`)
      .join("\n");
    const recentBeatIds = new Set(recentBeats.map((beat) => beat.id));
    const edgeSummary = [...state.edges.values()]
      .filter((edge) => recentBeatIds.has(edge.fromBeatId) || recentBeatIds.has(edge.toBeatId))
      .slice(-RECENT_EDGE_LIMIT)
      .map((edge) => `${referenceFor(references, "beat", edge.fromBeatId)} -[${edge.type}]-> ${referenceFor(references, "beat", edge.toBeatId)}${edge.description ? `: ${edge.description}` : ""}`)
      .join("\n");

    const sourceCatalog = this.options.sourceProvider?.catalog(sourceBindings) ?? [];
    const sourceSummary = sourceCatalog.map((item) => {
      const binding = sourceBindings.find((candidate) => candidate.bundleId === item.bundleId)!;
      return `${referenceFor(references, "source", item.bundleId)}@${item.revision} fidelity=${binding.fidelity} name=${item.name} documents=${item.documentCount} sections=${item.sectionCount} chunks=${item.chunkCount}${item.description ? ` description=${truncateText(item.description, 240)}` : ""}`;
    }).join("\n");

    return {
      worldSummary: references.redactKnownIds(this.buildWorldSummary(events)),
      actorSummary: references.redactKnownIds(actorLines.join("\n")),
      contextSummary: references.redactKnownIds(contextLines.join("\n")),
      runtimeSummary: references.redactKnownIds([
        `worldTime=${state.worldTime}`,
        ...actorRuntimeLines,
        ...contextRuntimeLines.split("\n"),
        `narrativeTotals=chapters:${state.chapters.size},beats:${state.beats.size},edges:${state.edges.size}; use query_narrative for older graph state`,
      ].join("\n")),
      chapterSummary: references.redactKnownIds(this.buildChapterFrontier(events, references)),
      recentBeatSummary: references.redactKnownIds(recentBeatSummary),
      edgeSummary: references.redactKnownIds(edgeSummary),
      sourceSummary: references.redactKnownIds(sourceSummary),
      sourceBindings: sourceBindings.map((binding) => ({ ...binding })),
      eventBatch: events,
      references,
      foregroundChapterId,
      task,
    };
  }

  private buildChapterFrontier(
    events: readonly WorldEvent[],
    references: DirectorReferenceTable,
  ): string {
    const { state } = this.options;
    const candidates = [...state.chapters.values()].filter((chapter) => (
      chapter.status !== "completed" && chapter.status !== "abandoned"
    ));
    const foregroundChapterId = state.foregroundChapterId
      ?? [...state.chapters.values()].find((chapter) => chapter.status === "active")?.id;
    const eventChapterIds = new Set(events.flatMap((event) => eventRelatedChapterIds(event)));
    const selected: typeof candidates = [];
    const append = (chapter: typeof candidates[number] | undefined): void => {
      if (!chapter || chapter.status === "completed" || chapter.status === "abandoned") return;
      if (selected.some((candidate) => candidate.id === chapter.id)) return;
      if (selected.length >= CHAPTER_FRONTIER_LIMIT) return;
      selected.push(chapter);
    };

    append(foregroundChapterId ? state.chapters.get(foregroundChapterId) : undefined);
    for (const chapterId of eventChapterIds) append(state.chapters.get(chapterId));
    for (const chapter of candidates.filter((candidate) => candidate.status === "active")) append(chapter);
    for (const chapter of candidates.filter((candidate) => candidate.status === "queued")) append(chapter);

    const lines = selected.map((chapter) => {
      const role = chapter.id === foregroundChapterId ? "foreground" : chapter.status;
      return [
        `${referenceFor(references, "chapter", chapter.id)} [${role}] ${truncateText(chapter.title, 120)}`,
        `treatment=${truncateText(chapter.treatment, 1_500)}`,
        `targetOutcome=${truncateText(chapter.targetOutcome, 500)}`,
        `actors=[${chapter.actorIds.map((actorId) => referenceFor(references, "actor", actorId)).join(",")}] contexts=[${chapter.contextIds.map((contextId) => referenceFor(references, "context", contextId)).join(",")}] beatCount=${chapter.beatIds.length}`,
      ].join("\n");
    });
    const hiddenCount = Math.max(0, candidates.length - selected.length);
    return [
      `foregroundChapter=${foregroundChapterId ? referenceFor(references, "chapter", foregroundChapterId) : "(none)"}; active=${candidates.filter((chapter) => chapter.status === "active").length}; queued=${candidates.filter((chapter) => chapter.status === "queued").length}`,
      ...lines,
      hiddenCount > 0
        ? `(${hiddenCount} chapters are outside this frontier; use query_narrative when an event references one.)`
        : "",
    ].filter(Boolean).join("\n");
  }

  private buildWorldSummary(events: readonly WorldEvent[]): string {
    const { state } = this.options;
    const definition: WorldDefinition = state.definition;
    const identity = [definition.metadata.name, definition.metadata.description ?? ""]
      .filter(Boolean)
      .join("\n");
    const lore = definition.lore;
    if (!lore) return identity;

    const searchText = [
      identity,
      ...events.map((event) => compactNarratorEvent(event)),
      ...[...state.contexts.values()].map((context) => context.scene?.text ?? ""),
      ...[...state.chapters.values()]
        .filter((chapter) => chapter.status !== "completed" && chapter.status !== "abandoned")
        .flatMap((chapter) => [chapter.title, chapter.treatment, chapter.targetOutcome]),
    ].join("\n").toLocaleLowerCase();
    const entries = lore.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.constant || entry.keys.some((key) => (
        Boolean(key.trim()) && searchText.includes(key.trim().toLocaleLowerCase())
      )))
      .sort((left, right) => (
        Number(right.entry.constant) - Number(left.entry.constant) ||
        left.entry.priority - right.entry.priority ||
        left.index - right.index
      ))
      .slice(0, LORE_ENTRY_LIMIT)
      .map(({ entry }) => `- ${entry.content.trim()}`)
      .filter((entry) => entry !== "- ");
    const loreText = truncateText([
      lore.name ? `名称：${lore.name}` : "",
      lore.description?.trim() ?? "",
      ...entries,
    ].filter(Boolean).join("\n"), LORE_MAX_CHARS);
    return loreText ? `${identity}\n\n【导演可用世界设定】\n${loreText}` : identity;
  }
}

function referenceFor(
  references: DirectorReferenceTable,
  kind: Parameters<DirectorReferenceTable["refFor"]>[0],
  id: string,
): string {
  return references.refFor(kind, id) ?? "(unresolved)";
}
