import type {
  ActorMemoryNode,
  ActorMemoryRecallQuery,
  ActorMemorySlice,
  ActorMemorySnapshot,
} from "../../../contracts/actor-memory.js";
import type {
  WorldEvent,
  WorldEventInput,
  WorldRecordActorMemoryInput,
  WorldReviseActorMemoryInput,
} from "../../../contracts/world.js";
import type { InMemoryActorMemoryStore } from "../../actor-memory/index.js";
import type { WorldMemoryRuntime } from "./memory-runtime.js";

interface MemoryCommandsHost {
  actorMemory: InMemoryActorMemoryStore;
  memoryRuntime: Pick<WorldMemoryRuntime, "syncRelations">;
  assertNotStopped(operation: string): void;
  requireActor(actorId: string): void;
  assertMemorySourcesExist(sourceEventIds: readonly string[] | undefined): void;
  appendEvent(
    input: WorldEventInput<"actor.memory.recorded" | "actor.memory.revised">,
  ): WorldEvent;
}

/** Owns explicit Actor memory commands; automatic curation remains separate. */
export class WorldMemoryCommands {
  constructor(private readonly host: MemoryCommandsHost) {}

  recall(
    actorId: string,
    query: Omit<ActorMemoryRecallQuery, "actorId"> = {},
  ): ActorMemorySlice {
    this.host.requireActor(actorId);
    return this.host.actorMemory.recall({ ...query, actorId });
  }

  snapshot(actorId: string): ActorMemorySnapshot {
    this.host.requireActor(actorId);
    return this.host.actorMemory.snapshot(actorId);
  }

  record(input: WorldRecordActorMemoryInput): ActorMemoryNode {
    this.host.assertNotStopped("record Actor memory");
    this.host.requireActor(input.actorId);
    this.host.assertMemorySourcesExist(input.candidate.sourceEventIds);
    const node = this.host.actorMemory.record(input.actorId, input.candidate);
    const event = this.host.appendEvent({
      type: "actor.memory.recorded",
      actorId: input.actorId,
      payload: {
        nodeId: node.id,
        kind: node.kind,
        sourceEventIds: node.sourceEventIds ?? [],
      },
    });
    this.host.memoryRuntime.syncRelations(input.actorId, event.id);
    return node;
  }

  revise(input: WorldReviseActorMemoryInput): ActorMemoryNode {
    this.host.assertNotStopped("revise Actor memory");
    this.host.requireActor(input.actorId);
    this.host.assertMemorySourcesExist(input.revision.sourceEventIds);
    const node = this.host.actorMemory.revise(input.actorId, input.revision);
    const event = this.host.appendEvent({
      type: "actor.memory.revised",
      actorId: input.actorId,
      payload: {
        nodeId: node.id,
        status: node.status ?? "active",
        sourceEventIds: node.sourceEventIds ?? [],
      },
    });
    this.host.memoryRuntime.syncRelations(input.actorId, event.id);
    return node;
  }
}
