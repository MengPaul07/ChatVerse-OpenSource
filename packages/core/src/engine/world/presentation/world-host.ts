import type {
  NarrativeBeat,
  PlayerPerformance,
  WorldActorDefinition,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { WorldState } from "../state.js";
import type { ChatContextRuntime } from "../runtime/context-runtime.js";
import type { NarratorMode } from "../narrator/index.js";
import type { PresentationControllerHost } from "./controller.js";
import type { PlayerTurnView } from "./player.js";
import {
  compactNarratorEvent,
  truncateText,
} from "../runtime/helpers.js";
import { isPlayerControlledActor } from "../persistence/definition.js";

export interface WorldPresentationHostFactoryOptions {
  now(): number;
  nextId(): string;
  isStagePacingOverride(contextId: string): boolean;
  getContext(contextId: string): ChatContextRuntime;
  playerActorId(contextId: string): string | undefined;
  prefetchLimit(contextId: string): number;
  commitPlayerPerformance(
    contextId: string,
    actorId: string,
    performance: PlayerPerformance,
  ): string[];
  scheduleNarrator(
    contextId: string,
    mode: NarratorMode,
    sourceEventIds?: readonly string[],
  ): void;
  scheduleDirector(immediate: boolean, reason: string): void;
  activatePreparedBeat(contextId: string): boolean;
  getBeat(beatId: string): NarrativeBeat | undefined;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

export function createWorldPresentationHost(
  options: WorldPresentationHostFactoryOptions,
): PresentationControllerHost {
  return {
    now: options.now,
    nextId: options.nextId,
    openingMinimumMs: (contextId) => options.isStagePacingOverride(contextId)
      ? 0
      : options.getContext(contextId).definition.presentation?.openingNarrationMinimumDisplayMs,
    playerActorId: options.playerActorId,
    prefetchLimit: options.prefetchLimit,
    commitPlayerPerformance: options.commitPlayerPerformance,
    onPlayerPerformanceCommitted: (contextId, _beatId, entryIds, skipped) => {
      if (skipped) {
        options.scheduleNarrator(contextId, "check_closure");
        return;
      }
      options.scheduleNarrator(contextId, "resolve_action", entryIds);
    },
    onPresentationAcknowledged: (contextId, beatId, promoted, acknowledgedTurn) => {
      if (promoted) return;
      const completedBeat = options.getBeat(beatId);
      if (completedBeat?.status === "completed") {
        if (!options.activatePreparedBeat(contextId)) {
          options.scheduleDirector(true, "beat_completed");
        }
        return;
      }
      const isNarration = acknowledgedTurn.participant.type === "narration";
      options.scheduleNarrator(
        contextId,
        isNarration ? "check_closure" : "resolve_action",
        isNarration ? [] : acknowledgedTurn.entryIds,
      );
    },
    notify: options.notify,
  };
}

export interface PlayerTurnViewBuilderOptions {
  state: WorldState;
  getContext(contextId: string): ChatContextRuntime;
  playerActorId(contextId: string): string | undefined;
  requireActor(actorId: string): WorldActorDefinition;
  nextId(): string;
}

export function buildWorldPlayerTurnView(
  options: PlayerTurnViewBuilderOptions,
  contextId: string,
  beat: NarrativeBeat,
  prompt: string,
  guidance: string,
): PlayerTurnView {
  const runtime = options.getContext(contextId);
  const projected = options.state.contexts.get(contextId);
  const actorIds = options.state.actorIdsInContext(contextId);
  const cast = actorIds.map((actorId) => {
    const actor = options.requireActor(actorId);
    const name = actor.card.name;
    const role = actor.card.description;
    return `${actorId}: ${name}${role ? ` - ${truncateText(role, 80)}` : ""}`;
  }).join("\n");
  const recentEvents = options.state.journal.all()
    .filter((event) => event.contextId === contextId)
    .filter((event) => event.type !== "actor.memory.updated")
    .slice(-8)
    .map((event) => `${event.id} ${event.type}: ${compactNarratorEvent(event)}`)
    .join("\n");
  const playerActorId = options.playerActorId(contextId);
  const actor = playerActorId
    ? options.state.actorDefinitions.get(playerActorId)
    : undefined;
  if (!actor || !isPlayerControlledActor(actor) || !actor.playerCard) {
    throw new Error("Player card is incomplete.");
  }
  return {
    proposalId: options.nextId(),
    contextId,
    actorId: playerActorId!,
    beat,
    sceneNow: projected?.scene?.text ?? runtime.definition.scene.topic,
    recentEvents,
    cast,
    prompt,
    guidance,
    card: structuredClone(actor.playerCard),
    maxTokens: runtime.beatRuntime.playerMaxTokens,
  };
}
