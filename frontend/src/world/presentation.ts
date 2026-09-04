import type { WorldView, WorldViewEntry } from "./types";

export const STORY_CHARACTERS_PER_SECOND = 18;

export type WorldViewContext = WorldView["contexts"][number];
export type WorldViewActor = WorldView["actors"][number];

/**
 * Stage mode may have several already committed turns behind the visible one.
 * In the world timeline, keep the current turn visible for its complete typing
 * duration before acknowledging it. Buffered turns must never collapse this
 * delay into a single render frame.
 */
export function presentationDrainDelayMs(
  entries: readonly WorldViewEntry[],
  pacingMultiplier: number,
  _bufferedTurnCount: number,
  acknowledgeAfter?: number,
  now = Date.now(),
): number {
  const lockDelay = Math.max(0, (acknowledgeAfter ?? 0) - now);
  if (pacingMultiplier <= 0) return lockDelay;
  const charCount = entries.reduce((total, entry) => total + [...entry.text.trim()].length, 0);
  const typingDelay = (0.35 + charCount / STORY_CHARACTERS_PER_SECOND) * pacingMultiplier * 1000;
  return Math.max(lockDelay, Math.min(180_000, Math.max(1_000, typingDelay)));
}

export function streamedTextLength(
  text: string,
  elapsedMs: number,
  pacingMultiplier: number,
  precedingCharacters = 0,
): number {
  if (pacingMultiplier <= 0) return [...text].length;
  const charactersPerSecond = STORY_CHARACTERS_PER_SECOND / pacingMultiplier;
  const localElapsedMs = elapsedMs - (precedingCharacters / charactersPerSecond * 1_000);
  if (localElapsedMs <= 0) return 0;
  return Math.min([...text].length, Math.floor(localElapsedMs / 1_000 * charactersPerSecond));
}

export function getContextEntries(
  view: WorldView,
  contextId: string | undefined,
): WorldViewEntry[] {
  return view.entries.filter((entry) => (
    entry.contextId === contextId || (!entry.contextId && view.contexts.length === 1)
  ));
}

export function getVisiblePresentationEntries(
  view: WorldView,
  context: WorldViewContext | undefined,
): WorldViewEntry[] {
  return getContextEntries(view, context?.id);
}

/** Beat cards follow the same causal frontier as visible presentation turns. */
export function getVisiblePresentationBeats(
  view: WorldView,
  context: WorldViewContext | undefined,
  visibleEntries: readonly WorldViewEntry[],
): WorldView["narrative"]["beats"] {
  const contextBeats = view.narrative.beats.filter((beat) => beat.contextIds.includes(context?.id ?? ""));
  const currentIds = new Set(context?.presentationTurn?.entryIds ?? []);
  const contextEntries = getContextEntries(view, context?.id);
  const currentSequences = contextEntries
    .filter((entry) => currentIds.has(entry.id))
    .map((entry) => entry.sequence);
  let frontier = Number.POSITIVE_INFINITY;
  if (currentSequences.length > 0) frontier = Math.max(...currentSequences);
  else if (context?.presentationTurn && visibleEntries.length > 0) {
    frontier = visibleEntries[visibleEntries.length - 1]!.sequence;
  }
  return contextBeats.filter((beat) => beat.sequence <= frontier);
}

export type StoryTimelineItem =
  | { type: "entry"; id: string; sequence: number; entry: WorldViewEntry }
  | {
      type: "beat";
      id: string;
      sequence: number;
      beat: WorldView["narrative"]["beats"][number];
      beatNumber: number;
    };

export function buildStoryTimeline(
  entries: readonly WorldViewEntry[],
  beats: readonly WorldView["narrative"]["beats"][number][],
): StoryTimelineItem[] {
  const orderedBeats = [...beats].sort((left, right) => left.sequence - right.sequence);
  const beatNumberById = new Map(orderedBeats.map((beat, index) => [beat.id, index + 1]));
  return [
    ...entries.map((entry) => ({
      type: "entry" as const,
      id: `entry:${entry.id}`,
      sequence: entry.sequence,
      entry,
    })),
    ...beats.map((beat) => ({
      type: "beat" as const,
      id: `beat:${beat.id}`,
      sequence: beat.sequence,
      beat,
      beatNumber: beatNumberById.get(beat.id) ?? 1,
    })),
  ].sort((left, right) => left.sequence - right.sequence);
}

export function buildPresentationSegments(entries: readonly WorldViewEntry[]) {
  let cursor = 0;
  return entries.map((entry, index) => {
    if (index > 0) cursor += 1;
    const text = entry.kind === "action" && entry.actorName
      ? `${entry.actorName} ${entry.text}`
      : entry.text;
    const start = cursor;
    cursor += text.length;
    return { entry, text, start, end: cursor };
  });
}

export function selectPresentationTurnEntries(
  entries: readonly WorldViewEntry[],
  entryIds: readonly string[],
  retained: readonly WorldViewEntry[] = [],
): WorldViewEntry[] {
  if (entryIds.length > 0) {
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const selected = entryIds.flatMap((entryId) => {
      const entry = entriesById.get(entryId);
      return entry ? [entry] : [];
    });
    // A turn is one atomic presentation unit. Do not render a partial action
    // or message while the other entry is still arriving from the stream.
    return selected.length === entryIds.length ? selected : [];
  }
  if (retained.length > 0) return [...retained];
  return entries.slice(-1);
}

export function orderPresentationEntries(
  entries: readonly WorldViewEntry[],
  entryIds: readonly string[],
): WorldViewEntry[] {
  if (entryIds.length < 2) return [...entries];
  const selected = selectPresentationTurnEntries(entries, entryIds);
  if (selected.length !== entryIds.length) return entries.filter((entry) => !entryIds.includes(entry.id));
  const ids = new Set(entryIds);
  const firstIndex = entries.findIndex((entry) => ids.has(entry.id));
  if (firstIndex < 0) return [...entries];
  return [
    ...entries.slice(0, firstIndex).filter((entry) => !ids.has(entry.id)),
    ...selected,
    ...entries.slice(firstIndex).filter((entry) => !ids.has(entry.id)),
  ];
}

export function selectStageActor(
  actors: readonly WorldViewActor[],
  entry: WorldViewEntry | undefined,
): WorldViewActor | undefined {
  if (!entry?.actorId || entry.kind === "narration" || entry.kind === "directive") return undefined;
  return actors.find((actor) => actor.id === entry.actorId);
}

export function hasVisibleCurrentTurn(
  view: WorldView,
  context: WorldViewContext | undefined,
): boolean {
  const turn = context?.presentationTurn;
  if (!turn || turn.status !== "waiting_ack" || turn.entryIds.length === 0) return false;
  const entries = getContextEntries(view, context?.id);
  const ids = new Set(entries.map((entry) => entry.id));
  return turn.entryIds.every((entryId) => ids.has(entryId));
}
