import type {
  ActorAction,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
  SessionConfig,
  SessionSnapshot,
} from "../../../contracts/chat.js";
import type { ChatProvider } from "../../../contracts/provider.js";
import type { ProviderUsageEvent } from "../../../contracts/provider.js";
import type { ActorMemorySlice } from "../../../contracts/actor-memory.js";
import type {
  WorldContextDefinition,
  NarrativeNarration,
  ResolvedWorldActorRuntimePolicy,
} from "../../../contracts/world.js";
import type { RuntimeHost, RuntimeTask } from "../../../runtime/types.js";
import type { DebugEvent } from "../../../observability/debug/index.js";
import type { WorldDebugEmitter } from "../../../observability/world-debug/index.js";
import { Session } from "../../session.js";
import { isConversationContext, isPlayerControlledActor, playerParticipantForActor } from "../persistence/definition.js";
import { mergeLoreBooks } from "./helpers.js";
import {
  resolveWorldActorRuntimePolicy,
  resolveWorldBeatRuntimeConfig,
  type ResolvedBeatRuntimeConfig,
} from "./config.js";
import type {
  ActorWakeRequest,
  ActorWakeSettlement,
  WorldSessionBinding,
} from "../session-binding.js";
import type { WorldState } from "../state.js";
import type { ProviderFailureDetails } from "../../provider-failure.js";
import { ContextTurnCoordinator } from "./context-turn-coordinator.js";

export interface ChatContextRuntime {
  definition: WorldContextDefinition;
  session: Session;
  nameToActorId: Map<string, string>;
  actorNameById: Map<string, string>;
  actorRuntime: ResolvedWorldActorRuntimePolicy;
  beatRuntime: ResolvedBeatRuntimeConfig;
  started: boolean;
  runTask?: Promise<void>;
  suspendTask?: RuntimeTask;
  ambientTask?: RuntimeTask;
  turnCoordinator: ContextTurnCoordinator;
  debugUnsubscribe?: () => void;
  usageUnsubscribe?: () => void;
}

export interface ContextRuntimeFactoryOptions {
  context: WorldContextDefinition;
  restored?: SessionSnapshot;
  state: WorldState;
  directorEnabled: boolean;
  characterProvider: ChatProvider;
  compressionProvider: ChatProvider;
  runtime: RuntimeHost;
  debug: WorldDebugEmitter;
  getContextRuntime: (contextId: string) => ChatContextRuntime | undefined;
  readActorState: (
    contextId: string,
    actorId: string,
  ) => Pick<CharacterState, "availability" | "attention" | "mood" | "intent" | "note" | "updatedAt"> | undefined;
  applyActorStatePatch: (
    contextId: string,
    actorId: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ) => void;
  commitActorAction: (contextId: string, actorId: string | undefined, action: ActorAction) => void;
  projectActorHistory: (
    contextId: string,
    actorId: string,
    messages: readonly ChatMessage[],
    actions: readonly ActorAction[],
  ) => { messages: readonly ChatMessage[]; actions: readonly ActorAction[]; includeDigest: boolean };
  timelineBlockForActor: (contextId: string, actorId: string) => string;
  recallActorMemory: (
    contextId: string,
    actorId: string,
    messages: readonly ChatMessage[],
    nameToActorId: ReadonlyMap<string, string>,
  ) => ActorMemorySlice | undefined;
  readCurrentScene: (contextId: string) => NarrativeNarration | undefined;
  acquireGeneration: (actorId: string, priority: number, signal?: AbortSignal) => Promise<() => void>;
  onProviderError: (contextId: string, error: ProviderFailureDetails) => boolean;
  onActorWakeStarted: (
    contextId: string,
    nameToActorId: ReadonlyMap<string, string>,
    request: ActorWakeRequest,
  ) => void;
  onActorWakeSettled: (contextId: string, settlement: ActorWakeSettlement) => void;
  onActorOutputDrained: (
    context: ChatContextRuntime,
    actorId: string,
    producedOutput: boolean,
  ) => void;
  forwardSessionDebug: (
    contextId: string,
    nameToActorId: ReadonlyMap<string, string>,
    event: DebugEvent,
  ) => void;
  publishProviderUsage: (event: ProviderUsageEvent) => void;
}
export function createChatContextRuntime(
  options: ContextRuntimeFactoryOptions,
): ChatContextRuntime {
  const {
    context,
    state,
  } = options;
  const actorRuntime = resolveWorldActorRuntimePolicy(
    context.runtime?.actorRuntime,
    options.directorEnabled || isConversationContext(context),
  );
  const beatRuntime = resolveWorldBeatRuntimeConfig(context.runtime?.beatRuntime);
  const actors = state.actorIdsInContext(context.id).map((actorId) => {
    const actor = state.getActorDefinition(actorId);
    if (!actor) throw new Error(`Unknown world actor: ${actorId}`);
    return actor;
  });
  const characters = actors
    .filter((actor) => !isPlayerControlledActor(actor))
    .map((actor) => actor.card);
  const humans = actors
    .filter(isPlayerControlledActor)
    .map(playerParticipantForActor);
  const nameToActorId = new Map<string, string>();
  for (const actor of actors) {
    const name = actor.card.name;
    if (nameToActorId.has(name)) {
      throw new Error(`Context ${context.id} contains duplicate actor display name: ${name}`);
    }
    nameToActorId.set(name, actor.id);
  }
  const actorNameById = new Map([...nameToActorId].map(([name, actorId]) => [actorId, name]));
  const relations = state.relations
    .filter((relation) => actorNameById.has(relation.fromActorId) && actorNameById.has(relation.toActorId))
    .map((relation) => ({
      from: actorNameById.get(relation.fromActorId)!,
      to: actorNameById.get(relation.toActorId)!,
      description: relation.description,
    }));
  const config: SessionConfig = {
    characters,
    humans,
    worldBook: mergeLoreBooks(state.definition.lore, context.lore),
    scene: context.scene,
    relations,
    conversationMode: context.conversationMode,
    pacingMultiplier: context.runtime?.pacingMultiplier,
    interventionCommitWindowMs: context.runtime?.interventionCommitWindowMs,
    forceSpeakAfterConsecutiveSilents: context.runtime?.forceSpeakAfterConsecutiveSilents,
    messageStyle: context.runtime?.messageStyle,
    // World uses the incremental Context Timeline as its history compression
    // layer. Session compression is reserved for Group and private chat flows.
    contextCompression: { historyTokenThreshold: 0 },
    initialMessages: options.restored?.messages,
    debug: options.debug.enabled ? {
      enabled: true,
      tracePrompts: options.debug.config.tracePrompts,
      traceResponses: options.debug.config.traceResponses,
      traceToolCalls: options.debug.config.traceToolCalls,
      traceTiming: true,
      maxEvents: Math.min(options.debug.config.maxEvents, 1_000),
    } : undefined,
  };
  const binding: WorldSessionBinding = {
    contextId: context.id,
    actorScheduling: actorRuntime.activation === "autonomous_idle"
      ? "autonomous_idle"
      : "external_wake",
    getActorMaxTokens: () => options.getContextRuntime(context.id)?.beatRuntime.actorMaxTokens,
    actorIdForCharacter: (characterName) => nameToActorId.get(characterName),
    readActorState: (actorId) => options.readActorState(context.id, actorId),
    readActorRevision: (actorId) => state.actorStates.get(actorId)?.revision,
    readActorBackground: (actorId) => state.actorBackgrounds.get(actorId)?.text,
    applyActorStatePatch: (actorId, patch, source) => {
      options.applyActorStatePatch(context.id, actorId, patch, source);
    },
    commitActorAction: (action) => {
      options.commitActorAction(context.id, nameToActorId.get(action.characterName), action);
    },
    projectActorHistory: (actorId, messages, actions) => (
      options.projectActorHistory(context.id, actorId, messages, actions)
    ),
    getWorldTimelineBlock: (actorId) => options.timelineBlockForActor(context.id, actorId),
    recallActorMemory: (actorId, messages) => {
      const visible = options.projectActorHistory(context.id, actorId, messages, []);
      return options.recallActorMemory(context.id, actorId, visible.messages, nameToActorId);
    },
    readCurrentScene: () => options.readCurrentScene(context.id),
    acquireGeneration: (actorId, priority, signal) => (
      options.acquireGeneration(actorId, priority, signal)
    ),
    onProviderError: (error) => options.onProviderError(context.id, error),
    onActorWakeStarted: (request) => {
      options.onActorWakeStarted(context.id, nameToActorId, request);
    },
    onActorWakeSettled: (settlement) => {
      options.onActorWakeSettled(context.id, settlement);
    },
    onActorOutputDrained: (characterName, producedOutput = false) => {
      const actorId = nameToActorId.get(characterName);
      const runtime = options.getContextRuntime(context.id);
      if (!actorId || !runtime) return;
      options.onActorOutputDrained(runtime, actorId, producedOutput);
    },
  };
  const session = new Session(
    config,
    {
      character: options.characterProvider,
      compression: options.compressionProvider,
    },
    options.runtime,
    binding,
    options.restored,
  );
  const debugUnsubscribe = session.onDebugEvent((event) => {
    options.forwardSessionDebug(context.id, nameToActorId, event);
  });
  const usageUnsubscribe = session.onProviderUsage((event) => {
    options.publishProviderUsage(event);
  });
  return {
    definition: context,
    session,
    nameToActorId,
    actorNameById,
    actorRuntime,
    beatRuntime,
    started: false,
    turnCoordinator: new ContextTurnCoordinator(),
    debugUnsubscribe,
    usageUnsubscribe,
  };
}
