import type {
  ActorAction,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
} from "../../../contracts/chat.js";
import type {
  ActorPresence,
  ActorStateSource,
  ContextParticipation,
  NarrativeBeat,
  PlayerPerformance,
  WorldEvent,
  WorldEventInput,
  WorldEventType,
  WorldForegroundFailureKind,
  WorldForegroundRecoveryState,
  WorldForegroundResponsibility,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { ProviderFailureDetails } from "../../provider-failure.js";
import { actorDisplayName, isConversationContext, isPlayerControlledActor, isPrivateConversationContext, playerParticipantForActor } from "../persistence/definition.js";
import { cloneMessage, actorStateSource, errorToMessage } from "./helpers.js";
import { presenceKey, type WorldState } from "../state.js";
import type { ForegroundRecoveryIntent } from "./foreground-recovery.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type {
  ActorWakeRequest,
  ActorWakeSettlement,
  ActorWakeSource,
} from "../session-binding.js";
import type { NarratorMode } from "../narrator/index.js";
import type { PresentationController } from "../presentation/controller.js";

export interface ActorRuntimeWakeInput {
  context: ChatContextRuntime;
  actorId: string;
  source: ActorWakeSource;
  reason: string;
  messageId?: string;
  requiresReply: boolean;
  priority: number;
  causationId?: string;
  beatId?: string;
}

export interface ActorPresenceTransition {
  actorId: string;
  presence: ActorPresence;
  status?: string;
  statusProvided?: boolean;
  source: ActorStateSource;
  reason?: string;
  contextId?: string;
  causationId?: string;
}

export interface ActorParticipationTransition {
  actorId: string;
  contextId: string;
  participation: ContextParticipation;
  source: ActorStateSource;
  reason?: string;
  causationId?: string;
}

type ForegroundExpectation = {
  contextId: string;
  operation: "actor";
  responsibility: WorldForegroundResponsibility;
  intent: ForegroundRecoveryIntent;
  expectedAt?: number;
  beatId?: string;
  actorId?: string;
};

export interface ActorRuntimeBridgeHost {
  readonly state: WorldState;
  readonly presentation: PresentationController;
  now(): number;
  isStopped(): boolean;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  getActiveBeat(contextId: string): NarrativeBeat | undefined;
  getForegroundRecovery(contextId: string): WorldForegroundRecoveryState | undefined;
  activateContext(contextId: string): void;
  scheduleContextSuspend(contextId: string): void;
  scheduleNarrator(
    contextId: string,
    mode: NarratorMode,
    sourceEventIds?: readonly string[],
  ): void;
  maybeScheduleBeatClosureCheck(
    contextId: string,
    beatId: string,
    force?: boolean,
    sourceEventIds?: readonly string[],
  ): void;
  recordAmbientNoop(contextId: string): void;
  currentFocusActors(contextId: string): string[];
  updateContextFocus(contextId: string, actorId: string, reason: string): void;
  recordContextActivity(contextId: string, focusActorId?: string): void;
  actorWakeValidationError(
    actorId: string,
    contextId: string,
    source: ActorStateSource,
    requireRuntimeReady?: boolean,
  ): string | undefined;
  expectForegroundOperation(input: ForegroundExpectation): boolean;
  startForegroundOperation(contextId: string): void;
  clearForegroundOperation(contextId: string): void;
  failForegroundOperation(
    contextId: string,
    kind: WorldForegroundFailureKind,
    message: string,
    userMessage: string,
    retryable?: boolean,
  ): void;
  retryOrFailForegroundOperation(
    contextId: string,
    kind: WorldForegroundFailureKind,
    message: string,
    retryDelayMs: number,
  ): void;
  handleBlockingProviderFailure(
    error: ProviderFailureDetails,
    source: { contextId: string; operation: "actor" },
  ): boolean;
  transitionActorPresence(input: ActorPresenceTransition): boolean;
  transitionActorParticipation(input: ActorParticipationTransition): boolean;
  appendEvent<TType extends WorldEventType>(input: WorldEventInput<TType>): WorldEvent<TType>;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/**
 * World-side Actor orchestration. Session remains responsible for prompting
 * and queueing; this bridge owns the durable event and presentation boundary.
 */
export class ActorRuntimeBridge {
  constructor(private readonly host: ActorRuntimeBridgeHost) {}

  syncContextRoster(contextId: string): void {
    const runtime = this.requireContext(contextId);
    const actors = this.host.state.actorIdsInContext(contextId)
      .map((actorId) => {
        const actor = this.host.state.getActorDefinition(actorId);
        if (!actor) throw new Error(`Unknown world actor: ${actorId}`);
        return actor;
      });
    const nameToActorId = new Map<string, string>();
    for (const actor of actors) {
      const name = actor.card.name;
      const existing = nameToActorId.get(name);
      if (existing && existing !== actor.id) {
        throw new Error(`Context ${contextId} contains duplicate actor display name: ${name}`);
      }
      nameToActorId.set(name, actor.id);
    }
    const actorNameById = new Map(
      [...nameToActorId].map(([name, actorId]) => [actorId, name]),
    );
    const characters = actors
      .filter((actor) => !isPlayerControlledActor(actor))
      .map((actor) => actor.card);
    const humans = actors
      .filter(isPlayerControlledActor)
      .map(playerParticipantForActor);
    const relations = this.host.state.relations
      .filter((relation) => (
        actorNameById.has(relation.fromActorId) &&
        actorNameById.has(relation.toActorId)
      ))
      .map((relation) => ({
        from: actorNameById.get(relation.fromActorId)!,
        to: actorNameById.get(relation.toActorId)!,
        description: relation.description,
      }));

    runtime.nameToActorId.clear();
    runtime.actorNameById.clear();
    for (const [name, actorId] of nameToActorId) {
      runtime.nameToActorId.set(name, actorId);
      runtime.actorNameById.set(actorId, name);
    }
    runtime.session.syncWorldRoster({ characters, humans, relations });
  }

  async runContext(context: ChatContextRuntime): Promise<void> {
    try {
      for await (const message of context.session.start()) {
        if (this.host.isStopped()) break;
        const actorId = context.nameToActorId.get(message.characterName);
        const actorTurnId = actorId
          ? context.turnCoordinator.actorTurn(actorId)?.id
          : undefined;
        const committedEvent = this.host.appendEvent({
          type: "context.message.committed",
          contextId: context.definition.id,
          actorId,
          correlationId: actorTurnId,
          payload: { message: cloneMessage(message) },
        });
        for (const actorIdInContext of this.host.state.actorIdsInContext(context.definition.id)) {
          const actorState = this.host.state.actorStates.get(actorIdInContext);
          const presence = this.host.state.getPresence(context.definition.id, actorIdInContext);
          if (
            !presence ||
            presence.participation === "left" ||
            actorState?.presence === "offline"
          ) continue;
          this.host.state.presences.set(presenceKey(context.definition.id, actorIdInContext), {
            ...presence,
            lastSeenSequence: committedEvent.sequence,
            updatedAt: this.host.now(),
          });
        }
        const actor = actorId ? this.host.state.actorDefinitions.get(actorId) : undefined;
        this.host.recordContextActivity(context.definition.id, actor ? actorId : undefined);
        this.host.scheduleContextSuspend(context.definition.id);
        if (
          actor != null && isPlayerControlledActor(actor) &&
          context.actorRuntime.activation === "beat_runtime"
        ) {
          const routed = this.routePlayerMessage(context, message, committedEvent);
          if (!routed && !isPrivateConversationContext(context.definition)) {
            this.host.scheduleNarrator(context.definition.id, "resolve_action", [committedEvent.id]);
          }
        }
      }
    } catch (error) {
      if (this.host.isStopped()) return;
      this.host.notify("world.error", {
        contextId: context.definition.id,
        message: errorToMessage(error),
      });
    }
  }

  onActorWakeStarted(
    contextId: string,
    nameToActorId: ReadonlyMap<string, string>,
    request: ActorWakeRequest,
  ): void {
    const actorId = nameToActorId.get(request.characterName);
    if (!actorId) return;
    this.host.expectForegroundOperation({
      contextId,
      operation: "actor",
      responsibility: "perform_turn",
      intent: {
        operation: "actor",
        actorId,
        source: request.source,
        reason: request.reason,
        messageId: request.messageId,
        requiresReply: request.requiresReply,
        priority: request.priority,
        causationId: request.messageId,
        beatId: request.chainId,
      },
      beatId: request.chainId,
      actorId,
    });
    this.host.startForegroundOperation(contextId);
  }

  requestActorWake(input: ActorRuntimeWakeInput): boolean {
    const { context } = input;
    const contextId = context.definition.id;
    if (this.host.getForegroundRecovery(contextId)?.status === "failed") return false;
    // An already-running Narrator can return a stale target after the Actor
    // left. It is no longer visible and should be discarded quietly.
    if (this.host.state.actorStates.get(input.actorId)?.presence === "offline") return false;
    if (
      input.source === "narrator" &&
      context.turnCoordinator.hasNarratorWake(input.actorId)
    ) {
      this.host.notify("actor.wake_skipped", {
        contextId,
        actorId: input.actorId,
        source: input.source,
        reason: "narrator turn already pending",
      });
      return false;
    }
    const validationError = this.host.actorWakeValidationError(
      input.actorId,
      contextId,
      input.source === "narrator" ? "director" : "user",
      input.source !== "narrator",
    );
    if (validationError) {
      this.host.notify("actor.wake_skipped", {
        contextId,
        actorId: input.actorId,
        source: input.source,
        reason: validationError,
      });
      return false;
    }

    const actor = this.host.state.actorDefinitions.get(input.actorId);
    const characterName = context.actorNameById.get(input.actorId);
    if (actor?.kind !== "character" || !characterName) return false;

    this.host.activateContext(contextId);
    const result = context.session.requestCharacterWake({
      characterName,
      source: input.source,
      reason: input.reason,
      messageId: input.messageId,
      requiresReply: input.requiresReply,
      priority: input.priority,
      chainId: input.beatId,
    });
    if (result !== "enqueued") {
      this.host.notify("actor.wake_skipped", {
        contextId,
        actorId: input.actorId,
        source: input.source,
        reason: result,
      });
      return false;
    }

    const startedSequence = this.host.state.journal.lastSequence;
    context.turnCoordinator.reserveActorTurn(input.actorId, {
      id: `actor-turn:${contextId}:${input.actorId}:${startedSequence + 1}`,
      beatId: input.beatId,
      startedSequence,
    });

    this.host.expectForegroundOperation({
      contextId,
      operation: "actor",
      responsibility: "perform_turn",
      intent: {
        operation: "actor",
        actorId: input.actorId,
        source: input.source,
        reason: input.reason,
        messageId: input.messageId,
        requiresReply: input.requiresReply,
        priority: input.priority,
        causationId: input.causationId,
        beatId: input.beatId,
      },
      beatId: input.beatId,
      actorId: input.actorId,
    });

    this.host.updateContextFocus(contextId, input.actorId, `wake:${input.source}`);
    this.host.notify("actor.wake_enqueued", {
      contextId,
      actorId: input.actorId,
      source: input.source,
      reason: input.reason,
      requiresReply: input.requiresReply,
      priority: input.priority,
      messageId: input.messageId,
      beatId: input.beatId,
    });
    if (input.source === "narrator" && input.beatId) {
      context.turnCoordinator.reserveNarratorWake(input.actorId, {
        beatId: input.beatId,
        startedSequence,
      });
    }
    this.host.scheduleContextSuspend(contextId);
    return true;
  }

  handleActorWakeSettlement(
    contextId: string,
    settlement: ActorWakeSettlement,
  ): void {
    const context = this.host.getContextRuntime(contextId);
    if (!context) return;
    const actorId = context.nameToActorId.get(settlement.characterName);
    this.host.notify("actor.wake_settled", {
      contextId,
      actorId,
      characterName: settlement.characterName,
      source: settlement.source,
      outcome: settlement.outcome,
      messageId: settlement.messageId,
      beatId: settlement.chainId,
      failure: settlement.failure,
    });
    if (settlement.outcome === "output_scheduled" || settlement.outcome === "silent") {
      this.host.clearForegroundOperation(contextId);
    } else if (settlement.outcome === "failed") {
      if (actorId) context.turnCoordinator.settleActorTurn(actorId);
      const recovery = this.host.getForegroundRecovery(contextId);
      if (recovery?.operation === "actor" && recovery.status !== "failed") {
        this.host.retryOrFailForegroundOperation(
          contextId,
          settlement.failure === "parse" ? "protocol" : "provider",
          `Actor wake failed: ${settlement.failure ?? "unknown"}.`,
          settlement.failure === "parse" ? 0 : 5_000,
        );
      }
      return;
    } else if (settlement.outcome === "cancelled") {
      if (actorId) context.turnCoordinator.settleActorTurn(actorId);
      return;
    }
    if (
      !isPrivateConversationContext(context.definition) &&
      (settlement.source === "player_focus" || settlement.source === "player_direct") &&
      settlement.outcome !== "output_scheduled"
    ) {
      this.host.scheduleNarrator(contextId, "resolve_action");
    }
    if (settlement.source === "narrator" && actorId) {
      if (settlement.outcome === "output_scheduled") return;
      this.settleNarratorActorTurn(context, actorId, false, false);
    }
    if (actorId && settlement.outcome !== "output_scheduled") {
      context.turnCoordinator.settleActorTurn(actorId);
    }
  }

  handleActorProviderError(contextId: string, error: ProviderFailureDetails): boolean {
    const blocked = this.host.handleBlockingProviderFailure(error, {
      contextId,
      operation: "actor",
    });
    if (blocked) {
      this.host.failForegroundOperation(
        contextId,
        "provider",
        error.message,
        "模型连接需要处理，修复配置后可重试角色回应。",
        false,
      );
    }
    return blocked;
  }

  handleActorOutputDrained(
    context: ChatContextRuntime,
    actorId: string,
    producedOutput: boolean,
  ): void {
    this.settleNarratorActorTurn(context, actorId, producedOutput, true);
    context.turnCoordinator.settleActorTurn(actorId);
  }

  settleDismissedActor(contextId: string, actorId: string): void {
    const context = this.host.getContextRuntime(contextId);
    if (context) this.settleNarratorActorTurn(context, actorId, false, false);
  }

  commitContextActorAction(
    contextId: string,
    actorId: string | undefined,
    action: ActorAction,
  ): void {
    if (this.host.isStopped()) return;
    const committedEvent = this.host.appendEvent({
      type: "context.action.committed",
      contextId,
      actorId,
      correlationId: actorId
        ? this.requireContext(contextId).turnCoordinator.actorTurn(actorId)?.id
        : undefined,
      payload: { action: { ...action } },
    });
    for (const actorIdInContext of this.host.state.actorIdsInContext(contextId)) {
      const actorState = this.host.state.actorStates.get(actorIdInContext);
      const presence = this.host.state.getPresence(contextId, actorIdInContext);
      if (
        !presence ||
        presence.participation === "left" ||
        actorState?.presence === "offline"
      ) continue;
      this.host.state.presences.set(presenceKey(contextId, actorIdInContext), {
        ...presence,
        lastSeenSequence: committedEvent.sequence,
        updatedAt: this.host.now(),
      });
    }
    this.host.recordContextActivity(contextId, actorId);
    this.host.scheduleContextSuspend(contextId);
    const context = this.requireContext(contextId);
    if (!isConversationContext(context.definition) && action.contextTransition === "leave") {
      this.host.scheduleNarrator(contextId, "resolve_action", [committedEvent.id]);
    }
    if (actorId && action.contextTransition === "leave") {
      this.host.transitionActorParticipation({
        actorId,
        contextId,
        participation: "left",
        source: "actor",
        reason: action.action,
        causationId: committedEvent.id,
      });
      const actor = this.host.state.actorDefinitions.get(actorId);
      if (actor?.lifecycle === "scene") {
        this.host.transitionActorPresence({
          actorId,
          presence: "offline",
          status: action.action,
          statusProvided: true,
          source: "system",
          reason: action.action,
          causationId: committedEvent.id,
        });
      }
    }
  }

  commitPlayerPerformance(
    contextId: string,
    actorId: string,
    performance: PlayerPerformance,
  ): string[] {
    if (this.host.isStopped()) return [];
    const runtime = this.requireContext(contextId);
    const actor = this.host.state.getActorDefinition(actorId);
    if (!actor) throw new Error(`Unknown world actor: ${actorId}`);
    if (!isPlayerControlledActor(actor)) throw new Error(`Actor ${actorId} is not controlled by a human.`);
    const entryIds: string[] = [];
    let turnCorrelationId: string | undefined;
    const message = performance.message?.trim();
    const actionText = performance.action?.trim();
    if (!message && !actionText) throw new Error("Player performance must include a message or action.");
    if (actionText) {
      const action = runtime.session.commitHumanAction(actorDisplayName(actor), actionText);
      const event = this.host.appendEvent({
        type: "context.action.committed",
        contextId,
        actorId,
        correlationId: turnCorrelationId,
        payload: { action: { ...action } },
      });
      entryIds.push(event.id);
      turnCorrelationId = event.id;
    }
    if (message) {
      const committed = runtime.session.commitHumanMessage({
        participantName: actorDisplayName(actor),
        message,
      });
      const event = this.host.appendEvent({
        type: "context.message.committed",
        contextId,
        actorId,
        correlationId: turnCorrelationId,
        payload: { message: cloneMessage(committed) },
      });
      entryIds.push(event.id);
    }
    this.host.recordContextActivity(contextId, actorId);
    this.host.scheduleContextSuspend(contextId);
    return entryIds;
  }

  applyContextActorStatePatch(
    contextId: string,
    actorId: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void {
    const previous = this.host.state.actorStates.get(actorId);
    if (!previous) return;
    const mappedPresence = patch.availability === "available"
      ? "online"
      : patch.availability === "away"
        ? "away"
        : patch.availability === "unavailable"
          ? "offline"
          : previous.presence;
    const status = patch.note !== undefined
      ? patch.note || undefined
      : patch.intent !== undefined
        ? patch.intent || undefined
        : patch.mood !== undefined
          ? patch.mood || undefined
          : previous.status;
    this.host.transitionActorPresence({
      actorId,
      presence: mappedPresence,
      status,
      statusProvided: (
        patch.note !== undefined ||
        patch.intent !== undefined ||
        patch.mood !== undefined
      ),
      source: actorStateSource(source),
      reason: patch.reason,
      contextId,
    });
  }

  sessionActorState(
    contextId: string,
    actorId: string,
  ): Pick<
    CharacterState,
    "availability" | "attention" | "mood" | "intent" | "note" | "updatedAt"
  > | undefined {
    const actorState = this.host.state.actorStates.get(actorId);
    const presence = this.host.state.getPresence(contextId, actorId);
    if (!actorState || !presence) return undefined;
    const unavailable = (
      actorState.presence === "offline" ||
      presence.participation !== "joined"
    );
    return {
      availability: unavailable
        ? "unavailable"
        : actorState.presence === "away"
          ? "away"
          : "available",
      attention: unavailable
        ? "distracted"
        : actorState.presence === "away"
          ? "lurking"
          : "active",
      note: actorState.status,
      updatedAt: Math.max(actorState.updatedAt, presence.updatedAt),
    };
  }

  private routePlayerMessage(
    context: ChatContextRuntime,
    message: ChatMessage,
    event: WorldEvent,
  ): boolean {
    const mentioned = this.resolveWorldMentions(context, message.message);
    const privateConversation = isPrivateConversationContext(context.definition);
    if (context.actorRuntime.activation === "beat_runtime" && !privateConversation) return false;
    if (context.actorRuntime.playerRouting === "narrator") return false;
    if (mentioned.length > 0) {
      let routed = false;
      for (const actorId of mentioned) {
        routed = this.requestActorWake({
          context,
          actorId,
          source: "player_direct",
          reason: `玩家 ${message.characterName} 明确点名了你，请直接回应这条消息。`,
          messageId: message.id,
          requiresReply: true,
          priority: 100,
          causationId: event.id,
          beatId: this.host.getActiveBeat(context.definition.id)?.id,
        }) || routed;
      }
      return routed;
    }

    const focusActorId = this.host.currentFocusActors(context.definition.id)[0];
    if (!focusActorId) return false;
    return this.requestActorWake({
      context,
      actorId: focusActorId,
      source: privateConversation ? "player_direct" : "player_focus",
      reason: privateConversation
        ? `玩家 ${message.characterName} 正在与你私聊，请直接回应这条消息。`
        : `玩家 ${message.characterName} 正在延续当前对话。`,
      messageId: message.id,
      requiresReply: privateConversation,
      priority: privateConversation ? 100 : 80,
      causationId: event.id,
      beatId: this.host.getActiveBeat(context.definition.id)?.id,
    });
  }

  private resolveWorldMentions(context: ChatContextRuntime, message: string): string[] {
    const targets: string[] = [];
    const entries = [...context.actorNameById.entries()]
      .map(([actorId, name]) => ({ actorId, name }))
      .filter(({ actorId }) => {
        const actor = this.host.state.actorDefinitions.get(actorId);
        return actor != null && !isPlayerControlledActor(actor);
      })
      .sort((left, right) => right.name.length - left.name.length);
    for (const { actorId, name } of entries) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, "u").test(message)) {
        targets.push(actorId);
      }
    }
    return targets;
  }

  private settleNarratorActorTurn(
    context: ChatContextRuntime,
    actorId: string,
    producedOutput: boolean,
    waitForOutputDrain: boolean,
  ): void {
    if (!context.turnCoordinator.hasNarratorWake(actorId)) return;
    if (waitForOutputDrain) {
      const characterName = context.actorNameById.get(actorId);
      if (!characterName || context.session.hasPendingCharacterOutput(characterName)) return;
    }
    const pendingWake = context.turnCoordinator.narratorWake(actorId);
    if (!pendingWake) return;
    const wasPendingAmbient = context.turnCoordinator.settleNarratorWake(actorId, producedOutput);
    if (context.turnCoordinator.pendingNarratorWakeCount > 0) return;

    if (wasPendingAmbient && !context.turnCoordinator.ambientWakeProducedOutput) {
      this.host.recordAmbientNoop(context.definition.id);
    }
    const beat = this.host.state.beats.get(pendingWake.beatId);
    if (!beat || beat.status !== "running") return;
    if (producedOutput && context.definition.presentation?.kind === "galgame") {
      const entryIds = this.host.state.journal
        .read(pendingWake.startedSequence)
        .filter((event) => event.contextId === context.definition.id)
        .filter((event) => event.type === "context.message.committed" || event.type === "context.action.committed")
        .map((event) => event.id);
      if (entryIds.length > 0) {
        const queued = this.host.presentation.queueTurn(
          context.definition.id,
          beat.id,
          { type: "actor", actorId },
          entryIds,
        );
        if (queued && this.host.presentation.canPrefetch(context.definition.id)) {
          this.host.maybeScheduleBeatClosureCheck(
            context.definition.id,
            beat.id,
            true,
            entryIds,
          );
        }
        return;
      }
    }
    this.host.maybeScheduleBeatClosureCheck(context.definition.id, beat.id, true);
  }

  private requireContext(contextId: string): ChatContextRuntime {
    const context = this.host.getContextRuntime(contextId);
    if (!context) throw new Error(`Unknown world context: ${contextId}`);
    return context;
  }
}
