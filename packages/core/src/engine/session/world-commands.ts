import type {
  CharacterCard,
  CharacterState,
  Relation,
} from "../../contracts/chat.js";
import type { DebugEmitter } from "../../observability/debug/index.js";
import type { RuntimeNotification } from "../../runtime/index.js";
import type { HarnessTriggerInput, HarnessTriggerQueue, TriggerEnqueueResult } from "../events/index.js";
import type { HumanParticipant } from "../input/index.js";
import type { CharacterRuntimeState } from "../queues/index.js";
import type { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { SessionActorRuntime } from "./actor-runtime.js";
import type { SessionOutputRuntime } from "./output-runtime.js";
import type { ContextBuilder } from "../../context/index.js";
import type { SessionState } from "../state.js";
import type { ActorWakeRequest, WorldSessionBinding } from "../world/session-binding.js";

export interface SessionWorldCommandHost {
  readonly contextBuilder: ContextBuilder;
  readonly state: SessionState;
  readonly debug: DebugEmitter;
  readonly triggerQueue: HarnessTriggerQueue;
  readonly generatingQueue: GeneratingMessageQueue;
  readonly scheduledQueue: ScheduledMessageQueue;
  readonly characterRuntime: Map<string, CharacterRuntimeState>;
  readonly actorRuntime: SessionActorRuntime;
  readonly outputRuntime: SessionOutputRuntime;
  readonly worldBinding?: WorldSessionBinding;
  readonly isGroupConversation: boolean;

  autonomousIdleEnabled(): boolean;
  getCharacterState(characterName: string): CharacterState | undefined;
  getCharacterRuntime(characterName: string): CharacterRuntimeState | undefined;
  setCharacterRuntime(characterName: string, runtime: CharacterRuntimeState): void;
  enqueueTrigger(trigger: HarnessTriggerInput): TriggerEnqueueResult;
  handleWorldActorRuntimeState(characterName: string): void;
  cancelCharacterWork(characterName: string, reason: string): void;
  computeInitialIdleSec(characterName: string, state?: CharacterState): number;
  now(): number;
  wakeHarness(reason: string): void;
  notify(type: RuntimeNotification["type"], payload: Record<string, unknown>): void;
  hasPendingCharacterOutput(characterName: string): boolean;
}

export function receiveWorldEvent(
  host: SessionWorldCommandHost,
  message: string,
  targetCharacterNames: readonly string[],
): void {
  const validNames = new Set(host.contextBuilder.input.characters.map((character) => character.name));
  const targets = targetCharacterNames.filter((name) => validNames.has(name));
  if (targets.length === 0) return;
  for (const target of targets) {
    host.enqueueTrigger({
      type: "event",
      target,
      message,
      priority: 80,
    });
  }
  host.wakeHarness("world_event");
}

export function requestCharacterWake(
  host: SessionWorldCommandHost,
  request: ActorWakeRequest,
): TriggerEnqueueResult {
  if (!host.worldBinding) {
    throw new Error("Character wake requests are only available to World sessions.");
  }
  const character = host.contextBuilder.input.characters.find(
    (candidate) => candidate.name === request.characterName,
  );
  if (!character || host.getCharacterState(character.name)?.availability !== "available") {
    host.debug.emit({
      type: "actor.wake_skipped",
      characterName: request.characterName,
      source: request.source,
      reason: "target unavailable or outside context",
    });
    return "target_busy";
  }
  const result = host.enqueueTrigger({
    type: "wake",
    target: character.name,
    source: request.source,
    reason: request.reason,
    message: request.reason,
    messageId: request.messageId,
    requiresReply: request.requiresReply,
    turnId: request.chainId,
    priority: request.priority,
  });
  if (result === "enqueued") {
    host.debug.emit({
      type: "actor.wake_enqueued",
      characterName: character.name,
      source: request.source,
      reason: request.reason,
      result,
      priority: request.priority,
      messageId: request.messageId,
      chainId: request.chainId,
    });
  } else {
    host.debug.emit({
      type: "actor.wake_skipped",
      characterName: character.name,
      source: request.source,
      reason: request.reason,
      result,
      priority: request.priority,
      messageId: request.messageId,
      chainId: request.chainId,
    });
  }
  return result;
}

export function handleWorldActorRuntimeState(
  host: SessionWorldCommandHost,
  characterName: string,
): void {
  const state = host.getCharacterState(characterName);
  const runtime = host.getCharacterRuntime(characterName) ?? { characterName };
  if (state?.availability === "unavailable") {
    host.cancelCharacterWork(characterName, "actor unavailable");
    host.characterRuntime.set(characterName, host.autonomousIdleEnabled()
      ? {
          ...runtime,
          idleCheckAt: undefined,
          idleRevision: undefined,
          idleReason: undefined,
          passiveBackoffCount: 0,
        }
      : { characterName });
    return;
  }
  if (state?.availability === "away") {
    // Away means the Actor is not accepting new generation work. Already
    // queued or in-flight work must be cancelled before the transition.
    host.cancelCharacterWork(characterName, "actor away");
    host.characterRuntime.set(characterName, host.autonomousIdleEnabled()
      ? {
          ...runtime,
          idleCheckAt: undefined,
          idleRevision: undefined,
          idleReason: undefined,
          passiveBackoffCount: 0,
        }
      : { characterName });
    host.wakeHarness("actor_away");
    return;
  }
  if (host.isGroupConversation) {
    // Returning online only makes the Actor eligible for the next activity.
    host.characterRuntime.set(characterName, {
      ...runtime,
      characterName,
      idleCheckAt: undefined,
      idleRevision: undefined,
      idleReason: undefined,
      passiveBackoffCount: 0,
    });
    host.wakeHarness("actor_online");
    return;
  }
  if (host.autonomousIdleEnabled() && !runtime.idleCheckAt) {
    const delaySec = host.computeInitialIdleSec(characterName, state);
    host.characterRuntime.set(characterName, {
      ...runtime,
      idleCheckAt: host.now() + delaySec * 1000,
      passiveBackoffCount: 0,
    });
  }
  host.wakeHarness("actor_online");
}

export function syncWorldRoster(
  host: SessionWorldCommandHost,
  input: {
    characters: readonly CharacterCard[];
    humans: readonly HumanParticipant[];
    relations: readonly Relation[];
  },
  assertUniqueParticipantNames: (
    characters: readonly CharacterCard[],
    humans: readonly HumanParticipant[],
  ) => void,
): void {
  if (!host.worldBinding) {
    throw new Error("Dynamic roster updates are only available to World sessions.");
  }
  assertUniqueParticipantNames(input.characters, input.humans);

  const nextNames = new Set(input.characters.map((character) => character.name));
  for (const current of [...host.contextBuilder.input.characters]) {
    if (nextNames.has(current.name)) continue;
    host.cancelCharacterWork(current.name, "actor left context");
    host.state.characterStates.delete(current.name);
    host.characterRuntime.delete(current.name);
  }

  const previousNames = new Set(
    host.contextBuilder.input.characters.map((character) => character.name),
  );
  host.contextBuilder.input.characters.splice(
    0,
    host.contextBuilder.input.characters.length,
    ...input.characters.map((character) => ({ ...character })),
  );
  host.contextBuilder.input.humans.splice(
    0,
    host.contextBuilder.input.humans.length,
    ...input.humans.map((human) => ({ ...human })),
  );
  host.contextBuilder.input.relations.splice(
    0,
    host.contextBuilder.input.relations.length,
    ...input.relations.map((relation) => ({ ...relation })),
  );

  for (const character of input.characters) {
    if (previousNames.has(character.name)) continue;
    host.state.characterStates.set(character.name, {
      characterName: character.name,
      availability: "available",
      attention: "active",
      updatedAt: host.now(),
      source: "system",
    });
    host.characterRuntime.set(character.name, { characterName: character.name });
    host.handleWorldActorRuntimeState(character.name);
  }
  host.wakeHarness("world_roster_changed");
}

export function cancelCharacterWork(
  host: SessionWorldCommandHost,
  characterName: string,
  reason: string,
): void {
  host.actorRuntime.abort(characterName);
  for (const trigger of host.triggerQueue.removeTarget(characterName)) {
    host.debug.emit({
      type: "harness.trigger_skipped",
      target: characterName,
      triggerType: trigger.type,
      reason,
    });
    host.actorRuntime.settleActorWake(trigger, characterName, "cancelled");
  }
  for (const item of host.generatingQueue.cancelSpeaker(characterName)) {
    host.debug.emit({
      type: "queue.message_dropped",
      messageId: item.id,
      speaker: characterName,
      reason,
    });
    host.notify("queue.message_cancelled", {
      messageId: item.id,
      speaker: characterName,
      reason,
      phase: "generating",
    });
  }
  for (const message of host.scheduledQueue.cancelSpeaker(characterName)) {
    host.debug.emit({
      type: "queue.message_dropped",
      messageId: message.id,
      speaker: characterName,
      reason,
    });
    host.notify("queue.message_cancelled", {
      messageId: message.id,
      speaker: characterName,
      reason,
      phase: "scheduled",
    });
  }
  host.outputRuntime.refreshScheduleCursor();
  if (!host.hasPendingCharacterOutput(characterName)) {
    host.worldBinding?.onActorOutputDrained(characterName);
  }
  host.wakeHarness("character_work_cancelled");
}

export function getCharacterWakeStatus(
  host: SessionWorldCommandHost,
  characterName: string,
): "ready" | "queued" | "generating" | "scheduled" | "cooldown" | "unavailable" {
  const state = host.getCharacterState(characterName);
  if (!state || state.availability !== "available") return "unavailable";
  if (host.generatingQueue.hasSpeaker(characterName)) return "generating";
  if (host.scheduledQueue.all.some((message) => message.speaker === characterName)) {
    return "scheduled";
  }
  if (host.triggerQueue.all.some((trigger) => trigger.target === characterName)) {
    return "queued";
  }
  if (
    host.autonomousIdleEnabled() &&
    (host.getCharacterRuntime(characterName)?.mutedUntil ?? 0) > host.now()
  ) {
    return "cooldown";
  }
  return "ready";
}
