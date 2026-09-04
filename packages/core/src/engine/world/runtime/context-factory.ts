import type { ActorAction, ChatMessage } from "../../../contracts/chat.js";
import type { ProviderUsageEvent } from "../../../contracts/provider.js";
import type { WorldContextDefinition, WorldSnapshot } from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { DebugEvent } from "../../../observability/debug/index.js";
import type { WorldDebugEmitter } from "../../../observability/world-debug/index.js";
import type { ActorGenerationCoordinator } from "../actor-coordinator.js";
import type { ProviderFailureDetails } from "../../provider-failure.js";
import type { ActorWakeRequest, ActorWakeSettlement } from "../session-binding.js";
import type { WorldState } from "../state.js";
import type { ActorRuntimeBridge } from "./actor-runtime.js";
import {
  createChatContextRuntime,
  type ChatContextRuntime,
  type ContextRuntimeFactoryOptions,
} from "./context-runtime.js";
import type { WorldMemoryRuntime } from "./memory-runtime.js";
import type { TimelineRuntime } from "./timeline-runtime.js";

export interface WorldContextRuntimeFactoryHost {
  state: WorldState;
  directorEnabled: boolean;
  characterProvider: ContextRuntimeFactoryOptions["characterProvider"];
  compressionProvider: ContextRuntimeFactoryOptions["compressionProvider"];
  runtime: RuntimeHost;
  debug: WorldDebugEmitter;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  actorRuntimeBridge: ActorRuntimeBridge;
  actorCoordinator: ActorGenerationCoordinator;
  timelineRuntime: TimelineRuntime;
  memoryRuntime: WorldMemoryRuntime;
  readActorState: ContextRuntimeFactoryOptions["readActorState"];
  applyActorStatePatch: ContextRuntimeFactoryOptions["applyActorStatePatch"];
  commitContextActorAction(
    contextId: string,
    actorId: string | undefined,
    action: ActorAction,
  ): void;
  projectActorHistory: ContextRuntimeFactoryOptions["projectActorHistory"];
  forwardSessionDebug(
    contextId: string,
    nameToActorId: ReadonlyMap<string, string>,
    event: DebugEvent,
  ): void;
  publishProviderUsage(event: ProviderUsageEvent): void;
}

export interface WorldContextRuntimeCollectionHost
  extends Omit<WorldContextRuntimeFactoryHost, "getContextRuntime" | "projectActorHistory"> {
  contextRuntimes: Map<string, ChatContextRuntime>;
}

/** Assembles one Context's Session and its World binding. */
function createWorldContextRuntime(
  host: WorldContextRuntimeFactoryHost,
  context: WorldContextDefinition,
  restored?: import("../../../contracts/chat.js").SessionSnapshot,
): ChatContextRuntime {
  const runtime = createChatContextRuntime({
    context,
    restored,
    state: host.state,
    directorEnabled: host.directorEnabled,
    characterProvider: host.characterProvider,
    compressionProvider: host.compressionProvider,
    runtime: host.runtime,
    debug: host.debug,
    getContextRuntime: host.getContextRuntime,
    readActorState: host.readActorState,
    applyActorStatePatch: host.applyActorStatePatch,
    commitActorAction: host.commitContextActorAction,
    projectActorHistory: host.projectActorHistory,
    timelineBlockForActor: (contextId, actorId) => (
      host.timelineRuntime.blockForActor(contextId, actorId)
    ),
    recallActorMemory: (contextId, actorId, messages, nameToActorId) => (
      host.memoryRuntime.recallForContext(contextId, actorId, messages, nameToActorId)
    ),
    readCurrentScene: (contextId) => host.state.contexts.get(contextId)?.scene,
    acquireGeneration: (actorId, priority, signal) => (
      host.actorCoordinator.acquire(actorId, priority, signal)
    ),
    onProviderError: (contextId, error: ProviderFailureDetails) => (
      host.actorRuntimeBridge.handleActorProviderError(contextId, error)
    ),
    onActorWakeStarted: (contextId, nameToActorId, request: ActorWakeRequest) => {
      host.actorRuntimeBridge.onActorWakeStarted(contextId, nameToActorId, request);
    },
    onActorWakeSettled: (contextId, settlement: ActorWakeSettlement) => {
      host.actorRuntimeBridge.handleActorWakeSettlement(contextId, settlement);
    },
    onActorOutputDrained: (contextRuntime, actorId, producedOutput) => {
      host.actorRuntimeBridge.handleActorOutputDrained(contextRuntime, actorId, producedOutput);
    },
    forwardSessionDebug: host.forwardSessionDebug,
    publishProviderUsage: host.publishProviderUsage,
  });
  return runtime;
}

/** Creates and restores Context runtimes against one shared registry. */
export class WorldContextRuntimeFactory {
  private readonly projectActorHistory = (
    contextId: string,
    actorId: string,
    messages: readonly ChatMessage[],
    actions: readonly ActorAction[],
  ): {
    messages: readonly ChatMessage[];
    actions: readonly ActorAction[];
    includeDigest: boolean;
  } => {
    const presence = this.host.state.getPresence(contextId, actorId);
    const joinedAt = presence?.joinedAtSequence ?? 0;
    if (joinedAt <= 0) return { messages, actions, includeDigest: true };

    const messageIds = new Set<string>();
    const actionIds = new Set<string>();
    for (const event of this.host.state.journal.read(joinedAt)) {
      if (event.contextId !== contextId) continue;
      if (event.type === "context.message.committed") {
        if (event.payload.message.id) messageIds.add(event.payload.message.id);
      } else if (event.type === "context.action.committed") {
        if (event.payload.action.id) actionIds.add(event.payload.action.id);
      }
    }
    return {
      messages: messages.filter((message) => messageIds.has(message.id)),
      actions: actions.filter((action) => actionIds.has(action.id)),
      includeDigest: false,
    };
  };

  constructor(private readonly host: WorldContextRuntimeCollectionHost) {}

  create(
    context: WorldContextDefinition,
    restored?: import("../../../contracts/chat.js").SessionSnapshot,
  ): ChatContextRuntime {
    const runtime = createWorldContextRuntime({
      ...this.host,
      getContextRuntime: (contextId) => this.host.contextRuntimes.get(contextId),
      projectActorHistory: this.projectActorHistory,
    }, context, restored);
    this.host.contextRuntimes.set(context.id, runtime);
    return runtime;
  }

  createAll(
    contexts: readonly WorldContextDefinition[],
    snapshot?: WorldSnapshot,
  ): void {
    for (const context of contexts) {
      const restored = snapshot?.contextSessions.find(
        (item) => item.contextId === context.id,
      )?.snapshot;
      this.create(context, restored);
    }
  }
}
