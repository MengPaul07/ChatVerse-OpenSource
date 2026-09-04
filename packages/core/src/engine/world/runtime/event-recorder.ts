import type {
  WorldActorDefinition,
  WorldEvent,
  WorldEventInput,
  WorldEventType,
} from "../../../contracts/world.js";
import type { WorldDebugEmitter } from "../../../observability/world-debug/index.js";
import type { ActorMemoryUpdateCoordinator } from "../../actor-memory/coordinator.js";
import { isPlayerControlledActor } from "../persistence/definition.js";
import { unique } from "./helpers.js";
import type { WorldState } from "../state.js";

export interface WorldEventRecorderHost {
  state: WorldState;
  debug: WorldDebugEmitter;
  actorMemoryUpdates: ActorMemoryUpdateCoordinator;
  requireActor(actorId: string): WorldActorDefinition;
}

/** Appends ordered World events and forwards eligible observations to memory. */
export class WorldEventRecorder {
  constructor(private readonly host: WorldEventRecorderHost) {}

  append<TType extends WorldEventType>(input: WorldEventInput<TType>): WorldEvent<TType> {
    const event = this.host.state.journal.append(input);
    const observableEvent = event as WorldEvent;
    this.host.debug.emit({
      category: "world",
      type: observableEvent.type,
      level: "info",
      contextId: observableEvent.contextId,
      actorId: observableEvent.actorId,
      causationId: observableEvent.causationId,
      correlationId: observableEvent.correlationId,
      payload: {
        worldEventId: observableEvent.id,
        worldSequence: observableEvent.sequence,
        payload: observableEvent.payload,
      },
    });
    const observation = this.memoryObservationFor(observableEvent);
    if (observation.actorIds.length > 0) {
      this.host.actorMemoryUpdates.observe(
        observation.actorIds,
        observableEvent,
        observation.critical,
        observation.candidate,
      );
    }
    return event;
  }

  private memoryObservationFor(
    event: WorldEvent,
  ): { actorIds: string[]; critical: boolean; candidate: boolean } {
    if (
      event.type === "context.message.committed" ||
      event.type === "context.action.committed" ||
      event.type === "narrative.narration.committed"
    ) {
      return {
        actorIds: this.aiActorIdsInContext(event.contextId),
        critical: false,
        candidate: false,
      };
    }
    if (event.type === "world.event.emitted") {
      const explicitActors = unique(event.payload.actorIds)
        .filter((actorId) => !isPlayerControlledActor(this.host.requireActor(actorId)));
      if (explicitActors.length > 0) {
        return { actorIds: explicitActors, critical: true, candidate: true };
      }
      return {
        actorIds: unique(event.payload.contextIds.flatMap(
          (contextId) => this.aiActorIdsInContext(contextId),
        )),
        critical: true,
        candidate: true,
      };
    }
    return { actorIds: [], critical: false, candidate: false };
  }

  private aiActorIdsInContext(contextId: string | undefined): string[] {
    if (!contextId) return [];
    return this.host.state.actorIdsInContext(contextId).filter((actorId) => {
      const actor = this.host.requireActor(actorId);
      return (
        !isPlayerControlledActor(actor) &&
        this.host.state.getPresence(contextId, actorId)?.participation === "joined" &&
        this.host.state.actorStates.get(actorId)?.presence !== "offline"
      );
    });
  }
}
