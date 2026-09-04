import type { ActorAction, CharacterState, CharacterStatePatch, SceneCard, SessionConfig, SessionSnapshot, ChatMessage, Relation } from "../contracts/chat.js";
import type { ChatProvider, ProviderUsageEvent, ProviderUsageEventListener } from "../contracts/provider.js";
import type { ContextBuilder } from "../context/index.js";
import type { ConversationDigest } from "../context/index.js";
import { cloneConversationDigest } from "../context/history-compression.js";
import type { SessionMessageStyleConfig } from "../contracts/chat.js";
import type { CharacterCard } from "../contracts/chat.js";
import { DebugEmitter } from "../observability/debug/index.js";
import type { DebugEvent, DebugEventListener, DebugUnsubscribe } from "../observability/debug/index.js";
import { HumanMessageQueue } from "./input/index.js";
import type { HumanMessageInput, HumanParticipant } from "./input/index.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "./queues/index.js";
import type { CharacterRuntimeState } from "./queues/index.js";
import { HarnessTriggerQueue } from "./events/index.js";
import type { HarnessTriggerInput, TriggerEnqueueResult } from "./events/index.js";
import type { HarnessLoopRuntime } from "./session/harness-loop.js";
import type { SessionRuntimeRunner } from "./runner.js";
import type { RuntimeHost, RuntimeNotification, RuntimeNotificationListener, RuntimeUnsubscribe } from "../runtime/index.js";
import { SessionState } from "./state.js";
import type {
  ActorWakeRequest,
  WorldSessionBinding,
} from "./world/session-binding.js";
import type { HistoryCompressionRuntime } from "./session/history-compression-runtime.js";
import type { SessionIdleRuntime } from "./session/idle-runtime.js";
import type { SessionIdleCooldownInput } from "./session/idle-runtime.js";
import type { SessionActorRuntime } from "./session/actor-runtime.js";
import type { SessionOutputRuntime } from "./session/output-runtime.js";
import type { GroupIdleRuntime } from "./session/group-idle-runtime.js";
import { createSessionRuntimeBundle } from "./session/runtime-factory.js";
import { SessionHarnessControl } from "./session/harness-control.js";
import { SessionLifecycleRuntime } from "./session/lifecycle.js";
import { SessionProviderUsageRuntime } from "./session/provider-usage.js";
import {
  cancelCharacterWork as cancelWorldCharacterWork,
  getCharacterWakeStatus as readWorldCharacterWakeStatus,
  handleWorldActorRuntimeState as applyWorldActorRuntimeState,
  receiveWorldEvent as dispatchWorldEvent,
  requestCharacterWake as enqueueWorldCharacterWake,
  syncWorldRoster as updateWorldRoster,
} from "./session/world-commands.js";
import type { SessionWorldCommandHost } from "./session/world-commands.js";
import {
  computeActionDelaySec as calculateActionDelaySec,
  computeTypingDelaySec as calculateTypingDelaySec,
} from "./session/timing.js";
import {
  assertUniqueParticipantNames,
  clamp,
} from "./session/helpers.js";
import { buildSessionDebugSnapshotFromState } from "./session/debug-state.js";
import type { SessionDebugSnapshot } from "./session/debug-state.js";
import { buildSessionSnapshot } from "./session/snapshot.js";
import { commitSessionAction, commitSessionMessage } from "./session/message-commit.js";

/** Internal Actor runtime for one World Context. */
export type SessionStatus = "idle" | "running" | "paused" | "stopped";

export class Session {
  private readonly id: string;
  private readonly runtime: RuntimeHost;
  private readonly runner: SessionRuntimeRunner;
  private notificationSequence = 0;
  private readonly state: SessionState;
  private _status: SessionStatus = "idle";
  private debug: DebugEmitter;
  private inbox = new HumanMessageQueue();
  private readonly _scheduledQueue: ScheduledMessageQueue;
  private readonly _generatingQueue: GeneratingMessageQueue;
  private _characterRuntime = new Map<string, CharacterRuntimeState>();
  private _contextBuilder: ContextBuilder;
  private _pacingMultiplier: number;
  private readonly _messageStyle: Required<SessionMessageStyleConfig>;
  private readonly _isGroupConversation: boolean;
  private readonly _historyCompressionRuntime: HistoryCompressionRuntime;
  /**
   * Reservation cursor for concurrent World Actor decisions. LLM calls may
   * overlap, but visible outputs still occupy one deterministic typing lane.
   */
  private readonly _outputRuntime: SessionOutputRuntime;
  private readonly _harnessLoopRuntime: HarnessLoopRuntime;
  private readonly _idleRuntime: SessionIdleRuntime;
  private readonly _actorRuntime: SessionActorRuntime;
  /** Group Harness uses this to invalidate stale autonomous opportunities. */
  private readonly _groupIdleRuntime: GroupIdleRuntime;
  private readonly _worldBinding?: WorldSessionBinding;
  private readonly _providerAbort = new AbortController();
  private readonly _providerUsageRuntime = new SessionProviderUsageRuntime();
  private readonly _triggerQueue = new HarnessTriggerQueue();
  private _harnessControl: SessionHarnessControl;
  private readonly _lifecycle: SessionLifecycleRuntime;

  /** 角色运行时状态列表（深拷贝快照） */
  get characterStates(): CharacterState[] {
    return [...this.state.characterStates.keys()]
      .map((name) => this.currentCharacterState(name))
      .filter((state): state is CharacterState => Boolean(state));
  }

  get pacingMultiplier(): number {
    return this._pacingMultiplier;
  }

  /** Update future timing and proportionally retime pending output in place. */
  setPacingMultiplier(value: number, acceleratePending = false): void {
    if (!Number.isFinite(value)) throw new Error("pacingMultiplier must be finite.");
    const previous = this._pacingMultiplier;
    const next = Math.min(20, Math.max(0, value));
    if (next === previous) return;
    this._pacingMultiplier = next;
    const now = this.now();
    if (next === 0) {
      this._scheduledQueue.accelerate(now);
      this.runner.wake();
    } else if (!acceleratePending && previous > 0) {
      this._scheduledQueue.rescaleRemaining(next / previous, now);
      this._outputRuntime.refreshScheduleCursor();
      this.runner.wake();
    }
  }

  /** 查询单个角色状态（深拷贝） */
  getCharacterState(characterName: string): CharacterState | undefined {
    const s = this.currentCharacterState(characterName);
    return s ? { ...s } : undefined;
  }

  private currentCharacterState(characterName: string): CharacterState | undefined {
    const local = this.state.characterStates.get(characterName);
    if (!local) return undefined;
    const actorId = this._worldBinding?.actorIdForCharacter(characterName);
    const shared = actorId ? this._worldBinding?.readActorState(actorId) : undefined;
    if (!shared) return local;
    return {
      ...local,
      availability: shared.availability,
      attention: shared.attention,
      mood: shared.mood,
      intent: shared.intent,
      note: shared.note,
      updatedAt: Math.max(local.updatedAt, shared.updatedAt),
    };
  }

  /** Session 是角色状态的唯一落库来源。校验并应用 patch，发出事件。 */
  applyCharacterStatePatch(
    characterName: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void {
    if (!this.state.characterStates.has(characterName)) return;
    const prev = this.currentCharacterState(characterName)!;

    const next: CharacterState = {
      characterName,
      availability: patch.availability ?? prev.availability,
      attention: patch.attention ?? prev.attention,
      mood: patch.mood !== undefined ? (patch.mood || undefined) : prev.mood,
      intent: patch.intent !== undefined ? (patch.intent || undefined) : prev.intent,
      note: patch.note !== undefined ? (patch.note || undefined) : prev.note,
      updatedAt: this.now(),
      source,
    };

    // 无变化则跳过
    if (
      next.availability === prev.availability &&
      next.attention === prev.attention &&
      next.mood === prev.mood &&
      next.intent === prev.intent &&
      next.note === prev.note
    ) return;

    this.state.characterStates.set(characterName, next);
    const actorId = this._worldBinding?.actorIdForCharacter(characterName);
    if (actorId) {
      this._worldBinding?.applyActorStatePatch(actorId, patch, source);
    }

    this.debug.emit({
      type: "character_state.updated",
      characterName,
      before: { availability: prev.availability, attention: prev.attention, mood: prev.mood, intent: prev.intent, note: prev.note },
      after: { availability: next.availability, attention: next.attention, mood: next.mood, intent: next.intent, note: next.note },
      source,
      reason: patch.reason,
    });
  }

  /** 已产生的消息列表（只读） */
  get messages(): readonly ChatMessage[] {
    return this.state.messages;
  }

  /** Compact older-history projection used by World-level orchestration. */
  get conversationDigest(): ConversationDigest {
    return cloneConversationDigest(this.state.conversationDigest);
  }

  /** Visible character actions are kept separate from chat bubbles. */
  get actions(): readonly ActorAction[] {
    return this.state.actions;
  }

  /** 当前场景快照（深拷贝。*/
  get scene(): Readonly<SceneCard> {
    return {
      groupName: this.state.scene.groupName,
      topic: this.state.scene.topic,
      atmosphere: this.state.scene.atmosphere,
      state: this.state.scene.state,
      rules: this.state.scene.rules ? [...this.state.scene.rules] : undefined,
    } as const;
  }

  /** 会话状。*/
  get status(): SessionStatus {
    return this._status;
  }

  /** 是否已暂。*/
  get paused(): boolean {
    return this._status === "paused";
  }

  /** 是否已停。*/
  get stopped(): boolean {
    return this._status === "stopped";
  }

  /** 后台事件历史。关。debug 时始终为空。*/
  get debugEvents(): readonly DebugEvent[] {
    return this.debug.events;
  }

  /** Subscribe to ordered, observation-only notifications for this session. */
  onRuntimeNotification(listener: RuntimeNotificationListener): RuntimeUnsubscribe {
    return this.runtime.notifications.subscribe((notification) => {
      if (notification.sessionId === this.id) listener(notification);
    });
  }

  private now(): number {
    return this.runtime.clock.now();
  }

  private nextId(): string {
    return this.runtime.idGenerator.next();
  }

  private get autonomousIdleEnabled(): boolean {
    return this._worldBinding?.actorScheduling !== "external_wake";
  }

  private get externallyScheduled(): boolean {
    return this._worldBinding?.actorScheduling === "external_wake";
  }

  private notify(type: RuntimeNotification["type"], payload: Record<string, unknown>): void {
    this.runtime.notifications.publish({
      sessionId: this.id,
      sequence: ++this.notificationSequence,
      occurredAt: this.now(),
      type,
      payload,
    });
  }

  private setStatus(status: SessionStatus): void {
    if (this._status === status) return;
    const previous = this._status;
    this._status = status;
    this.notify("session.status_changed", { previous, status });
  }

  constructor(
    config: SessionConfig,
    providers: {
      character: ChatProvider;
      compression?: ChatProvider;
    },
    runtime: RuntimeHost,
    worldBinding?: WorldSessionBinding,
    initialSnapshot?: SessionSnapshot,
  ) {
    this.runtime = runtime;
    this._worldBinding = worldBinding;
    const bundle = createSessionRuntimeBundle(
      config,
      providers,
      runtime,
      worldBinding,
      initialSnapshot,
      this._providerAbort.signal,
      this._triggerQueue,
      {
        now: () => this.now(),
        nextId: () => runtime.idGenerator.next(),
        publishProviderUsage: (event) => this.publishProviderUsage(event),
        currentCharacterState: (characterName) => this.currentCharacterState(characterName),
        getCharacterStates: () => this.characterStates,
        applyCharacterStatePatch: (characterName, patch, source) => this.applyCharacterStatePatch(characterName, patch, source),
        getCharacterRuntime: (characterName) => this._characterRuntime.get(characterName),
        setCharacterRuntime: (characterName, runtimeState) => this._characterRuntime.set(characterName, runtimeState),
        shouldForceHarnessContinuation: (runtimeState) => this.shouldForceHarnessContinuation(runtimeState),
        getPacingMultiplier: () => this._pacingMultiplier,
        computeIdleCooldownSec: (args) => this.computeIdleCooldownSec(args),
        computeTypingDelaySec: (message, hesitationSec) => this.computeTypingDelaySec(message, hesitationSec),
        computeActionDelaySec: (action, hesitationSec) => this.computeActionDelaySec(action, hesitationSec),
        setIdleAfterDecision: (trigger, characterName, decision, isClosing, modelHintSec) => this.setIdleAfterDecision(trigger, characterName, decision, isClosing, modelHintSec),
        applyWakeFromParsed: (wake, source) => this.applyWakeFromParsed(wake, source),
        validateFinalMessage: (message) => this.validateFinalMessage(message),
        validateFinalAction: (action) => this.validateFinalAction(action),
        isStopped: () => this._status === "stopped",
        wakeHarness: (reason) => this.wakeHarness(reason),
        notify: (type, payload) => this.notify(type, payload),
        hasPendingCharacterOutput: (characterName) => this.hasPendingCharacterOutput(characterName),
        abortCharacterGeneration: (characterName, reason) => this._actorRuntime.abort(characterName, reason),
        rescheduleIdleAfterCancellation: (characterName, reason, now) => this.rescheduleIdleAfterCancellation(characterName, reason, now),
        markGroupActivity: (speakers, source) => this.markGroupActivity(speakers, source),
        onActorOutputDrained: (characterName, producedOutput) => this._worldBinding?.onActorOutputDrained(characterName, producedOutput),
        maybeStartHistoryCompression: () => this.maybeStartHistoryCompression(),
        waitIfPaused: () => this.waitIfPaused(),
        drainInboxToHistory: () => this.drainInboxToHistory(),
        cancelInterruptibleOutputs: (reason) => this.cancelInterruptibleOutputs(reason),
        dispatchDirectMentionTriggers: (message) => this.dispatchDirectMentionTriggers(message),
        initializeGroupAutonomousIdle: () => this.initializeGroupAutonomousIdle(),
        computeInitialIdleSec: (characterName, state) => this.computeInitialIdleSec(characterName, state),
        hasNewContextForCharacter: (characterName, since) => this.hasNewContextForCharacter(characterName, since),
        schedulePassiveIdleBackoff: (characterName, runtimeState, now) => this.schedulePassiveIdleBackoff(characterName, runtimeState, now),
        shouldEmitHarnessWaitDebug: (wait) => this.shouldEmitHarnessWaitDebug(wait),
        waitForWakeOrTimeout: (ms) => this.waitForWakeOrTimeout(ms),
        getHarnessWait: () => this.getHarnessWait(),
        flushScheduledMessages: () => this.flushScheduledMessages(),
        startHarnessCharacterDecision: (trigger, scheduleCursor) => this.startHarnessCharacterDecision(trigger, scheduleCursor),
      },
    );
    this.id = bundle.id;
    this.runner = bundle.runner;
    this.debug = bundle.debug;
    this.state = bundle.state;
    this._scheduledQueue = bundle.scheduledQueue;
    this._generatingQueue = bundle.generatingQueue;
    this._contextBuilder = bundle.contextBuilder;
    this._pacingMultiplier = bundle.pacingMultiplier;
    this._messageStyle = bundle.messageStyle;
    this._isGroupConversation = bundle.isGroupConversation;
    this._historyCompressionRuntime = bundle.historyCompressionRuntime;
    this._groupIdleRuntime = bundle.assembly.groupIdleRuntime;
    this._outputRuntime = bundle.assembly.outputRuntime;
    this._idleRuntime = bundle.assembly.idleRuntime;
    this._actorRuntime = bundle.assembly.actorRuntime;
    this._harnessLoopRuntime = bundle.assembly.harnessLoopRuntime;
    this._harnessControl = new SessionHarnessControl({
      runner: this.runner,
      inbox: this.inbox,
      triggerQueue: this._triggerQueue,
      generatingQueue: this._generatingQueue,
      scheduledQueue: this._scheduledQueue,
      debug: this.debug,
      getStatus: () => this._status,
      getCharacters: () => this._contextBuilder.input.characters,
      getCharacterState: (characterName) => this.currentCharacterState(characterName),
      now: () => this.now(),
    });
    this._lifecycle = new SessionLifecycleRuntime({
      runner: this.runner,
      providerAbort: this._providerAbort,
      actorRuntime: this._actorRuntime,
      generatingQueue: this._generatingQueue,
      scheduledQueue: this._scheduledQueue,
      getStatus: () => this._status,
      setStatus: (status) => this.setStatus(status),
    });
  }
  private get worldCommandHost(): SessionWorldCommandHost {
    return {
      contextBuilder: this._contextBuilder,
      state: this.state,
      debug: this.debug,
      triggerQueue: this._triggerQueue,
      generatingQueue: this._generatingQueue,
      scheduledQueue: this._scheduledQueue,
      characterRuntime: this._characterRuntime,
      actorRuntime: this._actorRuntime,
      outputRuntime: this._outputRuntime,
      worldBinding: this._worldBinding,
      isGroupConversation: this._isGroupConversation,
      autonomousIdleEnabled: () => this.autonomousIdleEnabled,
      getCharacterState: (characterName) => this.currentCharacterState(characterName),
      getCharacterRuntime: (characterName) => this._characterRuntime.get(characterName),
      setCharacterRuntime: (characterName, runtimeState) => {
        this._characterRuntime.set(characterName, runtimeState);
      },
      enqueueTrigger: (trigger) => this.enqueueTrigger(trigger),
      handleWorldActorRuntimeState: (characterName) => this.handleWorldActorRuntimeState(characterName),
      cancelCharacterWork: (characterName, reason) => this.cancelCharacterWork(characterName, reason),
      computeInitialIdleSec: (characterName, state) => this.computeInitialIdleSec(characterName, state),
      now: () => this.now(),
      wakeHarness: (reason) => this.wakeHarness(reason),
      notify: (type, payload) => this.notify(type, payload),
      hasPendingCharacterOutput: (characterName) => this.hasPendingCharacterOutput(characterName),
    };
  }
  /** Start the Actor runtime and yield committed chat messages. */
  async *start(): AsyncIterable<ChatMessage> {
    if ((this._status as SessionStatus) === "stopped") return;
    this.setStatus("running");
    return yield* this.harnessLoop();
  }
  private wakeHarness(_reason?: string): void {
    this._harnessControl.wake();
  }

  private waitForWakeOrTimeout(ms?: number): Promise<void> {
    return this._harnessControl.waitForWakeOrTimeout(ms);
  }

  private enqueueTrigger(trigger: HarnessTriggerInput): TriggerEnqueueResult {
    return this._harnessControl.enqueueTrigger(trigger);
  }

  /** Route direct mentions from a message that has entered visible history. */
  private dispatchDirectMentionTriggers(message: ChatMessage): void {
    if (this.externallyScheduled) return;
    this._harnessControl.dispatchDirectMentionTriggers(message);
  }

  private async *harnessLoop(): AsyncGenerator<ChatMessage> {
    return yield* this._harnessLoopRuntime.run();
  }

  private shouldEmitHarnessWaitDebug(wait: { waitMs: number; reason: string }): boolean {
    return this._harnessControl.shouldEmitWaitDebug(wait);
  }

  private getHarnessWait(): { waitMs?: number; reason: string } {
    return this._idleRuntime.getHarnessWait();
  }

  private markGroupActivity(
    speakers: readonly string[],
    source: "human" | "character",
  ): void {
    this._groupIdleRuntime.markActivity(speakers, source);
  }

  private initializeGroupAutonomousIdle(): void {
    this._groupIdleRuntime.initialize(
      this.state.messages.length,
      this.state.actions.length,
    );
  }

  /** Typing delay: base 2s + 5 chars/s + hesitation, then global pacing. */
  private computeTypingDelaySec(message: string, hesitationSec = 0): number {
    return calculateTypingDelaySec(message, hesitationSec, this._pacingMultiplier);
  }

  /** idle 只在角色看到了别。用户的新消息后才值得调用 LLM。*/
  private hasNewContextForCharacter(characterName: string, since?: number): boolean {
    return this._idleRuntime.hasNewContextForCharacter(characterName, since);
  }

  private schedulePassiveIdleBackoff(
    characterName: string,
    runtime: CharacterRuntimeState,
    now: number,
  ): number {
    return this._idleRuntime.schedulePassiveIdleBackoff(characterName, runtime, now);
  }

  private shouldForceHarnessContinuation(runtime: CharacterRuntimeState | undefined): boolean {
    return this._idleRuntime.shouldForceHarnessContinuation(runtime);
  }

  /** 初始自主观察间隔：采用较短区间，避免启动后长时间无响应。*/
  private computeInitialIdleSec(_characterName: string, state?: CharacterState): number {
    return this._idleRuntime.computeInitialIdleSec(_characterName, state);
  }

  /** idle cooldown: 基于 trigger 类型 + 决策 + 发言语义，压缩到交互体验可接受的区间。*/
  private computeIdleCooldownSec(args: SessionIdleCooldownInput): number {
    return this._idleRuntime.computeIdleCooldownSec(args);
  }

  /** 处理一个 Harness trigger：生成 Actor 决策并更新自主观察时间。 */
  private startHarnessCharacterDecision(
    trigger: HarnessTriggerInput,
    scheduleCursor: number,
  ): void {
    this._actorRuntime.start(trigger, scheduleCursor);
  }

  /** Internal test seam for running one Actor decision without the loop. */
  /** @internal Test seam for running one Actor decision without the loop. */
  runHarnessCharacterDecision(
    trigger: HarnessTriggerInput,
    scheduleCursor: number,
    generatingMessageId?: string,
  ): Promise<void> {
    return this._actorRuntime.runDecision(trigger, scheduleCursor, generatingMessageId);
  }

  /** Actions are displayed as short timeline beats rather than typed chat bubbles. */
  private computeActionDelaySec(action: string, hesitationSec = 0): number {
    return calculateActionDelaySec(action, hesitationSec, this._pacingMultiplier);
  }

  /**
   * World-facing targeted event injection. Targets are already resolved by
   * Actor ID at the World boundary.
   */
  receiveWorldEvent(message: string, targetCharacterNames: readonly string[]): void {
    dispatchWorldEvent(this.worldCommandHost, message, targetCharacterNames);
  }

  /**
   * World-only attention entry point. A wake is an opportunity to react, not a
   * world fact, so it never enters chat history.
   */
  requestCharacterWake(request: ActorWakeRequest): TriggerEnqueueResult {
    return enqueueWorldCharacterWake(this.worldCommandHost, request);
  }

  /** True when suspending the context would strand committed runtime work. */
  hasPendingWork(): boolean {
    return (
      this.inbox.length > 0 ||
      this._triggerQueue.length > 0 ||
      this._generatingQueue.length > 0 ||
      this._scheduledQueue.length > 0
    );
  }

  /** True while this character still has generated output waiting to commit. */
  hasPendingCharacterOutput(characterName: string): boolean {
    return (
      this._generatingQueue.hasSpeaker(characterName) ||
      this._scheduledQueue.all.some((message) => message.speaker === characterName)
    );
  }

  /** Apply a world presence/participation transition to this Session runtime. */
  handleWorldActorRuntimeState(characterName: string): void {
    applyWorldActorRuntimeState(this.worldCommandHost, characterName);
  }

  /**
   * Replace the active World roster without recreating the Session.
   *
   * Committed history and scene state stay intact. Characters removed from the
   * roster lose all uncommitted work before their runtime state is discarded.
   */
  syncWorldRoster(input: {
    characters: readonly CharacterCard[];
    humans: readonly HumanParticipant[];
    relations: readonly Relation[];
  }): void {
    updateWorldRoster(this.worldCommandHost, input, assertUniqueParticipantNames);
  }

  /** Remove only one actor's uncommitted work without disturbing the context. */
  cancelCharacterWork(characterName: string, reason: string): void {
    cancelWorldCharacterWork(this.worldCommandHost, characterName, reason);
  }

  /** Readiness used by the World Director before staging a wake. */
  getCharacterWakeStatus(
    characterName: string,
  ): "ready" | "queued" | "generating" | "scheduled" | "cooldown" | "unavailable" {
    return readWorldCharacterWakeStatus(this.worldCommandHost, characterName);
  }

  /** 根据 decision 设置下一。idle 检查时。*/
  private applyWakeFromParsed(
    wake: Parameters<SessionIdleRuntime["applyWakeFromParsed"]>[0],
    source: string,
  ): void {
    this._idleRuntime.applyWakeFromParsed(wake, source);
  }

  private setIdleAfterDecision(
    trigger: HarnessTriggerInput,
    characterName: string,
    decision: "speak" | "silent",
    isClosing: boolean,
    modelHintSec?: number,
  ): void {
    this._idleRuntime.setIdleAfterDecision(
      trigger,
      characterName,
      decision,
      isClosing,
      modelHintSec,
    );
  }

  private drainInboxToHistory(): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    for (const e of this.inbox.drain()) {
      const msg = this.applyInboxMessage(e);
      msgs.push(msg);
    }
    return msgs;
  }

  private async *flushScheduledMessages(): AsyncGenerator<ChatMessage> {
    return yield* this._outputRuntime.flushScheduledMessages();
  }

  private cancelInterruptibleOutputs(reason: string, preserveCommitWindow = true): void {
    this._outputRuntime.cancelInterruptibleOutputs(reason, preserveCommitWindow);
  }

  private rescheduleIdleAfterCancellation(characterName: string, reason: string, now: number): void {
    const character = this._contextBuilder.input.characters.find((c) => c.name === characterName);
    if (!character) return;

    const previousRuntime = this._characterRuntime.get(characterName);
    if (!this.autonomousIdleEnabled) {
      this._characterRuntime.set(characterName, {
        characterName,
        lastSpokeAt: previousRuntime?.lastSpokeAt,
        lastDecisionAt: previousRuntime?.lastDecisionAt,
        lastMentionedAt: previousRuntime?.lastMentionedAt,
      });
      return;
    }
    const nextIdleSec = Math.round(clamp(6 + Math.random() * 10, 5, 18));
    this._characterRuntime.set(characterName, {
      ...previousRuntime,
      characterName,
      mutedUntil: Math.min(previousRuntime?.mutedUntil ?? now, now + 2_000),
      idleCheckAt: now + nextIdleSec * 1000,
      passiveBackoffCount: 0,
    });
    this.debug.emit({
      type: "harness.idle_scheduled",
      characterName,
      nextIdleSec,
      reason: "cancelled",
      detail: reason,
    });
  }

  private validateFinalMessage(message: string): { ok: true } | { ok: false; reason: string } {
    if (!message.trim()) return { ok: false, reason: "empty" };
    if (/\[INTENT:|\[NO_PROPOSAL:|\[STATE:/i.test(message)) return { ok: false, reason: "format tags" };
    const trimmed = message.trim();
    const hasSticker = /\{sticker:[^{}]+\}/i.test(trimmed);
    if (hasSticker && !this._messageStyle.allowStickers) return { ok: false, reason: "stickers disabled" };
    if (hasSticker && !/^\{sticker:[^{}]+\}$/i.test(trimmed)) return { ok: false, reason: "sticker must be standalone" };
    return { ok: true };
  }

  private validateFinalAction(action: string): boolean {
    const normalized = action.trim();
    if (!normalized || [...normalized].length > 160) return false;
    return !/\[INTENT:|\[NO_PROPOSAL:|\[STATE:|\{sticker:/i.test(normalized);
  }

  /** 暂停调度。当。speak 执行完成后生效。*/
  pause(): void {
    this._lifecycle.pause();
  }

  /** 恢复调度。如。start() 在暂停中，会继续循环。*/
  resume(): void {
    this._lifecycle.resume();
  }

  /** 停止内部 Session，并取消所有进行中与待发送任务。 */
  stop(): void {
    this._lifecycle.stop();
  }

  private async waitIfPaused(): Promise<void> {
    await this._lifecycle.waitIfPaused();
  }

  /** 导出当前会话快照。可用于本地保存或网络传输。*/
  snapshot(): SessionSnapshot {
    return buildSessionSnapshot({
      id: this.id,
      state: this.state,
      scheduled: this._scheduledQueue.all,
      now: this.now(),
    });
  }

  /** 生成只读调试快照，不包含敏感配置。 */
  snapshotDebugState(): SessionDebugSnapshot {
    return buildSessionDebugSnapshotFromState({
      sessionId: this.id,
      status: this._status,
      state: this.state,
      now: this.now(),
      characters: this._contextBuilder.input.characters,
      getCharacterState: (characterName) => this.currentCharacterState(characterName),
      characterRuntime: this._characterRuntime,
      scheduled: this._scheduledQueue.all,
      generating: this._generatingQueue.all,
      triggers: this._triggerQueue.all,
      debugEvents: this.debug.events,
      isGenerating: (characterName) => this._generatingQueue.hasSpeaker(characterName),
    });
  }

  /** 订阅后台事件；返回值用于取消订阅。*/
  onDebugEvent(listener: DebugEventListener): DebugUnsubscribe {
    return this.debug.on(listener);
  }

  onProviderUsage(listener: ProviderUsageEventListener): DebugUnsubscribe {
    return this._providerUsageRuntime.subscribe(listener);
  }

  private publishProviderUsage(event: ProviderUsageEvent): void {
    this._providerUsageRuntime.publish(event);
  }

  /** 真人成员发送群聊消息。消息先进入 inbox，再由会话循环有序写入历史。*/
  sendHumanMessage(input: HumanMessageInput): void {
    this.enqueue(input);
    this.wakeHarness("human_message");
  }

  /**
   * World narration replaces the current scene direction. Drop every piece of
   * uncommitted Actor work so an old cue cannot leak into the new scene.
   */
  interruptPendingActorWork(reason: string): void {
    for (const trigger of this._triggerQueue.clear()) {
      this.debug.emit({
        type: "harness.trigger_skipped",
        target: trigger.target,
        triggerType: trigger.type,
        reason,
      });
      this._actorRuntime.settleActorWake(trigger, trigger.target, "cancelled");
    }
    this.cancelInterruptibleOutputs(reason, false);
    this.wakeHarness("world_narration");
  }

  /** Commit a human performance without waking the autonomous routing loop. */
  commitHumanMessage(input: HumanMessageInput): ChatMessage {
    return commitSessionMessage(this.messageCommitHost, {
      characterName: input.participantName,
      text: input.message,
      source: "human",
    });
  }

  /** Commit a human stage action. World presentation decides when the next turn begins. */
  commitHumanAction(participantName: string, text: string): ActorAction {
    return commitSessionAction(this.messageCommitHost, participantName, text);
  }

  private get messageCommitHost() {
    return {
      debug: this.debug,
      messages: this.state.messages,
      actions: this.state.actions,
      nextId: () => this.nextId(),
      now: () => this.now(),
      notify: (type: RuntimeNotification["type"], payload: Record<string, unknown>) => this.notify(type, payload),
      onMessageCommitted: () => this.maybeStartHistoryCompression(),
    };
  }

  private enqueue(message: HumanMessageInput): void {
    this.inbox.enqueue(message);
    this.debug.emit({
      type: "inbox.message_enqueued",
      message,
      queueLength: this.inbox.length,
    });
  }

  /** Starts a low-priority digest request without delaying the active chat turn. */
  private maybeStartHistoryCompression(): void {
    this._historyCompressionRuntime.maybeStart();
  }

  private addMessage(
    characterName: string,
    text: string,
    source: ChatMessage["source"],
  ): ChatMessage {
    return commitSessionMessage(this.messageCommitHost, { characterName, text, source });
  }

  private applyInboxMessage(message: HumanMessageInput): ChatMessage {
    return this.addMessage(message.participantName, message.message, "human");
  }

}
