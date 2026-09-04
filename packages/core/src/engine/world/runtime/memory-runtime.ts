import type {
  ActorMemoryCommit,
  ActorMemoryRecallQuery,
  ActorMemorySlice,
} from "../../../contracts/actor-memory.js";
import type { ChatMessage } from "../../../contracts/chat.js";
import type {
  NarrativeBeat,
  ResolvedWorldActorMemoryPolicy,
  WorldEvent,
  WorldEventPayloadMap,
  WorldRelation,
} from "../../../contracts/world.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { WorldState } from "../state.js";
import { InMemoryActorMemoryStore } from "../../actor-memory/in-memory.js";
import {
  memoryEventText,
  unique,
} from "./helpers.js";
import { isPlayerControlledActor } from "../persistence/definition.js";

export type MemoryRelationEvent = {
  type: "relation.updated";
  actorId: string;
  causationId?: string;
  payload: WorldEventPayloadMap["relation.updated"];
} | {
  type: "relation.removed";
  actorId: string;
  causationId?: string;
  payload: WorldEventPayloadMap["relation.removed"];
};

export interface WorldMemoryRuntimeOptions {
  state: WorldState;
  store: InMemoryActorMemoryStore;
  policy: ResolvedWorldActorMemoryPolicy;
  contextRuntimes: ReadonlyMap<string, ChatContextRuntime>;
  getActiveBeat(contextId: string): NarrativeBeat | undefined;
  isStopped(): boolean;
  appendMemoryUpdate(commit: ActorMemoryCommit, sourceEvents: readonly WorldEvent[]): void;
  appendRelationEvent(event: MemoryRelationEvent): void;
  syncContextRoster(contextId: string): void;
}

/** Bridges the Actor memory store with World projections without owning curation. */
export class WorldMemoryRuntime {
  private readonly relationTargets = new Map<string, Set<string>>();

  constructor(private readonly options: WorldMemoryRuntimeOptions) {}

  recallForContext(
    contextId: string,
    actorId: string,
    messages: readonly ChatMessage[],
    nameToActorId: ReadonlyMap<string, string>,
  ): ActorMemorySlice {
    if (!this.options.policy.enabled) return emptySlice(actorId);
    const recent = messages.slice(-10);
    const relatedActorIds = new Set<string>();
    for (const message of recent) {
      const relatedActorId = nameToActorId.get(message.characterName);
      if (relatedActorId && relatedActorId !== actorId) {
        relatedActorIds.add(`actor:${relatedActorId}`);
      }
    }
    for (const relatedActorId of this.options.state.actorIdsInContext(contextId)) {
      if (relatedActorId !== actorId) relatedActorIds.add(`actor:${relatedActorId}`);
    }
    const scene = this.options.state.contexts.get(contextId)?.scene.text ?? "";
    const beat = this.options.getActiveBeat(contextId);
    const query: ActorMemoryRecallQuery = {
      actorId,
      contextId,
      query: [
        scene,
        beat ? `${beat.title}\n${beat.brief}` : "",
        ...recent.map((message) => message.message),
      ].filter(Boolean).join("\n"),
      relatedActorIds: [...relatedActorIds],
      maxNodes: 6,
      maxRelationNodes: 0,
      maxCommitmentNodes: 2,
      maxTokens: 360,
    };
    return this.options.store.recall(query);
  }

  recallForEvents(actorId: string, events: readonly WorldEvent[]): ActorMemorySlice {
    if (!this.options.policy.enabled) return emptySlice(actorId);
    const contextIds = unique(events
      .map((event) => event.contextId)
      .filter((contextId): contextId is string => Boolean(contextId)));
    const relatedActorIds = new Set<string>();
    for (const contextId of contextIds) {
      const context = this.options.state.definition.contexts.find((item) => item.id === contextId);
      for (const relatedActorId of context?.actorIds ?? []) {
        if (relatedActorId !== actorId) relatedActorIds.add(`actor:${relatedActorId}`);
      }
    }
    return this.options.store.recall({
      actorId,
      query: events.map(memoryEventText).join("\n"),
      relatedActorIds: [...relatedActorIds],
      maxNodes: 6,
      includeInactive: true,
      maxInactiveNodes: 2,
      maxTokens: 700,
    });
  }

  initializeRelations(): void {
    for (const actor of this.options.state.actorDefinitions.values()) {
      if (isPlayerControlledActor(actor)) continue;
      const projected = this.projectRelations(actor.id);
      this.relationTargets.set(actor.id, new Set(projected.keys()));
      for (const relation of projected.values()) {
        this.options.state.upsertRelation(relation.relation);
      }
    }
  }

  commitAutomaticUpdate(
    commit: ActorMemoryCommit,
    sourceEvents: readonly WorldEvent[],
  ): void {
    if (!commit.applied || this.options.isStopped()) return;
    this.options.appendMemoryUpdate(commit, sourceEvents);
    this.syncRelations(commit.actorId, sourceEvents[sourceEvents.length - 1]?.id);
  }

  syncRelations(actorId: string, causationId?: string): void {
    const previousTargets = this.relationTargets.get(actorId) ?? new Set<string>();
    const projected = this.projectRelations(actorId);
    let changed = false;
    for (const projection of projected.values()) {
      const result = this.options.state.upsertRelation(projection.relation);
      if (!result.changed) continue;
      changed = true;
      this.options.appendRelationEvent({
        type: "relation.updated",
        actorId,
        causationId,
        payload: {
          before: result.previous,
          after: projection.relation,
          source: "actor_memory",
          sourceNodeId: projection.nodeId,
        },
      });
    }
    for (const targetActorId of previousTargets) {
      if (projected.has(targetActorId)) continue;
      const result = this.options.state.resetRelation(actorId, targetActorId);
      if (!result.changed || !result.previous) continue;
      changed = true;
      this.options.appendRelationEvent({
        type: "relation.removed",
        actorId,
        causationId,
        payload: {
          before: result.previous,
          restored: result.current,
          source: "actor_memory",
        },
      });
    }
    this.relationTargets.set(actorId, new Set(projected.keys()));
    if (!changed) return;
    for (const context of this.options.contextRuntimes.values()) {
      if (this.options.state.actorIdsInContext(context.definition.id).includes(actorId)) {
        this.options.syncContextRoster(context.definition.id);
      }
    }
  }

  private projectRelations(actorId: string): Map<string, { nodeId: string; relation: WorldRelation }> {
    const snapshot = this.options.store.snapshot(actorId);
    const relationNodes = snapshot.nodes
      .filter((node) => node.kind === "relation" && (node.status ?? "active") === "active")
      .sort((left, right) => (
        (left.updatedAt ?? 0) - (right.updatedAt ?? 0) || left.id.localeCompare(right.id)
      ));
    const projected = new Map<string, { nodeId: string; relation: WorldRelation }>();
    for (const node of relationNodes) {
      for (const edge of snapshot.edges) {
        if (edge.fromNodeId !== node.id || !edge.toId.startsWith("actor:")) continue;
        const targetActorId = edge.toId.slice("actor:".length);
        if (
          !targetActorId ||
          targetActorId === actorId ||
          !this.options.state.actorDefinitions.has(targetActorId)
        ) continue;
        projected.set(targetActorId, {
          nodeId: node.id,
          relation: {
            fromActorId: actorId,
            toActorId: targetActorId,
            description: node.content,
          },
        });
      }
    }
    return projected;
  }

}

function emptySlice(actorId: string): ActorMemorySlice {
  return { actorId, entries: [], estimatedTokens: 0 };
}
