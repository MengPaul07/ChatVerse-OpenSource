import type {
  ProviderUsageEvent,
  ProviderUsageEventListener,
  ProviderUsageObservation,
  ProviderUsageRole,
} from "../../../contracts/provider.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { DebugEvent } from "../../../observability/debug/index.js";
import {
  WorldDebugEmitter,
  type WorldDebugConfig,
  type WorldDebugListener,
} from "../../../observability/world-debug/index.js";
import type { WorldDirectorTrace } from "../director/index.js";
import type { ProviderSessionEvent } from "../../../observability/provider-session.js";
import {
  debugCategoryForSessionEvent,
  summarizeToolCalls,
} from "./helpers.js";

type TracedProviderRole = Extract<
  ProviderUsageRole,
  "world_director" | "world_narrator" | "player_actor" | "actor_memory"
>;

/** Owns observation-only diagnostics for a World without touching its state. */
export class WorldDiagnosticsRuntime {
  readonly emitter: WorldDebugEmitter;
  private readonly providerUsageListeners = new Set<ProviderUsageEventListener>();

  constructor(
    config: boolean | WorldDebugConfig | undefined,
    worldId: string,
    runtime: RuntimeHost,
  ) {
    this.emitter = new WorldDebugEmitter(config, worldId, runtime);
  }

  onDebug(listener: WorldDebugListener): () => void {
    return this.emitter.on(listener);
  }

  onProviderUsage(listener: ProviderUsageEventListener): () => void {
    this.providerUsageListeners.add(listener);
    return () => this.providerUsageListeners.delete(listener);
  }

  traceSession(
    contextId: string,
    nameToActorId: ReadonlyMap<string, string>,
    event: DebugEvent,
  ): void {
    const source = event as DebugEvent & {
      characterName?: string;
      speaker?: string;
      target?: string;
    };
    const characterName = source.characterName ?? source.speaker ?? source.target;
    const {
      id: sessionDebugEventId,
      sessionId,
      timestamp,
      type,
      turnId,
      ...payload
    } = event as DebugEvent & Record<string, unknown>;
    this.emitter.emit({
      category: debugCategoryForSessionEvent(type),
      type,
      level: type.includes("error") ? "error" : "trace",
      contextId,
      actorId: characterName ? nameToActorId.get(characterName) : undefined,
      correlationId: typeof turnId === "string" ? turnId : undefined,
      payload: {
        sessionDebugEventId,
        sessionId,
        sessionTimestamp: timestamp,
        ...payload,
      },
    });
  }

  traceDirector(event: WorldDirectorTrace): void {
    const payload = event.type === "prompt"
      ? {
          round: event.round,
          messageCount: event.payload.messageCount,
          toolCount: event.payload.toolCount,
          referenceMap: event.payload.referenceMap,
          systemPrompt: this.emitter.config.tracePrompts
            ? event.payload.systemPrompt
            : undefined,
          userPrompt: this.emitter.config.tracePrompts
            ? event.payload.userPrompt
            : undefined,
        }
      : event.type === "response"
        ? {
            round: event.round,
            elapsedMs: event.payload.elapsedMs,
            content: this.emitter.config.traceResponses
              ? event.payload.content
              : undefined,
            toolCalls: this.emitter.config.traceToolCalls
              ? event.payload.toolCalls
              : summarizeToolCalls(event.payload.toolCalls),
          }
        : {
            round: event.round,
            ...event.payload,
          };
    this.emitter.emit({
      category: event.type === "prompt" ? "provider" : "director",
      type: `director.${event.type}`,
      level: "trace",
      payload,
    });
  }

  traceNarrator(event: {
    type: "prompt" | "response";
    payload: { systemPrompt?: string; userPrompt?: string; response?: string };
  }): void {
    this.emitter.emit({
      category: event.type === "prompt" ? "provider" : "world",
      type: `narrator.${event.type}`,
      level: "trace",
      payload: event.type === "prompt"
        ? {
            systemPrompt: this.emitter.config.tracePrompts ? event.payload.systemPrompt : undefined,
            userPrompt: this.emitter.config.tracePrompts ? event.payload.userPrompt : undefined,
          }
        : {
            response: this.emitter.config.traceResponses ? event.payload.response : undefined,
          },
    });
  }

  traceActorMemory(event: {
    type: "prompt" | "response";
    actorIds: string[];
    payload: Record<string, unknown>;
  }): void {
    this.emitter.emit({
      category: event.type === "prompt" ? "provider" : "memory",
      type: `actor_memory.${event.type}`,
      level: "trace",
      actorId: event.actorIds.length === 1 ? event.actorIds[0] : undefined,
      payload: event.type === "prompt"
        ? {
            actorIds: event.payload.actorIds,
            eventCount: event.payload.eventCount,
            recalledNodeIds: event.payload.recalledNodeIds,
            systemPrompt: this.emitter.config.tracePrompts
              ? event.payload.systemPrompt
              : undefined,
            userPrompt: this.emitter.config.tracePrompts
              ? event.payload.userPrompt
              : undefined,
          }
        : {
            actorIds: event.payload.actorIds,
            response: this.emitter.config.traceResponses
              ? event.payload.response
              : undefined,
          },
    });
  }

  traceProviderUsage(
    providerRole: TracedProviderRole,
    observation: ProviderUsageObservation,
  ): void {
    this.publishProviderUsage({ providerRole, ...observation });
    this.emitter.emit({
      category: "provider",
      type: "provider.usage",
      level: "info",
      contextId: observation.requestContext?.contextId,
      actorId: observation.requestContext?.actorId,
      correlationId: observation.requestContext?.turnId,
      payload: {
        providerRole,
        operation: observation.operation,
        requestContext: observation.requestContext,
        usage: observation.usage,
      },
    });
  }

  traceProviderSession(event: ProviderSessionEvent): void {
    const requestContext = event.requestContext;
    this.emitter.emit({
      category: event.type === "error" ? "error" : "provider",
      type: `provider.session_${event.type}`,
      level: event.type === "error" ? "error" : "trace",
      contextId: requestContext?.contextId,
      actorId: requestContext?.actorId,
      correlationId: event.requestId,
      payload: {
        ...event,
        requestContext,
      },
    });
  }

  publishProviderUsage(event: ProviderUsageEvent): void {
    for (const listener of [...this.providerUsageListeners]) {
      try {
        listener(structuredClone(event));
      } catch {
        // Usage observers cannot interrupt a successful model request.
      }
    }
  }
}
