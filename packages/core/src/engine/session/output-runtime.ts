import type {
  ActorAction,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
} from "../../contracts/chat.js";
import type { GeneratingMessage, ScheduledMessage } from "../queues/types.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { CharacterRuntimeState } from "../queues/index.js";

export interface SessionOutputRuntimeHost {
  readonly scheduledQueue: ScheduledMessageQueue;
  readonly generatingQueue: GeneratingMessageQueue;
  now(): number;
  nextId(): string;
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  applyCharacterStatePatch(
    characterName: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void;
  isAutonomousIdleEnabled(): boolean;
  isGroupConversation(): boolean;
  isExternallyScheduled(): boolean;
  interventionCommitWindowMs(): number;
  hasPendingCharacterOutput(characterName: string): boolean;
  abortCharacterGeneration(characterName: string, reason: string): void;
  rescheduleIdleAfterCancellation(characterName: string, reason: string, now: number): void;
  onScheduledDropped(message: ScheduledMessage, reason: string, notify: boolean): void;
  onGeneratingDropped(item: GeneratingMessage, reason: string): void;
  onIdleScheduled(input: {
    characterName: string;
    nextIdleSec: number;
    reason: "speak_sent" | "cancelled";
    detail?: string;
  }): void;
  commitAction(action: ActorAction, scheduled: ScheduledMessage): void;
  commitMessage(message: ChatMessage, scheduled: ScheduledMessage): void;
  onActorOutputDrained(characterName: string, producedOutput?: boolean): void;
  markGroupActivity(speakers: readonly string[]): void;
}

/** Owns the scheduled output lane and its commit/cancellation semantics. */
export class SessionOutputRuntime {
  private _scheduleCursor = 0;

  constructor(private readonly host: SessionOutputRuntimeHost) {}

  get scheduleCursor(): number {
    return this._scheduleCursor;
  }

  set scheduleCursor(value: number) {
    this._scheduleCursor = value;
  }

  refreshScheduleCursor(): void {
    this._scheduleCursor = Math.max(
      this.host.now(),
      ...this.host.scheduledQueue.all.map((message) => message.sendAt),
    );
  }

  nextScheduledDueMs(): number | null {
    let earliest = Infinity;
    for (const message of this.host.scheduledQueue.all) {
      const remaining = message.sendAt - this.host.now();
      if (remaining < earliest) earliest = remaining;
    }
    return earliest === Infinity ? null : Math.max(0, earliest);
  }

  buildScheduledPreview(): string {
    const now = this.host.now();
    const items: string[] = [];
    for (const message of this.host.scheduledQueue.pending) {
      const eta = Math.max(0, Math.round((message.sendAt - now) / 100) / 10);
      const label = message.outputKind === "action" ? "动作" : "消息";
      items.push(`${message.speaker}（${eta}s后${label}）${message.message.slice(0, 40)}`);
    }
    return items.length ? items.join(", ") : "";
  }

  async *flushScheduledMessages(): AsyncGenerator<ChatMessage> {
    const due = this.host.scheduledQueue.due(this.host.now());
    const committedSpeakers = new Set<string>();
    for (const scheduled of due) {
      if (this.host.getCharacterState(scheduled.speaker)?.availability === "unavailable") {
        this.host.onScheduledDropped(scheduled, "actor unavailable before commit", false);
        continue;
      }
      if (scheduled.statePatch) {
        this.host.applyCharacterStatePatch(scheduled.speaker, scheduled.statePatch, "character");
      }

      const now = this.host.now();
      this.updateRuntimeAfterCommit(scheduled, now);
      if (scheduled.outputKind === "action") {
        const action: ActorAction = {
          id: this.host.nextId(),
          characterName: scheduled.speaker,
          action: scheduled.message,
          contextTransition: scheduled.contextTransition,
          timestamp: now,
        };
        this.host.commitAction(action, scheduled);
        committedSpeakers.add(scheduled.speaker);
        continue;
      }

      const message: ChatMessage = {
        id: this.host.nextId(),
        characterName: scheduled.speaker,
        message: scheduled.message,
        timestamp: now,
        source: "character",
      };
      this.host.commitMessage(message, scheduled);
      committedSpeakers.add(scheduled.speaker);
      yield message;
    }

    // A queue drain is the atomic boundary for one generated Actor burst.
    for (const speaker of committedSpeakers) {
      this.host.onActorOutputDrained(speaker, true);
    }
    if (this.host.isGroupConversation() && committedSpeakers.size > 0) {
      this.host.markGroupActivity([...committedSpeakers]);
    }
  }

  cancelInterruptibleOutputs(reason: string, preserveCommitWindow = true): void {
    const now = this.host.now();
    const cancelledSpeakers = new Set<string>();
    for (const scheduled of this.host.scheduledQueue.all) {
      const remainingMs = scheduled.sendAt - now;
      if (preserveCommitWindow && remainingMs <= this.host.interventionCommitWindowMs()) continue;
      this.host.scheduledQueue.cancel(scheduled.id);
      cancelledSpeakers.add(scheduled.speaker);
      this.host.onScheduledDropped(scheduled, `cancelled: ${reason}`, true);
    }

    for (const generating of this.host.generatingQueue.cancelAll()) {
      this.host.abortCharacterGeneration(generating.speaker, reason);
      cancelledSpeakers.add(generating.speaker);
      this.host.onGeneratingDropped(generating, `cancelled: ${reason} (generating)`);
    }

    for (const speaker of cancelledSpeakers) {
      if (this.host.scheduledQueue.all.some((message) => message.speaker === speaker)) continue;
      this.host.rescheduleIdleAfterCancellation(speaker, reason, now);
      if (!this.host.hasPendingCharacterOutput(speaker)) {
        this.host.onActorOutputDrained(speaker);
      }
    }
    this.refreshScheduleCursor();
  }

  private updateRuntimeAfterCommit(scheduled: ScheduledMessage, now: number): void {
    const autonomous = this.host.isAutonomousIdleEnabled();
    if (autonomous && scheduled.nextIdleSec && !this.host.isGroupConversation()) {
      const previousRuntime = this.host.getCharacterRuntime(scheduled.speaker);
      const remainsAvailable = this.host.getCharacterState(scheduled.speaker)?.availability === "available";
      this.host.setCharacterRuntime(scheduled.speaker, {
        ...previousRuntime,
        characterName: scheduled.speaker,
        idleCheckAt: remainsAvailable ? now + scheduled.nextIdleSec * 1000 : undefined,
        mutedUntil: now + 8000,
        lastSpokeAt: now,
        lastDecisionAt: previousRuntime?.lastDecisionAt ?? now,
        consecutiveSilentCount: 0,
      });
      if (remainsAvailable) {
        this.host.onIdleScheduled({
          characterName: scheduled.speaker,
          nextIdleSec: scheduled.nextIdleSec,
          reason: "speak_sent",
        });
      }
      return;
    }

    if (autonomous && this.host.isGroupConversation()) {
      const previousRuntime = this.host.getCharacterRuntime(scheduled.speaker);
      this.host.setCharacterRuntime(scheduled.speaker, {
        ...previousRuntime,
        characterName: scheduled.speaker,
        idleCheckAt: undefined,
        idleRevision: undefined,
        idleReason: undefined,
        mutedUntil: now + 8000,
        lastSpokeAt: now,
        lastDecisionAt: previousRuntime?.lastDecisionAt ?? now,
        consecutiveSilentCount: 0,
        passiveBackoffCount: 0,
      });
      return;
    }

    if (this.host.isExternallyScheduled()) {
      const previousRuntime = this.host.getCharacterRuntime(scheduled.speaker);
      this.host.setCharacterRuntime(scheduled.speaker, {
        characterName: scheduled.speaker,
        lastSpokeAt: now,
        lastDecisionAt: previousRuntime?.lastDecisionAt ?? now,
        lastMentionedAt: previousRuntime?.lastMentionedAt,
      });
    }
  }
}
