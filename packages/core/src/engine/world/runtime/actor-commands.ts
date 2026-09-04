import type {
  WorldActorBackgroundState,
  WorldActorDefinition,
  WorldEvent,
  WorldMessageInput,
  WorldRegisterActorInput,
  WorldSetActorParticipationInput,
  WorldSetActorPresenceInput,
  WorldUpdateActorControlPolicyInput,
  WorldUpdatePlayerCardInput,
} from "../../../contracts/world.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { ActorPresenceRuntime } from "./actor-presence.js";
import type { ActorRegistryRuntime } from "./actor-registry.js";
import type { ActorRuntimeBridge } from "./actor-runtime.js";
import type { WorldState } from "../state.js";
import {
  actorDisplayName,
  characterCardFromPlayerCard,
  isPlayerControlledActor,
  normalizePlayerCard,
} from "../persistence/definition.js";

interface ActorCommandsHost {
  state: WorldState;
  contextRuntimes: ReadonlyMap<string, ChatContextRuntime>;
  actorRegistry: Pick<ActorRegistryRuntime, "register">;
  actorPresence: Pick<
    ActorPresenceRuntime,
    "transitionActorPresence" | "transitionActorParticipation" | "updateActorControlPolicy"
  >;
  actorRuntimeBridge: Pick<ActorRuntimeBridge, "syncContextRoster">;
  requireActor(actorId: string): WorldActorDefinition;
  requireContext(contextId: string): ChatContextRuntime;
  assertNotStopped(operation: string): void;
  assertMessageInputAllowed(context: ChatContextRuntime): void;
  activateContext(contextId: string): void;
  scheduleContextSuspend(contextId: string): void;
}

/** Owns public Actor commands while World remains the aggregate facade. */
export class ActorCommandsRuntime {
  constructor(private readonly host: ActorCommandsHost) {}

  getRegisteredActors(): readonly WorldActorDefinition[] {
    return [...this.host.state.actorDefinitions.keys()]
      .map((actorId) => this.host.requireActor(actorId));
  }

  playerActorIdForContext(contextId: string): string | undefined {
    const context = this.host.requireContext(contextId).definition;
    const explicit = context.presentation?.kind === "galgame"
      ? context.presentation.playerActorId
      : undefined;
    if (explicit) {
      const actor = this.host.state.actorDefinitions.get(explicit);
      const presence = this.host.state.getPresence(contextId, explicit);
      if (
        actor &&
        isPlayerControlledActor(actor) &&
        context.actorIds.includes(explicit) &&
        presence?.participation === "joined"
      ) return explicit;
    }
    return this.host.state.actorIdsInContext(contextId).find((actorId) => {
      const actor = this.host.state.actorDefinitions.get(actorId);
      return actor != null && isPlayerControlledActor(actor);
    });
  }

  registerActor(input: WorldRegisterActorInput, causationId?: string): WorldEvent {
    return this.host.actorRegistry.register(input, causationId);
  }

  sendMessage(input: WorldMessageInput): void {
    const context = this.host.requireContext(input.contextId);
    this.host.assertMessageInputAllowed(context);
    const actor = this.host.requireActor(input.actorId);
    if (!isPlayerControlledActor(actor)) {
      throw new Error(`Actor ${input.actorId} is not controlled by a human.`);
    }
    const presence = this.host.state.getPresence(input.contextId, actor.id);
    if (presence?.participation !== "joined") {
      throw new Error(`Actor ${input.actorId} is not a member of context ${input.contextId}.`);
    }
    this.host.activateContext(input.contextId);
    context.session.sendHumanMessage({
      participantName: actorDisplayName(actor),
      message: input.message,
    });
    this.host.scheduleContextSuspend(input.contextId);
  }

  updatePlayerCard(input: WorldUpdatePlayerCardInput): void {
    this.host.assertNotStopped("update a Player card");
    const actor = this.host.requireActor(input.actorId);
    if (!isPlayerControlledActor(actor)) throw new Error(`Actor ${input.actorId} is not player-controlled.`);
    const card = normalizePlayerCard(input.card);
    actor.playerCard = structuredClone(card);
    actor.playerControlled = true;
    actor.card = characterCardFromPlayerCard(card, actor.card);
    // requireActor() returns a defensive clone. Keep the runtime registry in
    // sync or subsequent Narrator/Player prompts will continue seeing the old
    // player card.
    this.host.state.updateActorDefinition(actor);
    const definitionActor = this.host.state.definition.actors.find((candidate) => candidate.id === actor.id);
    if (definitionActor && isPlayerControlledActor(definitionActor)) {
      definitionActor.playerCard = structuredClone(card);
      definitionActor.playerControlled = true;
      definitionActor.card = structuredClone(actor.card);
    }
    for (const context of this.host.contextRuntimes.values()) {
      if (context.definition.actorIds.includes(actor.id)) {
        this.host.actorRuntimeBridge.syncContextRoster(context.definition.id);
      }
    }
  }

  getActorState(actorId: string) {
    this.host.requireActor(actorId);
    return this.host.state.getActorState(actorId);
  }

  getActorBackground(actorId: string): WorldActorBackgroundState | undefined {
    this.host.requireActor(actorId);
    const background = this.host.state.actorBackgrounds.get(actorId);
    return background ? {
      ...background,
      sourceEventIds: [...background.sourceEventIds],
    } : undefined;
  }

  getActorControlPolicy(actorId: string) {
    this.host.requireActor(actorId);
    const control = this.host.state.actorControls.get(actorId);
    return control ? {
      ...control,
      policy: { ...control.policy },
    } : undefined;
  }

  setActorPresence(input: WorldSetActorPresenceInput): void {
    this.host.assertNotStopped("change Actor presence");
    this.host.requireActor(input.actorId);
    this.host.actorPresence.transitionActorPresence({
      actorId: input.actorId,
      presence: input.presence,
      status: input.status ?? undefined,
      statusProvided: "status" in input,
      source: "user",
      reason: input.reason,
    });
  }

  setActorParticipation(input: WorldSetActorParticipationInput): void {
    this.host.assertNotStopped("change Actor participation");
    this.host.requireActor(input.actorId);
    this.host.requireContext(input.contextId);
    this.host.actorPresence.transitionActorParticipation({
      ...input,
      source: "user",
    });
  }

  updateActorControlPolicy(input: WorldUpdateActorControlPolicyInput): void {
    this.host.actorPresence.updateActorControlPolicy(input);
  }

  assertContextDisplayNameAvailable(contextId: string, actorId: string): void {
    const actor = this.host.requireActor(actorId);
    const name = actor.card.name;
    for (const existingId of this.host.state.actorIdsInContext(contextId)) {
      if (existingId === actorId) continue;
      const existing = this.host.requireActor(existingId);
      if (existing.card.name === name) {
        throw new Error(
          `Context ${contextId} already contains a participant named ${name}.`,
        );
      }
    }
  }
}
