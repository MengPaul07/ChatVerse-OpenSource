import type {
  ActorAction,
  CharacterCard,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
  SessionMessageStyleConfig,
} from "../../contracts/chat.js";
import type { DebugEmitter } from "../../observability/debug/index.js";
import type { RuntimeNotification } from "../../runtime/index.js";
import type { HarnessTriggerInput } from "../events/index.js";
import { HarnessDriver } from "../harness/index.js";
import type { ActorTurnItem, AgentWake } from "../harness/index.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type {
  ActorWakeSettlement,
  ActorWakeSource,
  WorldSessionBinding,
} from "../world/session-binding.js";
import { providerFailureDetails } from "../provider-failure.js";
import {
  WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT,
  buildHarnessDecisionHint,
  buildHarnessIdleTriggerCtx,
  buildWorldActorDecisionHint,
  buildWorldActorIdleTriggerCtx,
} from "../../context/prompts.js";
import type { SessionIdleCooldownInput } from "./idle-runtime.js";
import type { SessionOutputRuntime } from "./output-runtime.js";
import { createHarnessObserver } from "./harness-observer.js";
import { isClosingMessage as checkClosingMessage } from "./timing.js";
import {
  decisionHasMessage,
  errorToMessage,
  isAbortError,
} from "./helpers.js";

export interface SessionActorRuntimeHost {
  readonly harness: HarnessDriver;
  readonly generatingQueue: GeneratingMessageQueue;
  readonly scheduledQueue: ScheduledMessageQueue;
  readonly outputRuntime: SessionOutputRuntime;
  readonly worldBinding?: WorldSessionBinding;
  readonly messageStyle: Required<SessionMessageStyleConfig>;
  readonly debug: DebugEmitter;
  getCharacters(): readonly CharacterCard[];
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  getMessages(): readonly ChatMessage[];
  getActions(): readonly ActorAction[];
  buildHarnessCharacter(characterName: string): { systemPrompt: string; userPrompt: string };
  isGroupConversation(): boolean;
  isAutonomousIdleEnabled(): boolean;
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
  applyCharacterStatePatch(
    characterName: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void;
  applyWakeFromParsed(wake: AgentWake | undefined, source: string): void;
  validateFinalMessage(message: string): { ok: true } | { ok: false; reason: string };
  validateFinalAction(action: string): boolean;
  now(): number;
  nextId(): string;
  isStopped(): boolean;
  wake(reason?: string): void;
  notify(type: RuntimeNotification["type"], payload: Record<string, unknown>): void;
}

/** Owns one Session's Actor decision lifecycle and world wake settlement. */
export class SessionActorRuntime {
  private readonly characterAborts = new Map<string, AbortController>();

  constructor(private readonly host: SessionActorRuntimeHost) {}

  start(trigger: HarnessTriggerInput, scheduleCursor: number): void {
    const character = this.host.getCharacters().find((item) => item.name === trigger.target);
    if (!character || this.host.generatingQueue.hasSpeaker(character.name)) return;
    const now = this.host.now();
    const generating = this.host.generatingQueue.start({
      speaker: character.name,
      intent: `${trigger.type} decision`,
      now,
      status: this.host.worldBinding?.actorIdForCharacter(character.name)
        ? "waiting_for_actor"
        : "generating",
    });

    void this.runDecision(trigger, scheduleCursor, generating.id)
      .catch((error) => {
        if (this.host.isStopped() || isAbortError(error)) return;
        const message = errorToMessage(error);
        this.host.debug.emit({ type: "agent.error", agent: "character", message });
        this.host.notify("agent.error", {
          agent: "character",
          characterName: character.name,
          message,
        });
      })
      .finally(() => {
        this.host.generatingQueue.complete(generating.id);
        this.host.wake("actor_generation_finished");
      });
  }

  abort(characterName: string, reason?: string): void {
    const controller = this.characterAborts.get(characterName);
    if (!controller) return;
    if (reason) {
      controller.abort(new DOMException(reason, "AbortError"));
    } else {
      controller.abort();
    }
  }

  abortAll(): void {
    for (const controller of this.characterAborts.values()) controller.abort();
    this.characterAborts.clear();
  }

  async runDecision(
    trigger: HarnessTriggerInput,
    scheduleCursorIn: number,
    generatingMessageId?: string,
  ): Promise<void> {
    const character = this.host.getCharacters().find((item) => item.name === trigger.target);
    if (!character) return;
    const actorId = this.host.worldBinding?.actorIdForCharacter(character.name);
    const controller = new AbortController();
    this.characterAborts.set(character.name, controller);
    let release: (() => void) | undefined;
    try {
      release = actorId
        ? await this.host.worldBinding?.acquireGeneration(actorId, trigger.priority, controller.signal)
        : undefined;
      if (generatingMessageId) {
        this.host.generatingQueue.setStatus(generatingMessageId, "generating");
      }
      const expectedRevision = actorId
        ? this.host.worldBinding?.readActorRevision(actorId)
        : undefined;
      if (!this.isWorldGenerationCurrent(character.name, actorId, expectedRevision)) {
        this.settleActorWake(trigger, character.name, "failed", "unavailable");
        return;
      }
      await this.runUnlocked(
        trigger,
        scheduleCursorIn,
        character,
        actorId,
        expectedRevision,
        controller.signal,
      );
    } finally {
      if (this.characterAborts.get(character.name) === controller) {
        this.characterAborts.delete(character.name);
      }
      release?.();
    }
  }

  private isWorldGenerationCurrent(
    characterName: string,
    actorId: string | undefined,
    expectedRevision: number | undefined,
  ): boolean {
    if (this.host.getCharacterState(characterName)?.availability === "unavailable") return false;
    if (!actorId || expectedRevision === undefined) return true;
    return this.host.worldBinding?.readActorRevision(actorId) === expectedRevision;
  }

  private async runUnlocked(
    trigger: HarnessTriggerInput,
    scheduleCursorIn: number,
    character: CharacterCard,
    actorId: string | undefined,
    expectedRevision: number | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const triggerSource = trigger.source ?? "character";
    const isWorldWake = trigger.type === "wake";
    const requiresDirectReply = (
      trigger.type === "mention" && triggerSource === "user"
    ) || (
      isWorldWake && trigger.requiresReply === true
    );
    const currentRuntime = this.host.getCharacterRuntime(character.name);
    const requiresContinuation = (
      this.host.isAutonomousIdleEnabled() &&
      trigger.type === "idle" &&
      this.host.shouldForceHarnessContinuation(currentRuntime)
    );

    this.host.debug.emit({
      type: "harness.trigger_processing",
      triggerType: trigger.type,
      target: trigger.target,
      source: triggerSource,
      priority: trigger.priority,
    });
    if (isWorldWake && this.host.worldBinding) {
      this.host.worldBinding.onActorWakeStarted?.({
        characterName: character.name,
        source: triggerSource as ActorWakeSource,
        reason: trigger.reason ?? trigger.message ?? "",
        messageId: trigger.messageId,
        requiresReply: trigger.requiresReply === true,
        priority: trigger.priority,
        chainId: trigger.turnId,
      });
    }

    const { systemPrompt, userPrompt } = this.host.buildHarnessCharacter(character.name);
    const useWorldActorDecision = Boolean(this.host.worldBinding && !this.host.isGroupConversation());
    if (useWorldActorDecision) {
      this.host.harness.setDecisionSystemPrompt(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT);
    }
    const preview = this.host.outputRuntime.buildScheduledPreview();
    const previewHint = preview ? `\n[即将发送的消息，不要重复]\n${preview}` : "";

    let triggerContext = "";
    if (trigger.type === "mention") {
      const mentionMessage = this.host.getMessages().find((message) => message.id === trigger.messageId);
      triggerContext = `\n[触发${triggerSource === "user" ? "用户" : "角色"} @了你]${mentionMessage ? `\n原消息：${mentionMessage.characterName}${mentionMessage.message}` : ""}`;
      if (requiresDirectReply) {
        triggerContext += "\n[硬性要求]这是用户对你的直接提问/点名。必须返回至少一个 message 项并给出自然、符合角色的回应；不得只做动作或选择 silent。";
      }
    } else if (trigger.type === "event") {
      if (useWorldActorDecision) {
        triggerContext = `\n[触发：世界事件]\n${trigger.message || "当前场景发生了变化。"}\n这是已经发生且投递到当前场景的世界事实。请用 perform 交付一项具体、可见且不重复的角色回应；若影响很小，就用最小的判断、问题、承诺或实际行动回应，不要凭空扩大事件。`;
      } else {
        triggerContext = `\n[触发事件${trigger.message || ""}]\n请判断这个事件是否与你的角色相关，是否需要回应。`;
      }
    } else if (trigger.type === "idle") {
      triggerContext = useWorldActorDecision
        ? buildWorldActorIdleTriggerCtx(this.host.getMessages().length === 0)
        : buildHarnessIdleTriggerCtx(this.host.getMessages().length === 0);
      if (requiresContinuation) {
        triggerContext += useWorldActorDecision
          ? "\n[硬性要求]这是一次明确的世界角色活动机会。现在必须返回 perform，并交付至少一项具体、可见、不重复的内容。"
          : "\n[硬性要求]你已经连续 3 次选择 silent。现在必须返回至少一个 message 项并发送一条自然、不重复、符合人设的消息；不得只做动作或再次 silent。";
      }
    } else if (trigger.type === "wake") {
      const latestMessage = trigger.messageId
        ? this.host.getMessages().find((message) => message.id === trigger.messageId)
        : undefined;
      if (triggerSource === "player_direct") {
        triggerContext = `\n[触发：玩家明确点名你]\n${latestMessage ? `玩家消息：${latestMessage.message}\n` : ""}${trigger.reason ?? ""}\n[硬性要求]玩家正在直接和你说话。必须返回至少一个 message 项，不能只做动作或选择 silent。`;
      } else if (triggerSource === "player_focus") {
        triggerContext = useWorldActorDecision
          ? `\n[触发：玩家正在和当前对话焦点交流]\n${latestMessage ? `玩家消息：${latestMessage.message}\n` : ""}${trigger.reason ?? ""}\n请按角色立场用 perform 给出一项具体回应；不要重复已经完成的内容。`
          : `\n[触发：玩家正在和当前对话焦点交流]\n${latestMessage ? `玩家消息：${latestMessage.message}\n` : ""}${trigger.reason ?? ""}\n请按角色立场自主判断是否回应；确实没有必要时可以 silent。`;
      } else {
        triggerContext = useWorldActorDecision
          ? `\n[触发：世界导演将当前情境交给你留意]\n${trigger.reason ?? trigger.message ?? ""}\n这只是一次注意力分配，不是新的世界事实。请结合可见上下文用 perform 交付一项最小而具体的 message 或 action，不要重复旧话题。`
          : `\n[触发：世界导演将当前情境交给你留意]\n${trigger.reason ?? trigger.message ?? ""}\n这只是一次注意力分配，不是新的世界事实。请结合可见上下文自主决定 message、action 或 silent。`;
      }
    }

    const harnessHint = useWorldActorDecision
      ? buildWorldActorDecisionHint(triggerContext, previewHint, this.host.messageStyle)
      : buildHarnessDecisionHint(triggerContext, previewHint, this.host.messageStyle);
    const runtime = currentRuntime;
    const now = this.host.now();
    const observer = () => createHarnessObserver(
      {
        debug: this.host.debug,
        notify: (type, payload) => this.host.notify(type, payload),
      },
      {
        characterName: character.name,
        actorId,
        contextId: this.host.worldBinding?.contextId,
        turnId: trigger.turnId,
        historyCount: this.host.getMessages().length,
        maxTokens: this.host.worldBinding?.getActorMaxTokens?.(),
      },
    );

    try {
      let parsed = await this.host.harness.decide(
        systemPrompt,
        userPrompt + harnessHint,
        observer(),
        signal,
      );
      if (!this.isWorldGenerationCurrent(character.name, actorId, expectedRevision)) {
        this.settleActorWake(trigger, character.name, "cancelled");
        return;
      }

      const requiresSpeak = requiresDirectReply || requiresContinuation || useWorldActorDecision;
      if (requiresSpeak && !decisionHasMessage(parsed)) {
        const forceReason = requiresDirectReply
          ? "用户直接 @ 了你"
          : useWorldActorDecision
            ? "World 角色每次被唤醒都必须交付可见回应"
            : "你已经连续 3 次选择 silent";
        const forceReplyHint = `${harnessHint}\n[系统重试]${forceReason}。现在必须在 perform.items 中输出至少一个 message；不要只输出 action，也不要输出 silent。`;
        parsed = await this.host.harness.decide(
          systemPrompt,
          userPrompt + forceReplyHint,
          observer(),
          signal,
        );
        if (!this.isWorldGenerationCurrent(character.name, actorId, expectedRevision)) {
          this.settleActorWake(trigger, character.name, "cancelled");
          return;
        }
        if (!decisionHasMessage(parsed)) {
          const fallbackMessage = requiresDirectReply
            ? "我在，刚刚看到你的消息了。"
            : this.buildForcedContinuationFallback();
          this.host.debug.emit({
            type: "harness.decision",
            characterName: character.name,
            triggerType: trigger.type,
            decision: "speak",
            reason: "forced speak fallback",
          });
          parsed = {
            type: "perform",
            items: [{ kind: "message", message: fallbackMessage }],
            reason: "forced speak fallback",
          };
        }
      }

      const modelHint = typeof parsed.idleCooldownSec === "number"
        ? parsed.idleCooldownSec
        : undefined;
      const statePatch = parsed.statePatch;
      if (parsed.type === "perform") {
        const sourceItems: ActorTurnItem[] = parsed.items;
        const items: ActorTurnItem[] = [];
        let messageCount = 0;
        let actionCount = 0;
        for (const item of sourceItems) {
          if (item.kind === "message") {
            if (
              messageCount >= this.host.messageStyle.maxBurstCount ||
              !this.host.validateFinalMessage(item.message).ok
            ) continue;
            items.push(item);
            messageCount++;
          } else {
            if (actionCount >= 2 || !this.host.validateFinalAction(item.action)) continue;
            items.push(item);
            actionCount++;
          }
          if (items.length >= 4) break;
        }
        if (requiresSpeak && messageCount === 0) {
          items.push({
            kind: "message",
            message: requiresDirectReply
              ? "我在，刚刚看到你的消息了。"
              : this.buildForcedContinuationFallback(),
          });
          messageCount++;
        }
        if (items.length === 0) {
          if (requiresSpeak) {
            items.push({
              kind: "message",
              message: requiresDirectReply
                ? "我在，刚刚看到你的消息了。"
                : this.buildForcedContinuationFallback(),
            });
          } else {
            this.host.debug.emit({
              type: "harness.decision",
              characterName: character.name,
              triggerType: trigger.type,
              decision: "silent",
              reason: "empty or invalid output",
            });
            this.host.setIdleAfterDecision(trigger, character.name, "silent", false, modelHint);
            this.settleActorWake(trigger, character.name, "silent");
            return;
          }
        }

        const hesitationSec = typeof parsed.hesitationSec === "number" ? parsed.hesitationSec : 0;
        const messages = items
          .filter((item): item is Extract<ActorTurnItem, { kind: "message" }> => item.kind === "message")
          .map((item) => item.message);
        const isClosing = messages.length > 0 && messages.every((message) => this.isClosingMessage(message));
        const idleSec = this.host.isAutonomousIdleEnabled() && !this.host.isGroupConversation() && !this.host.worldBinding
          ? this.host.computeIdleCooldownSec({
              characterName: character.name,
              state: this.host.getCharacterState(character.name),
              triggerType: trigger.type,
              triggerSource,
              decision: "speak",
              isClosingMessage: isClosing,
              modelHintSec: modelHint,
            })
          : undefined;

        this.host.debug.emit({
          type: "harness.decision",
          characterName: character.name,
          triggerType: trigger.type,
          decision: "speak",
          reason: parsed.reason,
        });

        let sendCursor = Math.max(
          this.host.now(),
          scheduleCursorIn,
          this.host.outputRuntime.scheduleCursor,
          ...this.host.scheduledQueue.all.map((message) => message.sendAt),
        );
        const burstCount = items.length;
        items.forEach((item, index) => {
          const content = item.kind === "message" ? item.message : item.action;
          const gapSec = item.kind === "message"
            ? this.host.computeTypingDelaySec(content, index === 0 ? hesitationSec : 0)
            : this.host.computeActionDelaySec(content, index === 0 ? hesitationSec : 0);
          sendCursor += gapSec * 1000;
          const isLast = index === burstCount - 1;
          const scheduled = this.host.scheduledQueue.schedule({
            id: this.host.nextId(),
            now,
            speaker: character.name,
            message: content,
            outputKind: item.kind,
            contextTransition: item.kind === "action" ? item.contextTransition : undefined,
            sendAt: sendCursor,
            statePatch: isLast ? statePatch : undefined,
          });
          if (isLast && idleSec !== undefined) scheduled.nextIdleSec = idleSec;
          this.host.debug.emit({
            type: "queue.message_scheduled",
            messageId: scheduled.id,
            speaker: character.name,
            delayMs: gapSec * 1000,
            sendAt: sendCursor,
            charCount: [...content.trim()].length,
            hesitationSec: index === 0 ? hesitationSec : undefined,
            nextIdleSec: isLast ? idleSec : undefined,
            burstIndex: index + 1,
            burstCount,
          });
          this.host.notify("queue.message_scheduled", {
            messageId: scheduled.id,
            speaker: character.name,
            sendAt: sendCursor,
            delayMs: gapSec * 1000,
            burstIndex: index + 1,
            burstCount,
            outputKind: item.kind,
          });
        });
        this.host.outputRuntime.scheduleCursor = sendCursor;

        this.host.setCharacterRuntime(character.name, this.host.isAutonomousIdleEnabled()
          ? {
              characterName: character.name,
              mutedUntil: now + 8_000,
              lastDecisionAt: now,
              lastMentionedAt: trigger.type === "mention" ? now : runtime?.lastMentionedAt,
              consecutiveSilentCount: runtime?.consecutiveSilentCount,
              passiveBackoffCount: 0,
            }
          : {
              characterName: character.name,
              lastDecisionAt: now,
              lastMentionedAt: trigger.type === "mention" ? now : runtime?.lastMentionedAt,
            });
        this.settleActorWake(trigger, character.name, "output_scheduled");
      } else if (parsed.type === "silent") {
        this.host.debug.emit({
          type: "harness.decision",
          characterName: character.name,
          triggerType: trigger.type,
          decision: "silent",
          reason: parsed.reason,
        });
        if (statePatch) this.host.applyCharacterStatePatch(character.name, statePatch, "character");
        this.host.setIdleAfterDecision(trigger, character.name, "silent", false, modelHint);
        if (this.host.isAutonomousIdleEnabled()) {
          this.host.applyWakeFromParsed(parsed.wake, character.name);
        }
        this.settleActorWake(trigger, character.name, "silent");
      } else {
        this.host.debug.emit({
          type: "harness.decision",
          characterName: character.name,
          triggerType: trigger.type,
          decision: "silent",
          reason: "invalid type",
        });
        this.host.setIdleAfterDecision(trigger, character.name, "silent", false, modelHint);
        this.settleActorWake(trigger, character.name, "failed", "invalid_target");
      }
    } catch (error) {
      if (signal.aborted || !this.isWorldGenerationCurrent(character.name, actorId, expectedRevision)) {
        this.host.debug.emit({
          type: "harness.trigger_skipped",
          target: character.name,
          triggerType: trigger.type,
          reason: "stale world actor generation",
        });
        this.settleActorWake(trigger, character.name, "cancelled");
        return;
      }
      if (this.host.worldBinding?.onProviderError?.(providerFailureDetails(error))) {
        this.settleActorWake(trigger, character.name, "failed", "provider");
        return;
      }
      const message = errorToMessage(error);
      this.host.debug.emit({
        type: "agent.error",
        agent: "character",
        message: `${character.name} harness decision parse failed: ${message}`,
      });
      this.host.notify("agent.error", {
        agent: "character",
        characterName: character.name,
        message,
      });
      this.host.debug.emit({
        type: "harness.decision",
        characterName: character.name,
        triggerType: trigger.type,
        decision: "silent",
        reason: "parse error",
      });
      this.host.setIdleAfterDecision(trigger, character.name, "silent", false, undefined);
      this.settleActorWake(trigger, character.name, "failed", "provider");
    }
  }

  settleActorWake(
    trigger: HarnessTriggerInput,
    characterName: string,
    outcome: ActorWakeSettlement["outcome"],
    failure?: ActorWakeSettlement["failure"],
  ): void {
    if (trigger.type !== "wake" || !this.host.worldBinding) return;
    const source = trigger.source;
    if (
      source !== "narrator" &&
      source !== "player_focus" &&
      source !== "player_direct"
    ) return;
    this.host.debug.emit({
      type: "actor.wake_settled",
      characterName,
      source,
      outcome,
      messageId: trigger.messageId,
      chainId: trigger.turnId,
      failure,
    });
    this.host.worldBinding.onActorWakeSettled({
      characterName,
      source,
      outcome,
      messageId: trigger.messageId,
      chainId: trigger.turnId,
      failure,
    });
  }

  private buildForcedContinuationFallback(): string {
    return "我还在想刚才那件事。";
  }

  private isClosingMessage(message: string): boolean {
    return checkClosingMessage(message);
  }
}
