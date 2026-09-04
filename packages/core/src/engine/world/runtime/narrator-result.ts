import type {
  NarrativeBeat,
  NarrativeNarration,
  WorldEvent,
  WorldEventInput,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import { isPlayerControlledActor } from "../persistence/definition.js";
import type {
  NarratorDirectorRequest,
  NarratorMode,
  NarratorResult,
} from "../narrator/index.js";
import type { ActorWakeSource } from "../session-binding.js";
import type { WorldState } from "../state.js";
import type { PresentationController } from "../presentation/controller.js";

interface NarratorActorWakeInput {
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

export interface NarratorResultApplierHost {
  state: WorldState;
  runtime: RuntimeHost;
  presentation: PresentationController;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  playerActorIdForContext(contextId: string): string | undefined;
  requestActorWake(input: NarratorActorWakeInput): boolean;
  preparePlayerTurn(
    contextId: string,
    beat: NarrativeBeat,
    prompt: string,
    guidance: string,
  ): void | Promise<void>;
  scheduleDirectorTransition(
    contextId: string,
    beat: NarrativeBeat,
    request: NarratorDirectorRequest,
    sourceEventIds: readonly string[],
  ): void;
  scheduleDirector(immediate: boolean, reason?: string): void;
  maybeScheduleBeatClosureCheck(
    contextId: string,
    beatId: string,
    force?: boolean,
    sourceEventIds?: readonly string[],
  ): void;
  scheduleContextSuspend(contextId: string): void;
  recordAmbientNoop(contextId: string): void;
  completeBeat(
    beat: NarrativeBeat,
    outcome: string,
    sourceEventIds: readonly string[],
    reason: "resolved" | "superseded",
    preservePresentation?: boolean,
  ): void;
  actorWasSpawnedForBeat(actorId: string, beat: NarrativeBeat): boolean;
  beatActorTurnCount(beat: NarrativeBeat): number;
  minimumBeatActorTurns(beat: NarrativeBeat): number;
  commitNarration(
    input: WorldEventInput<"narrative.narration.committed">,
  ): WorldEvent<"narrative.narration.committed">;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Applies a Narrator result without owning scheduling or World lifecycle state. */
export class NarratorResultApplier {
  constructor(private readonly host: NarratorResultApplierHost) {}

  apply(
    contextId: string,
    beat: NarrativeBeat,
    mode: NarratorMode,
    result: NarratorResult,
    sourceEventIds: readonly string[],
  ): void {
    const ambientTriggered = sourceEventIds.some((eventId) => {
      const event = this.host.state.journal.get(eventId);
      return event?.type === "world.progression.requested" && event.payload.reason === "ambient";
    });
    const projected = this.host.state.contexts.get(contextId);
    if (projected) {
      projected.scene = {
        id: this.host.runtime.idGenerator.next(),
        contextId,
        text: result.sceneNow,
        sourceEventIds: [...sourceEventIds],
        occurredAt: this.host.runtime.clock.now(),
      };
      projected.updatedAt = this.host.runtime.clock.now();
    }
    const narrationText = mode === "open_beat"
      ? result.narration ?? result.sceneNow ?? beat.brief
      : result.narration;
    const narrationEntryIds: string[] = [];
    if (narrationText) {
      const narration: NarrativeNarration = {
        id: this.host.runtime.idGenerator.next(),
        contextId,
        text: narrationText,
        sourceEventIds: [...sourceEventIds],
        occurredAt: this.host.runtime.clock.now(),
      };
      const narrationEvent = this.host.commitNarration({
        type: "narrative.narration.committed",
        contextId,
        causationId: sourceEventIds.at(-1),
        payload: { narration },
      });
      narrationEntryIds.push(narrationEvent.id);
    }
    const progress = this.host.beatActorTurnCount(beat);
    const canComplete = result.beatStatus === "complete" &&
      result.wakes.length === 0 &&
      progress >= this.host.minimumBeatActorTurns(beat);
    const effectiveStatus = canComplete ? "complete" : "continue";
    const contextRuntime = this.host.getContextRuntime(contextId);
    if (!contextRuntime) return;
    if (result.directorRequest?.kind === "transition_beat" && !canComplete) {
      // A transition request is an explicit escape hatch when the current
      // Beat cannot reach its local completion condition. Let the Director
      // plan the replacement Beat instead of leaving Narrator suspended.
      this.host.scheduleDirectorTransition(contextId, beat, result.directorRequest, sourceEventIds);
      this.host.notify("narrator.completed", {
        contextId,
        beatId: beat.id,
        mode,
        status: "continue",
        affectedActorIds: [],
      });
      return;
    }
    if (canComplete) {
      if (contextRuntime.definition.presentation?.kind === "galgame" && narrationEntryIds.length > 0) {
        const queued = this.host.presentation.queueTurn(
          contextId,
          beat.id,
          { type: "narration" },
          narrationEntryIds,
        );
        if (queued) {
          this.host.completeBeat(
            beat,
            result.outcome ?? result.sceneNow,
            sourceEventIds,
            "resolved",
            true,
          );
          this.host.scheduleContextSuspend(contextId);
          this.host.scheduleDirector(true, "beat_completed");
          this.host.notify("narrator.completed", {
            contextId,
            beatId: beat.id,
            mode,
            status: effectiveStatus,
            affectedActorIds: [],
          });
          return;
        }
      }
      this.host.scheduleContextSuspend(contextId);
      this.host.notify("narrator.completed", {
        contextId,
        beatId: beat.id,
        mode,
        status: effectiveStatus,
        affectedActorIds: [],
      });
      this.host.completeBeat(beat, result.outcome ?? result.sceneNow, sourceEventIds, "resolved");
      this.host.scheduleDirector(true, "beat_completed");
      return;
    }
    if (contextRuntime.definition.presentation?.kind === "galgame") {
      if (narrationEntryIds.length > 0) {
        this.host.presentation.queueTurn(contextId, beat.id, { type: "narration" }, narrationEntryIds);
      }
      const wake = result.wakes[0];
      let wakeEnqueueFailed = false;
      if (wake) {
        const actor = this.host.state.actorDefinitions.get(wake.actorId);
        if (
          actor &&
          isPlayerControlledActor(actor) &&
          wake.actorId === contextRuntime.definition.presentation.playerActorId
        ) {
          this.host.notify("narrator.turn_selected", {
            contextId,
            beatId: beat.id,
            participant: { type: "player", actorId: wake.actorId },
            reason: wake.guidance,
          });
          void this.host.preparePlayerTurn(contextId, beat, wake.guidance, wake.guidance);
        } else {
          const enqueued = this.host.requestActorWake({
            context: contextRuntime,
            actorId: wake.actorId,
            source: "narrator",
            reason: [
              `当前一幕：${beat.title}。`,
              `幕内引导：${wake.guidance}`,
              "这是调度目标，不是台词，也不是新的客观事实。请直接处理最近一棒的内容；没有独特内容且非必须回应时可以沉默。",
            ].join("\n"),
            requiresReply: wake.requiresResponse,
            priority: wake.urgency === "direct" ? 75 : wake.urgency === "relevant" ? 65 : 60,
            causationId: sourceEventIds.at(-1),
            beatId: beat.id,
          });
          if (enqueued) {
            this.host.notify("narrator.turn_selected", {
              contextId,
              beatId: beat.id,
              participant: { type: "actor", actorId: wake.actorId },
              reason: wake.guidance,
            });
          } else {
            wakeEnqueueFailed = true;
          }
        }
      }
      if (
        narrationEntryIds.length > 0 &&
        (result.wakes.length === 0 || wakeEnqueueFailed) &&
        this.host.presentation.canPrefetch(contextId)
      ) {
        this.host.maybeScheduleBeatClosureCheck(
          contextId,
          beat.id,
          false,
          narrationEntryIds,
        );
      }
      if (ambientTriggered && result.wakes.length === 0) this.host.recordAmbientNoop(contextId);
      this.host.scheduleContextSuspend(contextId);
      this.host.notify("narrator.completed", {
        contextId,
        beatId: beat.id,
        mode,
        status: effectiveStatus,
        affectedActorIds: result.wakes.slice(0, 1).map((wake) => wake.actorId),
      });
      return;
    }
    const selectedWakes = result.wakes;
    const newSceneActorId = mode === "open_beat"
      ? beat.actorIds.find((actorId) => this.host.actorWasSpawnedForBeat(actorId, beat))
      : undefined;
    const candidateWakes = newSceneActorId && !selectedWakes.some((wake) => wake.actorId === newSceneActorId)
      ? [{
          actorId: newSceneActorId,
          urgency: "relevant" as const,
          guidance: "你刚进入当前一幕。只在有自然出场必要时，以自身身份回应当前可观察局面；不要复述其他人的判断。",
          requiresResponse: false,
        }, ...selectedWakes].slice(0, 3)
      : selectedWakes;
    const scheduledActorIds: string[] = [];
    for (const wake of candidateWakes) {
      const actorId = wake.actorId;
      const actor = this.host.state.actorDefinitions.get(actorId);
      if (
        actor &&
        isPlayerControlledActor(actor) &&
        actorId === this.host.playerActorIdForContext(contextId)
      ) {
        this.host.notify("narrator.turn_selected", {
          contextId,
          beatId: beat.id,
          participant: { type: "player", actorId },
          reason: wake.guidance,
        });
        void this.host.preparePlayerTurn(contextId, beat, wake.guidance, wake.guidance);
        scheduledActorIds.push(actorId);
        break;
      }
      const enqueued = this.host.requestActorWake({
        context: contextRuntime,
        actorId,
        source: "narrator",
        reason: [
          `当前一幕：${beat.title}。`,
          `幕内引导：${wake.guidance}`,
          "这是调度目标，不是台词，也不是新的客观事实。请依照自己的身份、知识、关系和意愿处理；没有独特内容且非必须回应时可以沉默。",
        ].join("\n"),
        requiresReply: wake.requiresResponse,
        priority: wake.urgency === "direct" ? 75 : wake.urgency === "relevant" ? 65 : 60,
        causationId: sourceEventIds.at(-1),
        beatId: beat.id,
      });
      if (enqueued) scheduledActorIds.push(actorId);
    }
    if (ambientTriggered) {
      if (scheduledActorIds.length > 0) {
        for (const actorId of scheduledActorIds) contextRuntime.turnCoordinator.markAmbientWake(actorId);
      } else {
        this.host.recordAmbientNoop(contextId);
      }
    }
    if (result.narration || scheduledActorIds.length > 0) {
      this.host.scheduleContextSuspend(contextId);
    }
    this.host.notify("narrator.completed", {
      contextId,
      beatId: beat.id,
      mode,
      status: effectiveStatus,
      affectedActorIds: scheduledActorIds,
    });
  }
}
