import type { CharacterCard, CharacterState, ChatMessage } from "../../contracts/chat.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { HarnessTriggerInput } from "../events/index.js";
import { HarnessTriggerQueue } from "../events/index.js";
import { GroupIdleRuntime } from "./group-idle-runtime.js";
import { SessionOutputRuntime } from "./output-runtime.js";

export interface HarnessLoopHost {
  readonly outputRuntime: SessionOutputRuntime;
  readonly scheduledQueue: ScheduledMessageQueue;
  readonly generatingQueue: GeneratingMessageQueue;
  readonly triggerQueue: HarnessTriggerQueue;
  readonly groupIdleRuntime: GroupIdleRuntime;
  now(): number;
  isStopped(): boolean;
  waitIfPaused(): Promise<void>;
  drainInboxToHistory(): ChatMessage[];
  cancelInterruptibleOutputs(reason: string): void;
  dispatchDirectMentionTriggers(message: ChatMessage): void;
  markGroupActivity(speakers: readonly string[], source: "human" | "character"): void;
  getCharacters(): readonly CharacterCard[];
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  autonomousIdleEnabled(): boolean;
  isGroupConversation(): boolean;
  initializeGroupAutonomousIdle(): void;
  computeInitialIdleSec(characterName: string, state?: CharacterState): number;
  hasNewContextForCharacter(characterName: string, since?: number): boolean;
  shouldForceHarnessContinuation(runtime: CharacterRuntimeState | undefined): boolean;
  schedulePassiveIdleBackoff(
    characterName: string,
    runtime: CharacterRuntimeState,
    now: number,
  ): number;
  startHarnessCharacterDecision(trigger: HarnessTriggerInput, scheduleCursor: number): void;
  flushScheduledMessages(): AsyncGenerator<ChatMessage>;
  getHarnessWait(): { waitMs?: number; reason: string };
  waitForWakeOrTimeout(ms?: number): Promise<void>;
  onSchedulerWait(wait: { waitMs: number; reason: string }): void;
}

/** Coordinates the standalone Harness loop without owning Session state. */
export class HarnessLoopRuntime {
  constructor(private readonly host: HarnessLoopHost) {}

  async *run(): AsyncGenerator<ChatMessage> {
    let scheduleCursor = this.host.now();
    this.host.outputRuntime.scheduleCursor = Math.max(
      scheduleCursor,
      ...this.host.scheduledQueue.all.map((message) => message.sendAt),
    );

    // Standalone Group owns autonomous idle. World contexts only run when
    // World explicitly submits a wake trigger.
    if (this.host.autonomousIdleEnabled() && this.host.isGroupConversation()) {
      this.host.initializeGroupAutonomousIdle();
    } else {
      for (const character of this.host.getCharacters()) {
        const state = this.host.getCharacterState(character.name);
        const initialIdle = this.host.autonomousIdleEnabled()
          ? this.host.computeInitialIdleSec(character.name, state)
          : undefined;
        this.host.setCharacterRuntime(character.name, {
          characterName: character.name,
          idleCheckAt: initialIdle !== undefined && state?.availability === "available"
            ? this.host.now() + initialIdle * 1000
            : undefined,
        });
      }
    }

    while (!this.host.isStopped()) {
      await this.host.waitIfPaused();
      if (this.host.isStopped()) break;

      // 1. Human messages cancel interruptible output and enter history first.
      const humanMessages = this.host.drainInboxToHistory();
      if (humanMessages.length > 0) {
        this.host.cancelInterruptibleOutputs("user intervened");
        for (const message of humanMessages) {
          yield message;
          this.host.dispatchDirectMentionTriggers(message);
        }
        this.host.markGroupActivity(
          humanMessages.map((message) => message.characterName),
          "human",
        );
        continue;
      }

      // 2. Due scheduled output always commits before another decision.
      const flush = this.host.flushScheduledMessages();
      let result = await flush.next();
      let sentCount = 0;
      while (!result.done) {
        const message = result.value as ChatMessage;
        yield message;
        sentCount++;
        this.host.dispatchDirectMentionTriggers(message);
        result = await flush.next();
      }
      if (sentCount > 0) continue;

      // 3. Explicit triggers have priority over passive idle opportunities.
      const now = this.host.now();
      if (this.host.triggerQueue.length > 0 && this.host.generatingQueue.length === 0) {
        const trigger = this.host.triggerQueue.takeNext((candidate) => (
          this.host.getCharacterState(candidate.target)?.availability !== "unavailable" &&
          !this.host.generatingQueue.hasSpeaker(candidate.target) &&
          !this.host.scheduledQueue.all.some((message) => message.speaker === candidate.target)
        ));
        if (trigger) {
          yield* this.host.flushScheduledMessages();
          scheduleCursor = Math.max(
            this.host.now(),
            ...this.host.scheduledQueue.all.map((message) => message.sendAt),
          );
          this.host.startHarnessCharacterDecision(
            trigger,
            Math.max(scheduleCursor, this.host.outputRuntime.scheduleCursor),
          );
          continue;
        }
      }

      // 4. Autonomous idle belongs only to standalone Harness conversations.
      let earliestIdle: { name: string; overdueMs: number } | null = null;
      if (this.host.autonomousIdleEnabled()) {
        for (const character of this.host.getCharacters()) {
          if (this.host.getCharacterState(character.name)?.availability !== "available") continue;
          const runtime = this.host.getCharacterRuntime(character.name);
          if (runtime?.idleCheckAt && runtime.idleCheckAt <= now) {
            const overdueMs = now - runtime.idleCheckAt;
            if (!earliestIdle || overdueMs > earliestIdle.overdueMs) {
              earliestIdle = { name: character.name, overdueMs };
            }
          }
        }
      }

      if (
        earliestIdle &&
        this.host.generatingQueue.length === 0 &&
        this.host.scheduledQueue.length === 0
      ) {
        const runtime = this.host.getCharacterRuntime(earliestIdle.name);
        if (
          this.host.isGroupConversation() &&
          runtime?.idleRevision !== this.host.groupIdleRuntime.activityRevision
        ) {
          this.host.setCharacterRuntime(earliestIdle.name, {
            ...runtime,
            characterName: earliestIdle.name,
            idleCheckAt: undefined,
            idleRevision: undefined,
            idleReason: undefined,
          });
          continue;
        }
        if (this.host.scheduledQueue.all.some((message) => message.speaker === earliestIdle.name)) {
          if (runtime) {
            this.host.setCharacterRuntime(earliestIdle.name, {
              ...runtime,
              idleCheckAt: now + 30_000,
            });
          }
          continue;
        }

        if (this.host.isGroupConversation()) {
          const idleReason = runtime?.idleReason ?? "response";
          const hasContext = (
            idleReason === "opening" ||
            idleReason === "ambient" ||
            idleReason === "silent_retry" ||
            this.host.hasNewContextForCharacter(earliestIdle.name, runtime?.lastDecisionAt)
          );
          if (!hasContext && !this.host.shouldForceHarnessContinuation(runtime)) {
            this.host.setCharacterRuntime(earliestIdle.name, {
              ...runtime,
              characterName: earliestIdle.name,
              idleCheckAt: undefined,
              idleRevision: undefined,
              idleReason: undefined,
            });
            this.host.groupIdleRuntime.scheduleAmbientOpportunity(
              new Set([earliestIdle.name]),
              now,
            );
            continue;
          }
          this.host.setCharacterRuntime(earliestIdle.name, {
            ...runtime,
            characterName: earliestIdle.name,
            idleCheckAt: undefined,
            idleRevision: undefined,
            idleReason: undefined,
          });
          yield* this.host.flushScheduledMessages();
          scheduleCursor = Math.max(
            this.host.now(),
            ...this.host.scheduledQueue.all.map((message) => message.sendAt),
          );
          this.host.startHarnessCharacterDecision(
            { type: "idle", target: earliestIdle.name, priority: 10 },
            Math.max(scheduleCursor, this.host.outputRuntime.scheduleCursor),
          );
          continue;
        }

        const mustForceContinuation = this.host.shouldForceHarnessContinuation(runtime);
        const canPassiveBackoff = (
          !mustForceContinuation &&
          !this.host.hasNewContextForCharacter(earliestIdle.name, runtime?.lastDecisionAt)
        );
        if (canPassiveBackoff) {
          if (runtime) {
            this.host.schedulePassiveIdleBackoff(earliestIdle.name, runtime, now);
          }
          continue;
        }
        if (runtime) {
          this.host.setCharacterRuntime(earliestIdle.name, {
            ...runtime,
            idleCheckAt: undefined,
            passiveBackoffCount: 0,
          });
        }
        yield* this.host.flushScheduledMessages();
        scheduleCursor = Math.max(
          this.host.now(),
          ...this.host.scheduledQueue.all.map((message) => message.sendAt),
        );
        this.host.startHarnessCharacterDecision(
          { type: "idle", target: earliestIdle.name, priority: 10 },
          Math.max(scheduleCursor, this.host.outputRuntime.scheduleCursor),
        );
        continue;
      }

      // 5. Wait for scheduled output, idle, or an explicit wake.
      const wait = this.host.getHarnessWait();
      if (wait.waitMs !== undefined) {
        this.host.onSchedulerWait({ waitMs: wait.waitMs, reason: wait.reason });
      }
      await this.host.waitForWakeOrTimeout(wait.waitMs);

      // Flush output that became due while waiting before another LLM call.
      if (
        this.host.scheduledQueue.length > 0 &&
        this.host.outputRuntime.nextScheduledDueMs() === 0
      ) {
        const due = this.host.flushScheduledMessages();
        let dueResult = await due.next();
        while (!dueResult.done) {
          const message = dueResult.value as ChatMessage;
          yield message;
          this.host.dispatchDirectMentionTriggers(message);
          dueResult = await due.next();
        }
      }
    }
  }
}
