import type { NarrativeBeat } from "../../../contracts/world.js";

export const DEFAULT_BEAT_MIN_ACTOR_TURNS = 10;
export const DEFAULT_BEAT_MAX_ACTOR_TURNS = 20;

export function minimumBeatActorTurns(beat: NarrativeBeat): number {
  return Math.max(
    1,
    Math.min(24, Math.round(beat.minimumActorTurns || DEFAULT_BEAT_MIN_ACTOR_TURNS)),
  );
}

export function maximumBeatActorTurns(beat: NarrativeBeat): number {
  const minimum = minimumBeatActorTurns(beat);
  return Math.max(
    minimum + 1,
    Math.min(32, Math.round(beat.maximumActorTurns || DEFAULT_BEAT_MAX_ACTOR_TURNS)),
  );
}
