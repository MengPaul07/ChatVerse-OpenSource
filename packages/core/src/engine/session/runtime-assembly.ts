import type {
  ActorAction,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
  SessionMessageStyleConfig,
} from "../../contracts/chat.js";
import type { ChatProvider } from "../../contracts/provider.js";
import { DebugEmitter } from "../../observability/debug/index.js";
import type { RuntimeNotification } from "../../runtime/index.js";
import type { HarnessTriggerInput, HarnessTriggerQueue } from "../events/index.js";
import { HarnessDriver } from "../harness/index.js";
import type { AgentWake } from "../harness/index.js";
import { HarnessLoopRuntime } from "./harness-loop.js";
import type { HarnessLoopHost } from "./harness-loop.js";
import { GroupIdleRuntime } from "./group-idle-runtime.js";
import { SessionIdleRuntime } from "./idle-runtime.js";
import type { SessionIdleCooldownInput } from "./idle-runtime.js";
import { SessionActorRuntime } from "./actor-runtime.js";
import { SessionOutputRuntime } from "./output-runtime.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { WorldSessionBinding } from "../world/session-binding.js";
import { WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT } from "../../context/prompts.js";
import { ContextBuilder } from "../../context/index.js";
import { SessionState } from "../state.js";

/** State-free assembly boundary for the Session's extracted runtimes. */
export interface SessionRuntimeAssemblyHost {
  readonly contextBuilder: ContextBuilder;
  readonly state: SessionState;
  readonly debug: DebugEmitter;
  readonly scheduledQueue: ScheduledMessageQueue;
  readonly generatingQueue: GeneratingMessageQueue;
  readonly characterProvider: ChatProvider;
  readonly worldBinding?: WorldSessionBinding;
  readonly triggerQueue: HarnessTriggerQueue;
  readonly messageStyle: Required<SessionMessageStyleConfig>;
  readonly interventionCommitWindowMs: number;
  readonly isGroupConversation: boolean;

  autonomousIdleEnabled(): boolean;
  externallyScheduled(): boolean;
  getPacingMultiplier(): number;
  shouldForceSpeakAfterConsecutiveSilents(): boolean;
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  applyCharacterStatePatch(
    characterName: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void;
  getMessages(): readonly ChatMessage[];
  getActions(): readonly ActorAction[];
  buildHarnessCharacter(characterName: string): { systemPrompt: string; userPrompt: string };
  shouldForceHarnessContinuation(runtime: CharacterRuntimeState | undefined): boolean;
  computeIdleCooldownSec(args: SessionIdleCooldownInput): number;
  computeTypingDelaySec(message: string, hesitationSec?: number): number;
  computeActionDelaySec(action: string, hesitationSec?: number): number;
  setIdleAfterDecision(
    trigger: HarnessTriggerInput,
    characterName: string,
    decision: "speak" | "silent",
    isClosing: boolean,
    modelHintSec?: number,
  ): void;
  applyWakeFromParsed(wake: AgentWake | undefined, source: string): void;
  validateFinalMessage(message: string): { ok: true } | { ok: false; reason: string };
  validateFinalAction(action: string): boolean;
  now(): number;
  nextId(): string;
  isStopped(): boolean;
  wakeHarness(reason?: string): void;
  notify(type: RuntimeNotification["type"], payload: Record<string, unknown>): void;
  hasPendingCharacterOutput(characterName: string): boolean;
  abortCharacterGeneration(characterName: string, reason: string): void;
  rescheduleIdleAfterCancellation(characterName: string, reason: string, now: number): void;
  markGroupActivity(speakers: readonly string[], source: "human" | "character"): void;
  onActorOutputDrained(characterName: string, producedOutput?: boolean): void;
  onMessageCommitted(): void;

  waitIfPaused(): Promise<void>;
  drainInboxToHistory(): ChatMessage[];
  cancelInterruptibleOutputs(reason: string): void;
  dispatchDirectMentionTriggers(message: ChatMessage): void;
  initializeGroupAutonomousIdle(): void;
  computeInitialIdleSec(characterName: string, state?: CharacterState): number;
  hasNewContextForCharacter(characterName: string, since?: number): boolean;
  schedulePassiveIdleBackoff(
    characterName: string,
    runtime: CharacterRuntimeState,
    now: number,
  ): number;
  shouldEmitHarnessWaitDebug(wait: { waitMs: number; reason: string }): boolean;
  waitForWakeOrTimeout(ms?: number): Promise<void>;
  getHarnessWait(): { waitMs?: number; reason: string };
  flushScheduledMessages(): AsyncGenerator<ChatMessage>;
  startHarnessCharacterDecision(trigger: HarnessTriggerInput, scheduleCursor: number): void;
}

export interface SessionRuntimeAssembly {
  readonly groupIdleRuntime: GroupIdleRuntime;
  readonly outputRuntime: SessionOutputRuntime;
  readonly idleRuntime: SessionIdleRuntime;
  readonly actorRuntime: SessionActorRuntime;
  readonly harnessLoopRuntime: HarnessLoopRuntime;
}

/**
 * Compose the Session runtimes without owning any Session state.
 *
 * Keeping this wiring in one adapter makes the ownership boundary explicit:
 * callbacks enter Session for mutations, while each runtime keeps its own
 * scheduling or provider concerns.
 */
export function createSessionRuntimeAssembly(
  host: SessionRuntimeAssemblyHost,
): SessionRuntimeAssembly {
  const groupIdleRuntime = new GroupIdleRuntime({
    getCharacters: () => host.contextBuilder.input.characters,
    getCharacterState: (characterName) => host.getCharacterState(characterName),
    getCharacterRuntime: (characterName) => host.getCharacterRuntime(characterName),
    setCharacterRuntime: (characterName, runtimeState) => {
      host.setCharacterRuntime(characterName, runtimeState);
    },
    hasGeneratingSpeaker: (characterName) => host.generatingQueue.hasSpeaker(characterName),
    hasScheduledSpeaker: (characterName) => host.scheduledQueue.all.some((message) => message.speaker === characterName),
    getPacingMultiplier: () => host.getPacingMultiplier(),
    now: () => host.now(),
    shouldForceSpeakAfterConsecutiveSilents: () => host.shouldForceSpeakAfterConsecutiveSilents(),
    isEnabled: () => host.autonomousIdleEnabled() && host.isGroupConversation,
    onIdleScheduled: (input) => {
      host.debug.emit({
        type: "harness.idle_scheduled",
        characterName: input.characterName,
        nextIdleSec: input.nextIdleSec,
        reason: input.reason,
        detail: input.detail,
      });
    },
    wake: (reason) => host.wakeHarness(reason),
  });

  const outputRuntime = new SessionOutputRuntime({
    scheduledQueue: host.scheduledQueue,
    generatingQueue: host.generatingQueue,
    now: () => host.now(),
    nextId: () => host.nextId(),
    getCharacterState: (characterName) => host.getCharacterState(characterName),
    getCharacterRuntime: (characterName) => host.getCharacterRuntime(characterName),
    setCharacterRuntime: (characterName, runtimeState) => {
      host.setCharacterRuntime(characterName, runtimeState);
    },
    applyCharacterStatePatch: (characterName, patch, source) => {
      host.applyCharacterStatePatch(characterName, patch, source);
    },
    isAutonomousIdleEnabled: () => host.autonomousIdleEnabled(),
    isGroupConversation: () => host.isGroupConversation,
    isExternallyScheduled: () => host.externallyScheduled(),
    interventionCommitWindowMs: () => host.interventionCommitWindowMs,
    hasPendingCharacterOutput: (characterName) => host.hasPendingCharacterOutput(characterName),
    abortCharacterGeneration: (characterName, reason) => {
      actorRuntime.abort(characterName, reason);
    },
    rescheduleIdleAfterCancellation: (characterName, reason, now) => {
      host.rescheduleIdleAfterCancellation(characterName, reason, now);
    },
    onScheduledDropped: (scheduled, reason, notify) => {
      host.debug.emit({
        type: "queue.message_dropped",
        messageId: scheduled.id,
        speaker: scheduled.speaker,
        reason,
      });
      if (notify) {
        host.notify("queue.message_cancelled", {
          messageId: scheduled.id,
          speaker: scheduled.speaker,
          reason,
          phase: "scheduled",
        });
      }
    },
    onGeneratingDropped: (generating, reason) => {
      host.debug.emit({
        type: "queue.message_dropped",
        messageId: generating.id,
        speaker: generating.speaker,
        reason,
      });
      host.notify("queue.message_cancelled", {
        messageId: generating.id,
        speaker: generating.speaker,
        reason,
        phase: "generating",
      });
    },
    onIdleScheduled: (input) => {
      host.debug.emit({
        type: "harness.idle_scheduled",
        characterName: input.characterName,
        nextIdleSec: input.nextIdleSec,
        reason: input.reason,
        detail: input.detail,
      });
    },
    commitAction: (action, scheduled) => {
      host.state.actions.push(action);
      host.debug.emit({
        type: "queue.message_sent",
        messageId: scheduled.id,
        speaker: scheduled.speaker,
        outputKind: "action",
      });
      host.notify("action.committed", {
        actionId: action.id,
        scheduledMessageId: scheduled.id,
        characterName: action.characterName,
      });
      host.worldBinding?.commitActorAction({ ...action });
    },
    commitMessage: (message, scheduled) => {
      host.state.messages.push(message);
      host.debug.emit({
        type: "queue.message_sent",
        messageId: scheduled.id,
        speaker: scheduled.speaker,
        outputKind: "message",
      });
      host.notify("message.committed", {
        messageId: message.id,
        scheduledMessageId: scheduled.id,
        characterName: message.characterName,
        source: message.source,
      });
      host.onMessageCommitted();
    },
    onActorOutputDrained: (characterName, producedOutput) => {
      host.onActorOutputDrained(characterName, producedOutput);
    },
    markGroupActivity: (speakers) => {
      host.markGroupActivity(speakers, "character");
    },
  });

  const idleRuntime = new SessionIdleRuntime({
    outputRuntime,
    scheduledQueue: host.scheduledQueue,
    generatingQueue: host.generatingQueue,
    groupIdleRuntime,
    getCharacters: () => host.contextBuilder.input.characters,
    getCharacterState: (characterName) => host.getCharacterState(characterName),
    getCharacterRuntime: (characterName) => host.getCharacterRuntime(characterName),
    setCharacterRuntime: (characterName, runtimeState) => {
      host.setCharacterRuntime(characterName, runtimeState);
    },
    getMessages: () => host.getMessages(),
    getActions: () => host.getActions(),
    getPacingMultiplier: () => host.getPacingMultiplier(),
    isAutonomousIdleEnabled: () => host.autonomousIdleEnabled(),
    isGroupConversation: () => host.isGroupConversation,
    isWorldSession: () => Boolean(host.worldBinding),
    isExternallyScheduled: () => host.externallyScheduled(),
    shouldForceSpeakAfterConsecutiveSilents: () => host.shouldForceSpeakAfterConsecutiveSilents(),
    now: () => host.now(),
    emitDebug: (input) => host.debug.emit(input),
    wake: (reason) => host.wakeHarness(reason),
  });

  const harness = new HarnessDriver(
    host.characterProvider,
    host.worldBinding && !host.isGroupConversation ? WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT : undefined,
  );
  const actorRuntime = new SessionActorRuntime({
    harness,
    generatingQueue: host.generatingQueue,
    scheduledQueue: host.scheduledQueue,
    outputRuntime,
    worldBinding: host.worldBinding,
    messageStyle: host.messageStyle,
    debug: host.debug,
    getCharacters: () => host.contextBuilder.input.characters,
    getCharacterState: (characterName) => host.getCharacterState(characterName),
    getCharacterRuntime: (characterName) => host.getCharacterRuntime(characterName),
    setCharacterRuntime: (characterName, runtimeState) => {
      host.setCharacterRuntime(characterName, runtimeState);
    },
    getMessages: () => host.getMessages(),
    getActions: () => host.getActions(),
    buildHarnessCharacter: (characterName) => host.buildHarnessCharacter(characterName),
    isGroupConversation: () => host.isGroupConversation,
    isAutonomousIdleEnabled: () => host.autonomousIdleEnabled(),
    shouldForceHarnessContinuation: (runtimeState) => host.shouldForceHarnessContinuation(runtimeState),
    computeIdleCooldownSec: (args) => host.computeIdleCooldownSec(args),
    computeTypingDelaySec: (message, hesitationSec) => host.computeTypingDelaySec(message, hesitationSec),
    computeActionDelaySec: (action, hesitationSec) => host.computeActionDelaySec(action, hesitationSec),
    setIdleAfterDecision: (trigger, characterName, decision, isClosing, modelHintSec) => {
      host.setIdleAfterDecision(trigger, characterName, decision, isClosing, modelHintSec);
    },
    applyCharacterStatePatch: (characterName, patch, source) => {
      host.applyCharacterStatePatch(characterName, patch, source);
    },
    applyWakeFromParsed: (wake, source) => host.applyWakeFromParsed(wake, source),
    validateFinalMessage: (message) => host.validateFinalMessage(message),
    validateFinalAction: (action) => host.validateFinalAction(action),
    now: () => host.now(),
    nextId: () => host.nextId(),
    isStopped: () => host.isStopped(),
    wake: (reason) => host.wakeHarness(reason),
    notify: (type, payload) => host.notify(type, payload),
  });

  const loopHost: HarnessLoopHost = {
    outputRuntime,
    scheduledQueue: host.scheduledQueue,
    generatingQueue: host.generatingQueue,
    triggerQueue: host.triggerQueue,
    groupIdleRuntime,
    now: () => host.now(),
    isStopped: () => host.isStopped(),
    waitIfPaused: () => host.waitIfPaused(),
    drainInboxToHistory: () => host.drainInboxToHistory(),
    cancelInterruptibleOutputs: (reason) => host.cancelInterruptibleOutputs(reason),
    dispatchDirectMentionTriggers: (message) => host.dispatchDirectMentionTriggers(message),
    markGroupActivity: (speakers, source) => host.markGroupActivity(speakers, source),
    getCharacters: () => host.contextBuilder.input.characters,
    getCharacterState: (characterName) => host.getCharacterState(characterName),
    getCharacterRuntime: (characterName) => host.getCharacterRuntime(characterName),
    setCharacterRuntime: (characterName, runtimeState) => {
      host.setCharacterRuntime(characterName, runtimeState);
    },
    autonomousIdleEnabled: () => host.autonomousIdleEnabled(),
    isGroupConversation: () => host.isGroupConversation,
    initializeGroupAutonomousIdle: () => host.initializeGroupAutonomousIdle(),
    computeInitialIdleSec: (characterName, state) => host.computeInitialIdleSec(characterName, state),
    hasNewContextForCharacter: (characterName, since) => host.hasNewContextForCharacter(characterName, since),
    shouldForceHarnessContinuation: (runtimeState) => host.shouldForceHarnessContinuation(runtimeState),
    schedulePassiveIdleBackoff: (characterName, runtimeState, now) => (
      host.schedulePassiveIdleBackoff(characterName, runtimeState, now)
    ),
    startHarnessCharacterDecision: (trigger, scheduleCursor) => (
      host.startHarnessCharacterDecision(trigger, scheduleCursor)
    ),
    flushScheduledMessages: () => host.flushScheduledMessages(),
    getHarnessWait: () => host.getHarnessWait(),
    waitForWakeOrTimeout: (ms) => host.waitForWakeOrTimeout(ms),
    onSchedulerWait: (wait) => {
      if (host.shouldEmitHarnessWaitDebug(wait)) {
        host.debug.emit({ type: "harness.scheduler_wait", ...wait });
      }
    },
  };

  const harnessLoopRuntime = new HarnessLoopRuntime(loopHost);
  return {
    groupIdleRuntime,
    outputRuntime,
    idleRuntime,
    actorRuntime,
    harnessLoopRuntime,
  };
}
