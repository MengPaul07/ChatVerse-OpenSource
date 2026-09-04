import type {
  ActorAction,
  CharacterCard,
  CharacterState,
  ChatMessage,
} from "../../contracts/chat.js";
import type { DebugEventInput } from "../../observability/debug/index.js";
import type { AgentWake } from "../harness/index.js";
import type { HarnessTriggerInput } from "../events/index.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { SessionOutputRuntime } from "./output-runtime.js";
import { GroupIdleRuntime } from "./group-idle-runtime.js";
import {
  computeIdleCooldownSec as calculateIdleCooldownSec,
  computeInitialIdleSec as calculateInitialIdleSec,
  computePassiveIdleBackoffSec as calculatePassiveIdleBackoffSec,
} from "./timing.js";
import type { IdleCooldownInput } from "./timing.js";

export type WakeStrength = "weak" | "normal" | "strong";

export type SessionIdleCooldownInput = Omit<IdleCooldownInput, "characterCount" | "pacingMultiplier">;

interface WakeSignalInput {
  target: string;
  source: string;
  strength?: WakeStrength;
  reason?: string;
}

export interface SessionIdleRuntimeHost {
  readonly outputRuntime: SessionOutputRuntime;
  readonly scheduledQueue: ScheduledMessageQueue;
  readonly generatingQueue: GeneratingMessageQueue;
  readonly groupIdleRuntime: GroupIdleRuntime;
  getCharacters(): readonly CharacterCard[];
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  getMessages(): readonly ChatMessage[];
  getActions(): readonly ActorAction[];
  getPacingMultiplier(): number;
  isAutonomousIdleEnabled(): boolean;
  isGroupConversation(): boolean;
  isWorldSession(): boolean;
  isExternallyScheduled(): boolean;
  shouldForceSpeakAfterConsecutiveSilents(): boolean;
  now(): number;
  emitDebug(input: DebugEventInput): void;
  wake(reason: string): void;
}

/** Owns all idle timing and character-to-character wake policy for Session. */
export class SessionIdleRuntime {
  constructor(private readonly host: SessionIdleRuntimeHost) {}

  hasNewContextForCharacter(characterName: string, since?: number): boolean {
    if (!since) return true;
    return this.host.getMessages().some((message) => (
      message.timestamp > since && message.characterName !== characterName
    )) || this.host.getActions().some((action) => (
      action.timestamp > since && action.characterName !== characterName
    ));
  }

  computePassiveIdleBackoffSec(characterName: string): number {
    return calculatePassiveIdleBackoffSec(
      this.host.getCharacterState(characterName),
      this.host.getCharacters().length,
      this.host.getPacingMultiplier(),
    );
  }

  schedulePassiveIdleBackoff(
    characterName: string,
    runtime: CharacterRuntimeState,
    now: number,
  ): number {
    const nextIdleSec = this.computePassiveIdleBackoffSec(characterName);
    this.host.setCharacterRuntime(characterName, {
      ...runtime,
      characterName,
      idleCheckAt: now + nextIdleSec * 1000,
      // A skipped timer is not a silent turn. Only a parsed silent decision
      // advances liveness.
      passiveBackoffCount: (runtime.passiveBackoffCount ?? 0) + 1,
    });
    this.host.emitDebug({
      type: "harness.idle_scheduled",
      characterName,
      nextIdleSec,
      reason: "passive_backoff",
    });
    return nextIdleSec;
  }

  shouldForceHarnessContinuation(runtime: CharacterRuntimeState | undefined): boolean {
    return (
      this.host.shouldForceSpeakAfterConsecutiveSilents() &&
      (runtime?.consecutiveSilentCount ?? 0) >= 3
    );
  }

  computeInitialIdleSec(_characterName: string, state?: CharacterState): number {
    return calculateInitialIdleSec(
      state,
      this.host.getCharacters().length,
      this.host.getPacingMultiplier(),
    );
  }

  computeIdleCooldownSec(args: SessionIdleCooldownInput): number {
    return calculateIdleCooldownSec({
      ...args,
      characterCount: this.host.getCharacters().length,
      pacingMultiplier: this.host.getPacingMultiplier(),
    });
  }

  nextIdleCheckDueMs(): { ms: number; name: string } | null {
    if (!this.host.isAutonomousIdleEnabled()) return null;
    const now = this.host.now();
    let earliest = Infinity;
    let name = "";
    for (const runtime of this.host.getCharacters().map((character) => (
      this.host.getCharacterRuntime(character.name)
    ))) {
      if (runtime?.idleCheckAt && runtime.idleCheckAt > now && runtime.idleCheckAt - now < earliest) {
        earliest = runtime.idleCheckAt - now;
        name = runtime.characterName;
      }
    }
    return earliest === Infinity ? null : { ms: Math.max(0, earliest), name };
  }

  getHarnessWait(): { waitMs?: number; reason: string } {
    const scheduled = this.host.outputRuntime.nextScheduledDueMs();
    if (scheduled != null) return { waitMs: scheduled, reason: "scheduled" };
    if (this.host.generatingQueue.length > 0) return { waitMs: 30_000, reason: "generating" };
    const idle = this.nextIdleCheckDueMs();
    if (idle != null) return { waitMs: idle.ms, reason: `idle ${idle.name}` };
    if (this.host.isExternallyScheduled()) return { reason: "external_wake" };
    return { waitMs: 30_000, reason: "idle" };
  }

  applyWakeFromParsed(wake: AgentWake | undefined, source: string): void {
    if (!wake) return;
    this.applyWakeSignal({
      target: wake.target,
      source,
      strength: wake.strength ?? "normal",
      reason: wake.reason,
    });
  }

  applyWakeSignal(input: WakeSignalInput): void {
    const strength = input.strength ?? "normal";
    if (!this.host.isAutonomousIdleEnabled()) {
      this.host.emitDebug({
        type: "harness.wake_signal",
        source: input.source,
        target: input.target,
        strength,
        reason: input.reason,
        applied: false,
        skippedReason: "world uses explicit wake routing",
      });
      return;
    }

    const now = this.host.now();
    const target = this.host.getCharacters().find((character) => character.name === input.target);
    const emitSkipped = (skippedReason: string): void => {
      this.host.emitDebug({
        type: "harness.wake_signal",
        source: input.source,
        target: input.target,
        strength,
        reason: input.reason,
        applied: false,
        skippedReason,
      });
    };

    if (!target) return emitSkipped("target_not_found");
    if (target.name === input.source) return emitSkipped("self_wake");
    if (this.host.getCharacterState(target.name)?.availability === "unavailable") {
      return emitSkipped("target_unavailable");
    }
    if (this.host.generatingQueue.hasSpeaker(target.name)) return emitSkipped("target_generating");
    if (this.host.scheduledQueue.all.some((message) => message.speaker === target.name)) {
      return emitSkipped("target_scheduled");
    }

    const runtime = this.host.getCharacterRuntime(target.name) ?? { characterName: target.name };
    if (
      runtime.lastWakeFrom === input.source &&
      runtime.lastWakeAt &&
      now - runtime.lastWakeAt < 30_000
    ) {
      return emitSkipped("debounced");
    }

    const delaySec = strength === "strong" ? 1 : strength === "weak" ? 15 : 6;
    const desiredAt = Math.max(now + delaySec * 1000, runtime.mutedUntil ?? 0);
    if (this.host.isGroupConversation()) {
      // An explicit character wake replaces passive candidates, so no second
      // near-simultaneous decision is left behind.
      for (const character of this.host.getCharacters()) {
        if (character.name === target.name) continue;
        const other = this.host.getCharacterRuntime(character.name);
        if (!other || other.idleCheckAt === undefined) continue;
        this.host.setCharacterRuntime(character.name, {
          ...other,
          idleCheckAt: undefined,
          idleRevision: undefined,
          idleReason: undefined,
        });
        this.host.emitDebug({
          type: "harness.idle_scheduled",
          characterName: character.name,
          nextIdleSec: 0,
          reason: "cancelled",
          detail: `replaced by explicit wake for ${target.name}`,
        });
      }
    }

    if (runtime.idleCheckAt && runtime.idleCheckAt <= desiredAt) {
      return emitSkipped("already_sooner");
    }

    const nextIdleSec = Math.max(0, Math.round((desiredAt - now) / 100) / 10);
    this.host.setCharacterRuntime(target.name, {
      ...runtime,
      characterName: target.name,
      idleCheckAt: desiredAt,
      idleRevision: this.host.isGroupConversation()
        ? this.host.groupIdleRuntime.activityRevision
        : runtime.idleRevision,
      idleReason: this.host.isGroupConversation() ? "response" : runtime.idleReason,
      lastWakeAt: now,
      lastWakeFrom: input.source,
      wakeReason: input.reason,
      wakeStrength: strength,
    });
    this.host.emitDebug({
      type: "harness.wake_signal",
      source: input.source,
      target: target.name,
      strength,
      reason: input.reason,
      applied: true,
      nextIdleSec,
    });
    this.host.wake("wake_signal");
  }

  setIdleAfterDecision(
    trigger: HarnessTriggerInput,
    characterName: string,
    decision: "speak" | "silent",
    isClosing: boolean,
    modelHintSec?: number,
  ): void {
    const previous = this.host.getCharacterRuntime(characterName) ?? { characterName };
    if (!this.host.isAutonomousIdleEnabled()) {
      this.host.setCharacterRuntime(characterName, {
        characterName,
        lastDecisionAt: this.host.now(),
        lastMentionedAt: trigger.type === "mention" ? this.host.now() : previous.lastMentionedAt,
      });
      return;
    }

    if (this.host.isGroupConversation()) {
      const now = this.host.now();
      const nextSilentCount = decision === "silent"
        ? (previous.consecutiveSilentCount ?? 0) + 1
        : previous.consecutiveSilentCount ?? 0;
      this.host.setCharacterRuntime(characterName, {
        ...previous,
        characterName,
        idleCheckAt: undefined,
        idleRevision: undefined,
        idleReason: undefined,
        lastDecisionAt: now,
        lastMentionedAt: trigger.type === "mention" ? now : previous.lastMentionedAt,
        consecutiveSilentCount: nextSilentCount,
        passiveBackoffCount: 0,
      });
      if (decision === "silent") {
        const retryAfterLivenessLimit = (
          nextSilentCount >= 3 && this.host.shouldForceSpeakAfterConsecutiveSilents()
        );
        this.host.groupIdleRuntime.onSilentDecision(characterName, now, retryAfterLivenessLimit);
      }
      this.host.emitDebug({
        type: "harness.idle_scheduled",
        characterName,
        nextIdleSec: 0,
        reason: "silent",
        detail: decision === "silent"
          ? `model silent count ${nextSilentCount}`
          : "group activity selects the next candidate",
      });
      return;
    }

    if (this.host.isWorldSession()) {
      // World actors are explicitly woken by the World runtime. Once an
      // autonomous fallback wake has produced its visible turn, do not arm
      // another idle timer and create a self-sustaining loop.
      const now = this.host.now();
      this.host.setCharacterRuntime(characterName, {
        ...previous,
        characterName,
        idleCheckAt: undefined,
        idleRevision: undefined,
        idleReason: undefined,
        lastDecisionAt: now,
        lastMentionedAt: trigger.type === "mention" ? now : previous.lastMentionedAt,
        consecutiveSilentCount: 0,
        passiveBackoffCount: 0,
      });
      this.host.emitDebug({
        type: "harness.idle_scheduled",
        characterName,
        nextIdleSec: 0,
        reason: "world_output_complete",
      });
      return;
    }

    const triggerSource = trigger.source ?? "character";
    const idleSec = this.computeIdleCooldownSec({
      characterName,
      state: this.host.getCharacterState(characterName),
      triggerType: trigger.type,
      triggerSource,
      decision,
      isClosingMessage: isClosing,
      modelHintSec,
    });
    const now = this.host.now();
    this.host.setCharacterRuntime(characterName, {
      ...previous,
      idleCheckAt: now + idleSec * 1000,
      lastDecisionAt: now,
      lastMentionedAt: trigger.type === "mention" ? now : previous.lastMentionedAt,
      consecutiveSilentCount: decision === "silent"
        ? (previous.consecutiveSilentCount ?? 0) + 1
        : 0,
      passiveBackoffCount: 0,
    });
    this.host.emitDebug({
      type: "harness.idle_scheduled",
      characterName,
      nextIdleSec: idleSec,
      reason: decision === "speak" ? "speak_sent" : "silent",
    });
  }
}
