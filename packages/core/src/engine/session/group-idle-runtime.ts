import type { CharacterCard, CharacterState } from "../../contracts/chat.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import { clamp, randomJitter } from "./helpers.js";

export type GroupIdleOpportunityReason =
  | "opening"
  | "response"
  | "ambient"
  | "silent_retry";

export type GroupActivitySource = "human" | "character";

export interface GroupIdleRuntimeHost {
  getCharacters(): readonly CharacterCard[];
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  hasGeneratingSpeaker(characterName: string): boolean;
  hasScheduledSpeaker(characterName: string): boolean;
  getPacingMultiplier(): number;
  now(): number;
  shouldForceSpeakAfterConsecutiveSilents(): boolean;
  isEnabled(): boolean;
  onIdleScheduled(input: {
    characterName: string;
    nextIdleSec: number;
    reason: GroupIdleOpportunityReason | "cancelled" | "silent";
    detail?: string;
  }): void;
  wake(reason: string): void;
}

/**
 * Owns only the autonomous scheduling policy used by standalone Group
 * conversations. World contexts use explicit wake requests instead.
 */
export class GroupIdleRuntime {
  private _activityRevision = 0;
  private _autonomousTurnStreak = 0;

  constructor(private readonly host: GroupIdleRuntimeHost) {}

  get activityRevision(): number {
    return this._activityRevision;
  }

  initialize(historyCount: number, actionCount: number): void {
    this._activityRevision = historyCount + actionCount;
    this._autonomousTurnStreak = 0;
    for (const character of this.host.getCharacters()) {
      const previous = this.host.getCharacterRuntime(character.name);
      this.host.setCharacterRuntime(character.name, {
        ...previous,
        characterName: character.name,
        idleCheckAt: undefined,
        idleRevision: undefined,
        idleReason: undefined,
      });
    }
    const hasHistory = historyCount > 0 || actionCount > 0;
    this.scheduleOpportunity(hasHistory ? "response" : "opening", this.host.now(), new Set());
  }

  markActivity(speakers: readonly string[], source: GroupActivitySource): void {
    if (!this.host.isEnabled()) return;

    this._activityRevision += 1;
    this._autonomousTurnStreak = source === "character"
      ? this._autonomousTurnStreak + 1
      : 0;

    for (const character of this.host.getCharacters()) {
      const characterName = character.name;
      const runtime = this.host.getCharacterRuntime(characterName);
      if (runtime?.idleCheckAt === undefined || runtime.idleRevision === this._activityRevision) continue;
      this.host.setCharacterRuntime(characterName, {
        ...runtime,
        idleCheckAt: undefined,
        idleRevision: undefined,
        idleReason: undefined,
      });
      this.host.onIdleScheduled({
        characterName,
        nextIdleSec: 0,
        reason: "cancelled",
        detail: `stale activity revision ${runtime.idleRevision ?? "unknown"} -> ${this._activityRevision}`,
      });
    }

    const excluded = new Set(speakers);
    const first = this.scheduleOpportunity("response", this.host.now(), excluded);
    if (!first) return;
    excluded.add(first);

    const extraChance = source === "human"
      ? 0.3
      : Math.max(0.08, 0.24 * Math.pow(0.65, Math.max(0, this._autonomousTurnStreak - 1)));
    if (Math.random() < extraChance) {
      this.scheduleOpportunity("response", this.host.now(), excluded, 1);
    }
  }

  scheduleAmbientOpportunity(excluded: Set<string>, now: number): void {
    this.scheduleOpportunity("ambient", now, excluded);
  }

  scheduleOpportunity(
    reason: GroupIdleOpportunityReason,
    now: number,
    excluded: Set<string>,
    rank = 0,
    preferred?: string,
  ): string | undefined {
    const preferredState = preferred ? this.host.getCharacterState(preferred) : undefined;
    const preferredRuntime = preferred ? this.host.getCharacterRuntime(preferred) : undefined;
    const preferredReady = Boolean(
      preferred &&
      !excluded.has(preferred) &&
      preferredState?.availability === "available" &&
      !this.host.hasGeneratingSpeaker(preferred) &&
      !this.host.hasScheduledSpeaker(preferred) &&
      (preferredRuntime?.mutedUntil ?? 0) <= now,
    );
    const candidate = preferredReady ? preferred : this.selectCandidate(excluded, now);
    if (!candidate) return undefined;

    const state = this.host.getCharacterState(candidate);
    const delaySec = this.computeOpportunityDelaySec(state, reason, rank);
    const runtime = this.host.getCharacterRuntime(candidate) ?? { characterName: candidate };
    this.host.setCharacterRuntime(candidate, {
      ...runtime,
      characterName: candidate,
      idleCheckAt: now + delaySec * 1000,
      idleRevision: this._activityRevision,
      idleReason: reason,
    });
    this.host.onIdleScheduled({
      characterName: candidate,
      nextIdleSec: delaySec,
      reason,
      detail: `activity revision ${this._activityRevision}${rank > 0 ? ` candidate ${rank + 1}` : ""}`,
    });
    this.host.wake("group_idle_scheduled");
    return candidate;
  }

  private selectCandidate(excluded: Set<string>, now: number): string | undefined {
    const candidates = this.host.getCharacters()
      .filter((character) => !excluded.has(character.name))
      .filter((character) => this.host.getCharacterState(character.name)?.availability === "available")
      .filter((character) => !this.host.hasGeneratingSpeaker(character.name))
      .filter((character) => !this.host.hasScheduledSpeaker(character.name))
      .filter((character) => (this.host.getCharacterRuntime(character.name)?.mutedUntil ?? 0) <= now);
    if (!candidates.length) return undefined;

    const weighted = candidates.map((character) => {
      const state = this.host.getCharacterState(character.name);
      const runtime = this.host.getCharacterRuntime(character.name);
      const attentionWeight = state?.attention === "active"
        ? 1
        : state?.attention === "lurking"
          ? 0.48
          : 0.22;
      const recentMs = runtime?.lastSpokeAt ? now - runtime.lastSpokeAt : Infinity;
      const recencyWeight = recentMs < 60_000 ? 0.3 : recentMs < 180_000 ? 0.65 : 1;
      const livenessWeight = (runtime?.consecutiveSilentCount ?? 0) >= 3 ? 1.2 : 1;
      return { name: character.name, weight: attentionWeight * recencyWeight * livenessWeight };
    });
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    for (const item of weighted) {
      cursor -= item.weight;
      if (cursor <= 0) return item.name;
    }
    return weighted.at(-1)?.name;
  }

  private computeOpportunityDelaySec(
    state: CharacterState | undefined,
    reason: GroupIdleOpportunityReason,
    rank: number,
  ): number {
    const pacingMultiplier = this.host.getPacingMultiplier();
    if (pacingMultiplier === 0) return 0;
    const attentionBase = reason === "opening"
      ? state?.attention === "active" ? 4 : state?.attention === "lurking" ? 8 : 12
      : reason === "ambient"
        ? state?.attention === "active" ? 65 : state?.attention === "lurking" ? 110 : 150
        : state?.attention === "active" ? 7 : state?.attention === "lurking" ? 12 : 18;
    const rankOffset = rank > 0 ? 6 + rank * 3 : 0;
    const jitterRange = reason === "ambient" ? attentionBase * 0.5 : attentionBase * 0.45;
    const raw = attentionBase + rankOffset + randomJitter(jitterRange);
    const min = reason === "ambient" ? 45 : reason === "opening" ? 2 : 4;
    const max = reason === "ambient" ? 300 : reason === "opening" ? 15 : 45;
    return Math.round(clamp(
      raw * pacingMultiplier,
      min * pacingMultiplier,
      max * pacingMultiplier,
    ));
  }

  onSilentDecision(
    characterName: string,
    now: number,
    retryAfterLivenessLimit: boolean,
  ): void {
    this.scheduleOpportunity(
      retryAfterLivenessLimit ? "silent_retry" : "ambient",
      now,
      retryAfterLivenessLimit ? new Set<string>() : new Set([characterName]),
      0,
      retryAfterLivenessLimit ? characterName : undefined,
    );
  }
}
