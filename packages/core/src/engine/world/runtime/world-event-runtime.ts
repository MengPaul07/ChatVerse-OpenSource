import type {
  WorldActorDefinition,
  WorldEvent,
  WorldEventInput,
  WorldEventType,
  WorldExternalEventInput,
} from "../../../contracts/world.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { WorldState } from "../state.js";
import {
  isConversationContext,
  isPlayerControlledActor,
} from "../persistence/definition.js";

export interface WorldEventRuntimeHost {
  readonly state: WorldState;
  isStopped(): boolean;
  assertNotStopped(operation: string): void;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  requireContext(contextId: string): ChatContextRuntime;
  requireActor(actorId: string): WorldActorDefinition;
  activeBeatForContext(contextId: string): { id: string } | undefined;
  recordContextActivity(contextId: string): void;
  activateContext(contextId: string): void;
  scheduleContextSuspend(contextId: string): void;
  scheduleNarrator(contextId: string, mode: "resolve_action", sourceEventIds: readonly string[]): void;
  scheduleDirector(immediate: boolean, reason: string): void;
  considerDirectorWork(immediate: boolean): void;
  appendEvent<TType extends WorldEventType>(input: WorldEventInput<TType>): WorldEvent<TType>;
}

export interface WorldEventRoutingResult {
  narratorHandled: boolean;
  directorRequired: boolean;
}

/** Commits external facts and routes them to the appropriate World runtime. */
export class WorldEventRuntime {
  constructor(private readonly host: WorldEventRuntimeHost) {}

  emit(
    input: WorldExternalEventInput,
    triggerDirector: boolean,
    causationId?: string,
  ): WorldEvent {
    this.host.assertNotStopped("emit a World event");
    if (!input.message.trim()) throw new Error("World event cannot be empty.");
    const contextIds = unique(input.contextIds ?? []);
    const actorIds = unique(input.actorIds ?? []);
    for (const contextId of contextIds) this.host.requireContext(contextId);
    for (const actorId of actorIds) this.host.requireActor(actorId);

    const event = this.host.appendEvent({
      type: "world.event.emitted",
      causationId,
      correlationId: input.correlationId,
      payload: {
        message: input.message.trim(),
        contextIds,
        actorIds,
      },
    });
    const routing = this.route(
      event,
      input.message.trim(),
      contextIds,
      actorIds,
    );
    if (triggerDirector) {
      if (routing.directorRequired) {
        this.host.scheduleDirector(true, "world_event");
      } else if (routing.narratorHandled) {
        // Advance the Director cursor while the active Beat owns the event,
        // preventing it from resurfacing as a delayed planning input.
        this.host.considerDirectorWork(false);
      }
    }
    return event;
  }

  route(
    event: WorldEvent,
    message: string,
    explicitContextIds: readonly string[],
    actorIds: readonly string[],
  ): WorldEventRoutingResult {
    const contextIds = this.resolveContextIds(explicitContextIds, actorIds);
    let narratorHandled = false;
    let directorRequired = contextIds.length === 0;
    for (const contextId of contextIds) {
      const context = this.host.requireContext(contextId);
      // Private and group dialogs are not broadcast targets for World events.
      if (isConversationContext(context.definition)) {
        directorRequired = true;
        continue;
      }
      this.host.recordContextActivity(contextId);
      if (context.actorRuntime.activation === "beat_runtime") {
        this.host.activateContext(contextId);
        const activeBeat = this.host.activeBeatForContext(contextId);
        if (activeBeat) {
          this.host.scheduleNarrator(contextId, "resolve_action", [event.id]);
          narratorHandled = true;
        } else {
          directorRequired = true;
        }
        this.host.scheduleContextSuspend(contextId);
        continue;
      }
      const targets = this.host.state.actorIdsInContext(contextId)
        .filter((actorId) => actorIds.length === 0 || actorIds.includes(actorId))
        .filter((actorId) => (
          this.host.state.getPresence(contextId, actorId)?.participation === "joined"
        ))
        .map((actorId) => this.host.requireActor(actorId))
        .filter((actor) => !isPlayerControlledActor(actor))
        .map((actor) => actor.card.name);
      if (targets.length === 0) continue;
      this.host.activateContext(contextId);
      context.session.receiveWorldEvent(message, targets);
      this.host.scheduleContextSuspend(contextId);
      directorRequired = true;
    }
    return { narratorHandled, directorRequired };
  }

  resolveContextIds(
    explicitContextIds: readonly string[],
    actorIds: readonly string[],
  ): string[] {
    const contextIds = new Set(explicitContextIds);
    if (contextIds.size === 0 && actorIds.length > 0) {
      for (const context of this.host.state.definition.contexts) {
        if (actorIds.some((actorId) => {
          const presence = this.host.state.getPresence(context.id, actorId);
          return presence?.participation !== "left" && presence !== undefined;
        })) {
          contextIds.add(context.id);
        }
      }
    }
    if (contextIds.size === 0 && actorIds.length === 0) {
      for (const context of this.host.state.definition.contexts) {
        if (!isConversationContext(context) && this.host.activeBeatForContext(context.id)) {
          contextIds.add(context.id);
        }
      }
    }
    return [...contextIds];
  }

  isDeferredWhileBeatRuns(event: WorldEvent): boolean {
    if (
      event.type !== "world.progression.requested" &&
      event.type !== "narrative.beat.completed"
    ) return false;
    if (event.type === "narrative.beat.completed") {
      return event.payload.reason !== "resolved";
    }
    const contextId = event.contextId;
    return Boolean(contextId && this.host.activeBeatForContext(contextId));
  }

  isOwnedByActiveBeat(event: WorldEvent): boolean {
    if (event.type !== "world.event.emitted") return false;
    const contextIds = this.resolveContextIds(
      event.payload.contextIds,
      event.payload.actorIds,
    ).filter((contextId) => !isConversationContext(this.host.requireContext(contextId).definition));
    return contextIds.length > 0 && contextIds.every(
      (contextId) => Boolean(this.host.activeBeatForContext(contextId)),
    );
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
