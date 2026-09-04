import type {
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
  SessionConfig,
  SessionSnapshot,
} from "../../contracts/chat.js";
import type { ChatProvider, ProviderUsageEvent } from "../../contracts/provider.js";
import { ContextBuilder } from "../../context/index.js";
import {
  cloneConversationDigest,
  normalizeCompressionConfig,
} from "../../context/history-compression.js";
import type { ContextCompressionConfig } from "../../contracts/chat.js";
import { DebugEmitter } from "../../observability/debug/index.js";
import type { RuntimeNotification } from "../../runtime/index.js";
import { observeProviderUsage } from "../../observability/provider-usage.js";
import { normalizeMessageStyle, withAbortSignal } from "./helpers.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import { HarnessTriggerQueue } from "../events/index.js";
import type { HarnessTriggerInput } from "../events/index.js";
import { SessionRuntimeRunner } from "../runner.js";
import type { RuntimeHost } from "../../runtime/index.js";
import type { AgentWake } from "../harness/index.js";
import type { HarnessLoopRuntime } from "./harness-loop.js";
import { SessionState } from "../state.js";
import type { WorldSessionBinding } from "../world/session-binding.js";
import { HistoryCompressionRuntime } from "./history-compression-runtime.js";
import type { SessionIdleCooldownInput, SessionIdleRuntime } from "./idle-runtime.js";
import { createSessionRuntimeAssembly } from "./runtime-assembly.js";
import type { GroupIdleRuntime } from "./group-idle-runtime.js";
import type { SessionOutputRuntime } from "./output-runtime.js";
import type { SessionMessageStyleConfig } from "../../contracts/chat.js";

export interface SessionRuntimeFactoryCallbacks {
  now(): number;
  nextId(): string;
  publishProviderUsage(event: ProviderUsageEvent): void;
  currentCharacterState(characterName: string): CharacterState | undefined;
  getCharacterStates(): CharacterState[];
  applyCharacterStatePatch(
    characterName: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  shouldForceHarnessContinuation(runtime: CharacterRuntimeState | undefined): boolean;
  getPacingMultiplier(): number;
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
  wakeHarness(reason?: string): void;
  notify(type: RuntimeNotification["type"], payload: Record<string, unknown>): void;
  isStopped(): boolean;
  hasPendingCharacterOutput(characterName: string): boolean;
  abortCharacterGeneration(characterName: string, reason: string): void;
  rescheduleIdleAfterCancellation(characterName: string, reason: string, now: number): void;
  markGroupActivity(speakers: readonly string[], source: "human" | "character"): void;
  onActorOutputDrained(characterName: string, producedOutput?: boolean): void;
  maybeStartHistoryCompression(): void;
  waitIfPaused(): Promise<void>;
  drainInboxToHistory(): ChatMessage[];
  cancelInterruptibleOutputs(reason: string): void;
  dispatchDirectMentionTriggers(message: ChatMessage): void;
  initializeGroupAutonomousIdle(): void;
  computeInitialIdleSec(characterName: string, state?: CharacterState): number;
  hasNewContextForCharacter(characterName: string, since?: number): boolean;
  schedulePassiveIdleBackoff(characterName: string, runtime: CharacterRuntimeState, now: number): number;
  shouldEmitHarnessWaitDebug(wait: { waitMs: number; reason: string }): boolean;
  waitForWakeOrTimeout(ms?: number): Promise<void>;
  getHarnessWait(): { waitMs?: number; reason: string };
  flushScheduledMessages(): AsyncGenerator<ChatMessage>;
  startHarnessCharacterDecision(trigger: HarnessTriggerInput, scheduleCursor: number): void;
}

export interface SessionRuntimeBundle {
  id: string;
  runner: SessionRuntimeRunner;
  debug: DebugEmitter;
  state: SessionState;
  scheduledQueue: ScheduledMessageQueue;
  generatingQueue: GeneratingMessageQueue;
  contextBuilder: ContextBuilder;
  interventionCommitWindowMs: number;
  pacingMultiplier: number;
  messageStyle: Required<SessionMessageStyleConfig>;
  forceSpeakAfterConsecutiveSilents: boolean;
  isGroupConversation: boolean;
  contextCompression: ContextCompressionConfig;
  historyCompressionRuntime: HistoryCompressionRuntime;
  assembly: {
    groupIdleRuntime: GroupIdleRuntime;
    outputRuntime: SessionOutputRuntime;
    idleRuntime: SessionIdleRuntime;
    actorRuntime: import("./actor-runtime.js").SessionActorRuntime;
    harnessLoopRuntime: HarnessLoopRuntime;
  };
}

export function createSessionRuntimeBundle(
  config: SessionConfig,
  providers: { character: ChatProvider; compression?: ChatProvider },
  runtime: RuntimeHost,
  worldBinding: WorldSessionBinding | undefined,
  initialSnapshot: SessionSnapshot | undefined,
  providerAbortSignal: AbortSignal,
  triggerQueue: HarnessTriggerQueue,
  callbacks: SessionRuntimeFactoryCallbacks,
): SessionRuntimeBundle {
  const id = runtime.idGenerator.next();
  const runner = new SessionRuntimeRunner(runtime);
  const debug = new DebugEmitter(config.debug, id, runtime);
  const scheduledQueue = new ScheduledMessageQueue(runtime);
  const generatingQueue = new GeneratingMessageQueue(runtime);
  const state = new SessionState({
    characters: config.characters,
    initialMessages: config.initialMessages,
    initialActions: initialSnapshot?.actions,
    scene: config.scene,
    now: callbacks.now,
  });
  const observedCompressionProvider = observeProviderUsage(
    providers.compression ?? providers.character,
    (observation) => {
      callbacks.publishProviderUsage({ providerRole: "history_compression", ...observation });
      debug.emit({
        type: "provider.usage",
        providerRole: "history_compression",
        operation: observation.operation,
        requestContext: observation.requestContext,
        usage: observation.usage,
      });
    },
  );
  const observedCharacterProvider = observeProviderUsage(providers.character, (observation) => {
    callbacks.publishProviderUsage({ providerRole: "character", ...observation });
    debug.emit({
      type: "provider.usage",
      providerRole: "character",
      operation: observation.operation,
      requestContext: observation.requestContext,
      usage: observation.usage,
    });
  });
  const abortableCompressionProvider = withAbortSignal(observedCompressionProvider, providerAbortSignal);
  const abortableCharacterProvider = withAbortSignal(observedCharacterProvider, providerAbortSignal);
  const interventionCommitWindowMs = Math.max(0, config.interventionCommitWindowMs ?? 5000);
  const pacingMultiplier = Math.min(20, Math.max(0, config.pacingMultiplier ?? 1));
  const messageStyle = normalizeMessageStyle(config.messageStyle);
  const forceSpeakAfterConsecutiveSilents = config.forceSpeakAfterConsecutiveSilents ?? true;
  const isGroupConversation = config.conversationMode === "group";
  const contextCompression = normalizeCompressionConfig(config.contextCompression);
  const autonomousIdleEnabled = () => worldBinding?.actorScheduling !== "external_wake";
  const externallyScheduled = () => worldBinding?.actorScheduling === "external_wake";
  const historyCompressionRuntime = new HistoryCompressionRuntime({
    config: contextCompression,
    provider: abortableCompressionProvider,
    contextId: worldBinding?.contextId,
    getMessages: () => state.messages,
    getDigest: () => state.conversationDigest,
    setDigest: (digest) => {
      state.conversationDigest = digest;
    },
    now: callbacks.now,
    isStopped: callbacks.isStopped,
    handleProviderError: (error) => worldBinding?.onProviderError?.(error) ?? false,
    onStarted: (input) => {
      debug.emit({
        type: "context.compression_started",
        sourceTokens: input.sourceTokens,
        messageCount: input.messageCount,
        throughMessageId: input.throughMessageId,
      });
      callbacks.notify("context.compression_started", input);
    },
    onCompleted: (input) => {
      debug.emit({ type: "context.compression_completed", ...input });
      callbacks.notify("context.compression_completed", input);
    },
    onFailed: (input) => {
      debug.emit({ type: "context.compression_failed", ...input });
      callbacks.notify("context.compression_failed", input);
    },
  });
  if (initialSnapshot?.conversationDigest) {
    state.conversationDigest = cloneConversationDigest(initialSnapshot.conversationDigest);
  }
  for (const characterState of initialSnapshot?.characterStates ?? []) {
    if (state.characterStates.has(characterState.characterName)) {
      state.characterStates.set(characterState.characterName, { ...characterState });
    }
  }
  for (const pending of initialSnapshot?.scheduledMessages ?? []) {
    const restored = scheduledQueue.schedule({
      id: pending.id,
      now: pending.createdAt,
      speaker: pending.speaker,
      message: pending.message,
      outputKind: pending.outputKind,
      contextTransition: pending.contextTransition,
      sendAt: pending.sendAt,
      reason: pending.reason,
      statePatch: pending.statePatch,
    });
    restored.nextIdleSec = autonomousIdleEnabled() ? pending.nextIdleSec : undefined;
  }

  const contextBuilder = new ContextBuilder({
    actorPromptMode: worldBinding ? "world" : "group",
    conversationMode: config.conversationMode,
    worldBook: config.worldBook,
    scene: {
      groupName: state.scene.groupName,
      topic: state.scene.topic,
      atmosphere: state.scene.atmosphere,
      state: state.scene.state,
      rules: state.scene.rules ? [...state.scene.rules] : undefined,
    },
    characters: config.characters,
    humans: config.humans ?? [],
    relations: config.relations,
    getCharacterStates: callbacks.getCharacterStates,
    getConversationDigest: () => state.conversationDigest,
    getActorMemory: (characterName, messages) => {
      const actorId = worldBinding?.actorIdForCharacter(characterName);
      return actorId ? worldBinding?.recallActorMemory(actorId, messages) : undefined;
    },
    getActorWorldBackground: (characterName) => {
      const actorId = worldBinding?.actorIdForCharacter(characterName);
      return actorId ? worldBinding?.readActorBackground(actorId) : undefined;
    },
    getCurrentWorldScene: () => worldBinding?.readCurrentScene(),
    getWorldTimeline: (characterName) => {
      const actorId = worldBinding?.actorIdForCharacter(characterName);
      return actorId ? worldBinding?.getWorldTimelineBlock?.(actorId) : undefined;
    },
    projectCharacterHistory: (characterName, messages, actions) => {
      const actorId = worldBinding?.actorIdForCharacter(characterName);
      return actorId
        ? worldBinding!.projectActorHistory(actorId, messages, actions)
        : { messages, actions, includeDigest: true };
    },
  });
  const assembly = createSessionRuntimeAssembly({
    contextBuilder,
    state,
    debug,
    scheduledQueue,
    generatingQueue,
    triggerQueue,
    characterProvider: abortableCharacterProvider,
    worldBinding,
    messageStyle,
    interventionCommitWindowMs,
    isGroupConversation,
    autonomousIdleEnabled,
    externallyScheduled,
    getPacingMultiplier: callbacks.getPacingMultiplier,
    shouldForceSpeakAfterConsecutiveSilents: () => forceSpeakAfterConsecutiveSilents,
    getCharacterState: callbacks.currentCharacterState,
    getCharacterRuntime: callbacks.getCharacterRuntime,
    setCharacterRuntime: callbacks.setCharacterRuntime,
    applyCharacterStatePatch: callbacks.applyCharacterStatePatch,
    getMessages: () => state.messages,
    getActions: () => state.actions,
    buildHarnessCharacter: (characterName) => contextBuilder.buildHarnessCharacter(characterName, state.messages, state.actions),
    shouldForceHarnessContinuation: callbacks.shouldForceHarnessContinuation,
    computeIdleCooldownSec: callbacks.computeIdleCooldownSec,
    computeTypingDelaySec: (message, hesitationSec) => callbacks.computeTypingDelaySec(message, hesitationSec),
    computeActionDelaySec: (action, hesitationSec) => callbacks.computeActionDelaySec(action, hesitationSec),
    setIdleAfterDecision: callbacks.setIdleAfterDecision,
    applyWakeFromParsed: callbacks.applyWakeFromParsed,
    validateFinalMessage: callbacks.validateFinalMessage,
    validateFinalAction: callbacks.validateFinalAction,
    now: callbacks.now,
    nextId: callbacks.nextId,
    isStopped: callbacks.isStopped,
    wakeHarness: callbacks.wakeHarness,
    notify: callbacks.notify,
    hasPendingCharacterOutput: callbacks.hasPendingCharacterOutput,
    abortCharacterGeneration: callbacks.abortCharacterGeneration,
    rescheduleIdleAfterCancellation: callbacks.rescheduleIdleAfterCancellation,
    markGroupActivity: callbacks.markGroupActivity,
    onActorOutputDrained: callbacks.onActorOutputDrained,
    onMessageCommitted: callbacks.maybeStartHistoryCompression,
    waitIfPaused: callbacks.waitIfPaused,
    drainInboxToHistory: callbacks.drainInboxToHistory,
    cancelInterruptibleOutputs: callbacks.cancelInterruptibleOutputs,
    dispatchDirectMentionTriggers: callbacks.dispatchDirectMentionTriggers,
    initializeGroupAutonomousIdle: callbacks.initializeGroupAutonomousIdle,
    computeInitialIdleSec: callbacks.computeInitialIdleSec,
    hasNewContextForCharacter: callbacks.hasNewContextForCharacter,
    schedulePassiveIdleBackoff: callbacks.schedulePassiveIdleBackoff,
    getHarnessWait: callbacks.getHarnessWait,
    flushScheduledMessages: callbacks.flushScheduledMessages,
    startHarnessCharacterDecision: callbacks.startHarnessCharacterDecision,
    shouldEmitHarnessWaitDebug: callbacks.shouldEmitHarnessWaitDebug,
    waitForWakeOrTimeout: callbacks.waitForWakeOrTimeout,
  });

  return {
    id,
    runner,
    debug,
    state,
    scheduledQueue,
    generatingQueue,
    contextBuilder,
    interventionCommitWindowMs,
    pacingMultiplier,
    messageStyle,
    forceSpeakAfterConsecutiveSilents,
    isGroupConversation,
    contextCompression,
    historyCompressionRuntime,
    assembly,
  };
}
