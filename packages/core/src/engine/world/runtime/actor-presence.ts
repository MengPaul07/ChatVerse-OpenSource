import type {
  ActorPresence,
  ActorStateSource,
  ContextParticipation,
  ResolvedWorldDirectorPolicy,
  WorldActorDefinition,
  WorldEvent,
  WorldEventInput,
  WorldEventType,
  WorldNotificationPayloadMap,
  WorldNotificationType,
  WorldUpdateActorControlPolicyInput,
} from "../../../contracts/world.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import { presenceKey, type WorldState } from "../state.js";
import {
  authorityRank,
  minimumAuthority,
} from "./helpers.js";
import { isPlayerControlledActor } from "../persistence/definition.js";

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

export interface ActorPresenceRuntimeHost {
  readonly state: WorldState;
  readonly policy: ResolvedWorldDirectorPolicy;
  now(): number;
  isStopped(): boolean;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  getContextRuntimes(): Iterable<ChatContextRuntime>;
  requireActor(actorId: string): WorldActorDefinition;
  requireContext(contextId: string): ChatContextRuntime;
  assertContextDisplayNameAvailable(contextId: string, actorId: string): void;
  syncContextRoster(contextId: string): void;
  pruneContextFocus(contextId: string, reason: string): void;
  activateContext(contextId: string): void;
  considerDirectorWork(immediate: boolean): void;
  appendEvent<TType extends WorldEventType>(input: WorldEventInput<TType>): WorldEvent<TType>;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Owns durable Actor presence, Context participation and control checks. */
export class ActorPresenceRuntime {
  constructor(private readonly host: ActorPresenceRuntimeHost) {}

  transitionActorPresence(input: ActorPresenceTransition): boolean {
    if (this.host.isStopped()) return false;
    const previous = this.host.state.actorStates.get(input.actorId);
    if (!previous) return false;
    const presenceChanged = previous.presence !== input.presence;
    if (
      presenceChanged &&
      !this.canControlActor(input.actorId, input.source, "presence")
    ) {
      this.host.notify("world.error", {
        actorId: input.actorId,
        operation: "set_actor_presence",
        source: input.source,
        message: "Actor presence change denied by control policy.",
      });
      return false;
    }

    const next = {
      ...previous,
      presence: input.presence,
      status: input.statusProvided
        ? input.status || undefined
        : previous.status,
      revision: previous.revision + 1,
      updatedAt: this.host.now(),
    };
    const stateChanged = (
      next.presence !== previous.presence ||
      next.status !== previous.status
    );
    if (stateChanged) {
      this.host.state.actorStates.set(input.actorId, next);
      this.host.appendEvent({
        type: "actor.presence.changed",
        contextId: input.contextId,
        actorId: input.actorId,
        causationId: input.causationId,
        payload: {
          before: previous,
          after: next,
          source: input.source,
          reason: input.reason,
        },
      });
    }
    if (!stateChanged) return false;

    this.refreshActorRuntime(input.actorId);
    this.host.considerDirectorWork(false);
    return true;
  }

  transitionActorParticipation(input: ActorParticipationTransition): boolean {
    if (this.host.isStopped()) return false;
    const previous = this.host.state.getPresence(input.contextId, input.actorId) ??
      this.host.state.ensurePresence(
        input.contextId,
        input.actorId,
        this.host.now(),
        this.host.state.journal.lastSequence,
      );
    if (previous.participation === input.participation) return false;
    if (input.participation !== "left") {
      this.host.assertContextDisplayNameAvailable(input.contextId, input.actorId);
    }
    if (!this.canControlActor(
      input.actorId,
      input.source,
      "participation",
      input.participation,
    )) {
      this.host.notify("world.error", {
        actorId: input.actorId,
        contextId: input.contextId,
        operation: "set_actor_participation",
        source: input.source,
        message: "Actor participation change denied by control policy.",
      });
      return false;
    }
    const next = {
      ...previous,
      participation: input.participation,
      joinedAtSequence: input.participation === "joined"
        ? this.host.state.journal.lastSequence + 1
        : previous.joinedAtSequence,
      updatedAt: this.host.now(),
    };
    this.host.state.presences.set(presenceKey(input.contextId, input.actorId), next);
    const actorState = this.host.state.actorStates.get(input.actorId);
    if (actorState) {
      this.host.state.actorStates.set(input.actorId, {
        ...actorState,
        revision: actorState.revision + 1,
        updatedAt: this.host.now(),
      });
    }
    this.host.appendEvent({
      type: "actor.participation.changed",
      contextId: input.contextId,
      actorId: input.actorId,
      causationId: input.causationId,
      payload: {
        before: previous,
        after: next,
        source: input.source,
        reason: input.reason,
      },
    });
    this.host.syncContextRoster(input.contextId);
    this.host.pruneContextFocus(input.contextId, "actor_participation_changed");
    const actor = this.host.requireActor(input.actorId);
    if (!isPlayerControlledActor(actor) && input.participation !== "left") {
      this.host.requireContext(input.contextId).session
        .handleWorldActorRuntimeState(actor.card.name);
    }
    if (input.participation === "joined") {
      this.host.activateContext(input.contextId);
      if (!isPlayerControlledActor(actor)) {
        const runtime = this.host.requireContext(input.contextId);
        if (runtime.actorRuntime.activation === "autonomous_idle") {
          runtime.session.receiveWorldEvent(
            input.reason?.trim()
              ? `你已进入当前情境：${input.reason.trim()}`
              : "你已进入当前情境，请先观察正在发生的事情，再决定是否回应。",
            [actor.card.name],
          );
        }
      }
    }
    this.host.considerDirectorWork(false);
    return true;
  }

  updateActorControlPolicy(input: WorldUpdateActorControlPolicyInput): void {
    if (this.host.isStopped()) {
      throw new Error("Cannot change Actor control policy after the World has stopped.");
    }
    this.host.requireActor(input.actorId);
    const previous = this.host.state.actorControls.get(input.actorId);
    if (!previous) return;
    const next = {
      ...previous,
      policy: {
        directorAuthority: input.policy.directorAuthority ?? previous.policy.directorAuthority,
      },
      updatedAt: this.host.now(),
    };
    this.host.state.actorControls.set(input.actorId, next);
    this.host.appendEvent({
      type: "actor.control.changed",
      actorId: input.actorId,
      payload: { before: previous, after: next, source: "user" },
    });
    this.host.considerDirectorWork(false);
  }

  canControlActor(
    actorId: string,
    source: ActorStateSource,
    operation: "wake" | "participation" | "presence",
    requestedParticipation?: ContextParticipation,
  ): boolean {
    if (source === "user" || source === "system") return true;
    const state = this.host.state.actorStates.get(actorId);
    const control = this.host.state.actorControls.get(actorId);
    if (!state || !control) return false;
    if (source === "actor") {
      if (operation === "participation") {
        return requestedParticipation === "left";
      }
      if (operation !== "presence") return false;
      return true;
    }
    const granted = minimumAuthority(
      this.host.policy.actorAuthority,
      control.policy.directorAuthority,
    );
    return authorityRank(granted) >= authorityRank(
      operation === "wake" ? "coordinate" : "manage",
    );
  }

  actorWakeValidationError(
    actorId: string,
    contextId: string,
    source: ActorStateSource,
    requireRuntimeReady = true,
  ): string | undefined {
    const actor = this.host.state.actorDefinitions.get(actorId);
    if (!actor) return `Unknown actor: ${actorId}`;
    if (isPlayerControlledActor(actor)) return `Actor ${actorId} is player-controlled.`;
    if (!this.host.getContextRuntime(contextId)) return `Unknown context: ${contextId}`;

    const presence = this.host.state.getPresence(contextId, actorId);
    if (!presence || presence.participation !== "joined") {
      return `Actor ${actorId} is not joined to context ${contextId}.`;
    }

    const state = this.host.state.actorStates.get(actorId);
    if (!state) return `Actor state is unavailable: ${actorId}`;
    if (state.presence !== "online") {
      return `Actor ${actorId} is ${state.presence}; only online Actors can be woken.`;
    }
    if (!this.canControlActor(actorId, source, "wake")) {
      return `Wake request is not permitted for actor: ${actorId}`;
    }
    if (!this.host.getContextRuntime(contextId)?.actorNameById.has(actorId)) {
      return `Actor ${actorId} is not available in context runtime ${contextId}.`;
    }
    if (source === "director" && requireRuntimeReady) {
      const runtime = this.host.getContextRuntime(contextId)!;
      const characterName = runtime.actorNameById.get(actorId)!;
      const runtimeStatus = runtime.session.getCharacterWakeStatus(characterName);
      if (runtimeStatus !== "ready") {
        return `Actor ${actorId} is ${runtimeStatus} in context ${contextId}; choose another ready Actor or finish.`;
      }
    }
    return undefined;
  }

  private refreshActorRuntime(actorId: string, onlyContextId?: string): void {
    const actor = this.host.requireActor(actorId);
    if (isPlayerControlledActor(actor)) return;
    for (const runtime of this.host.getContextRuntimes()) {
      if (
        (onlyContextId && runtime.definition.id !== onlyContextId) ||
        this.host.state.getPresence(runtime.definition.id, actorId)?.participation === "left"
      ) continue;
      runtime.session.handleWorldActorRuntimeState(actor.card.name);
      this.host.pruneContextFocus(runtime.definition.id, "actor_presence_changed");
    }
  }
}
