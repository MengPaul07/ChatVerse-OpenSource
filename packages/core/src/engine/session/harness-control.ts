import type { CharacterCard, CharacterState, ChatMessage } from "../../contracts/chat.js";
import { DebugEmitter } from "../../observability/debug/index.js";
import { HumanMessageQueue } from "../input/index.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import { deriveDirectMentionTriggers, HarnessTriggerQueue } from "../events/index.js";
import type { HarnessTriggerInput, TriggerEnqueueResult } from "../events/index.js";
import { SessionRuntimeRunner } from "../runner.js";

type HarnessSessionStatus = "idle" | "running" | "paused" | "stopped";

export class SessionHarnessControl {
  private lastWaitDebug?: { reason: string; waitMs: number };

  constructor(private readonly host: {
    runner: SessionRuntimeRunner;
    inbox: HumanMessageQueue;
    triggerQueue: HarnessTriggerQueue;
    generatingQueue: GeneratingMessageQueue;
    scheduledQueue: ScheduledMessageQueue;
    debug: DebugEmitter;
    getStatus(): HarnessSessionStatus;
    getCharacters(): readonly CharacterCard[];
    getCharacterState(characterName: string): CharacterState | undefined;
    now(): number;
  }) {}

  wake(): void {
    this.host.runner.wake();
  }

  waitForWakeOrTimeout(ms?: number): Promise<void> {
    const shouldWake = () => (
      this.host.inbox.length > 0 ||
      this.host.getStatus() !== "running" ||
      this.hasReadyTrigger()
    );
    return ms === undefined
      ? this.host.runner.waitUntilWoken(shouldWake)
      : this.host.runner.wait(ms, shouldWake);
  }

  enqueueTrigger(trigger: HarnessTriggerInput): TriggerEnqueueResult {
    if (this.host.getCharacterState(trigger.target)?.availability === "unavailable") {
      this.host.debug.emit({
        type: "harness.trigger_skipped",
        target: trigger.target,
        triggerType: trigger.type,
        reason: "target unavailable",
      });
      return "target_busy";
    }
    const result = this.host.triggerQueue.enqueue(
      { ...trigger, enqueuedAt: this.host.now() },
      (target) => (
        this.host.generatingQueue.hasSpeaker(target) ||
        this.host.scheduledQueue.all.some((message) => message.speaker === target)
      ),
    );
    if (result === "enqueued") {
      this.host.debug.emit({
        type: "harness.trigger_enqueued",
        triggerType: trigger.type,
        target: trigger.target,
        source: trigger.source,
        priority: trigger.priority,
      });
      this.wake();
    }
    return result;
  }

  dispatchDirectMentionTriggers(message: ChatMessage): void {
    for (const trigger of deriveDirectMentionTriggers(message, this.host.getCharacters())) {
      this.enqueueTrigger(trigger);
    }
  }

  shouldEmitWaitDebug(wait: { waitMs: number; reason: string }): boolean {
    const last = this.lastWaitDebug;
    const enteredNearDueWindow = Boolean(
      last &&
      last.reason === wait.reason &&
      last.waitMs > 1_000 &&
      wait.waitMs <= 1_000,
    );
    const shouldEmit =
      !last ||
      last.reason !== wait.reason ||
      Math.abs(last.waitMs - wait.waitMs) > 10_000 ||
      enteredNearDueWindow;
    if (shouldEmit) this.lastWaitDebug = wait;
    return shouldEmit;
  }

  hasReadyTrigger(): boolean {
    if (this.host.generatingQueue.length > 0) return false;
    return this.host.triggerQueue.all.some((candidate) => (
      this.host.getCharacterState(candidate.target)?.availability !== "unavailable" &&
      !this.host.generatingQueue.hasSpeaker(candidate.target) &&
      !this.host.scheduledQueue.all.some((message) => message.speaker === candidate.target)
    ));
  }
}
