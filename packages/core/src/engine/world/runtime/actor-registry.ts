import type {
  WorldEvent,
  WorldEventInput,
  WorldActorDefinition,
  WorldRegisterActorInput,
} from "../../../contracts/world.js";
import type { ActorMemoryUpdateCoordinator } from "../../actor-memory/coordinator.js";
import type { InMemoryActorMemoryStore } from "../../actor-memory/index.js";
import type { WorldState } from "../state.js";
import { isPlayerControlledActor } from "../persistence/definition.js";

interface ActorRegistryHost {
  state: WorldState;
  actorMemory: Pick<InMemoryActorMemoryStore, "registerActor">;
  actorMemoryUpdates: Pick<ActorMemoryUpdateCoordinator, "registerActor">;
  now(): number;
  isStopped(): boolean;
  requireActor(actorId: string): WorldActorDefinition;
  appendEvent<TType extends "actor.registered" | "relation.added">(
    input: WorldEventInput<TType>,
  ): WorldEvent<TType>;
  considerDirectorWork(immediate: boolean): void;
}

/** Registers dynamic Actors and their initial relations as one World mutation. */
export class ActorRegistryRuntime {
  constructor(private readonly host: ActorRegistryHost) {}

  register(input: WorldRegisterActorInput, causationId?: string): WorldEvent {
    if (this.host.isStopped()) {
      throw new Error("Cannot register an Actor in a stopped world.");
    }
    const actor = input.actor;
    if (!actor.id.trim()) throw new Error("World actor id is required.");
    const name = actor.card.name;
    if (!name.trim()) throw new Error("World actor display name is required.");
    if (this.host.state.actorDefinitions.has(actor.id)) {
      throw new Error(`Duplicate world actor id: ${actor.id}`);
    }

    const knownIds = new Set([...this.host.state.actorDefinitions.keys(), actor.id]);
    for (const relation of input.relations ?? []) {
      if (
        !knownIds.has(relation.fromActorId) ||
        !knownIds.has(relation.toActorId)
      ) {
        throw new Error(
          `Dynamic relation references an unknown Actor: ${relation.fromActorId} -> ${relation.toActorId}`,
        );
      }
      if (relation.fromActorId !== actor.id && relation.toActorId !== actor.id) {
        throw new Error("A relation registered with an Actor must involve that Actor.");
      }
    }

    this.host.state.registerActor(actor, this.host.now());
    this.host.state.addRelations(input.relations ?? []);
    const registeredActor = this.host.requireActor(actor.id);
    this.host.actorMemory.registerActor({
      actorId: registeredActor.id,
      definition: registeredActor.memory,
    });
    if (!isPlayerControlledActor(registeredActor) && registeredActor.lifecycle !== "scene") {
      this.host.actorMemoryUpdates.registerActor({
        actorId: registeredActor.id,
        card: registeredActor.card,
      });
    }

    const event = this.host.appendEvent({
      type: "actor.registered",
      actorId: actor.id,
      causationId,
      payload: {
        kind: actor.kind,
        playerControlled: isPlayerControlledActor(actor),
        name,
        description: actor.card.description,
        lifecycle: actor.lifecycle ?? "persistent",
        relationCount: input.relations?.length ?? 0,
      },
    });
    for (const relation of input.relations ?? []) {
      this.host.appendEvent({
        type: "relation.added",
        actorId: actor.id,
        causationId: event.id,
        payload: { relation: { ...relation } },
      });
    }
    this.host.considerDirectorWork(false);
    return event;
  }
}
