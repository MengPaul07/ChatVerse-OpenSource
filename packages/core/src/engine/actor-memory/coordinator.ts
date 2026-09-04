import type { CharacterCard } from "../../contracts/chat.js";
import type {
  ActorMemoryCommit,
  ActorMemoryRuntimeSnapshot,
  ActorMemorySlice,
  ActorMemoryStore,
} from "../../contracts/actor-memory.js";
import type { ChatProvider } from "../../contracts/provider.js";
import type {
  ResolvedWorldActorMemoryPolicy,
  WorldEvent,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../contracts/world.js";
import type { RuntimeHost, RuntimeTask } from "../../runtime/types.js";
import type { ActorMemoryDebugSnapshot } from "../../contracts/world-debug.js";
import { providerFailureDetails, type ProviderFailureDetails } from "../provider-failure.js";
import {
  ActorMemoryCurator,
  type ActorMemoryCuratorActorInput,
  type ActorMemoryCuratorTrace,
} from "./curator.js";

const RETRY_DELAYS = [5_000, 15_000, 60_000] as const;
const MAX_ACTORS_PER_CURATOR_BATCH = 3;
interface ActorMemoryRuntime {
  actorId: string;
  card: CharacterCard;
  lastProcessedSequence: number;
  pendingEventIds: string[];
  candidateEventIds: string[];
}

interface ActorMemoryBatchEntry {
  runtime: ActorMemoryRuntime;
  eventIds: string[];
  events: WorldEvent[];
  expectedRevision: number;
  curatorInput: ActorMemoryCuratorActorInput;
}

export interface ActorMemoryCoordinatorOptions {
  actors: Array<{ actorId: string; card: CharacterCard }>;
  provider: ChatProvider;
  store: ActorMemoryStore;
  runtime: RuntimeHost;
  policy: ResolvedWorldActorMemoryPolicy;
  restored?: readonly ActorMemoryRuntimeSnapshot[];
  getEvent(eventId: string): WorldEvent | undefined;
  recall(actorId: string, events: readonly WorldEvent[]): ActorMemorySlice;
  onCommit(commit: ActorMemoryCommit, sourceEvents: readonly WorldEvent[]): void;
  onProviderError?(error: ProviderFailureDetails): boolean;
  trace?(event: ActorMemoryCuratorTrace): void;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/**
 * Collects observations per Actor, then curates a small shared batch. Storage
 * revisions and patches remain Actor-isolated.
 */
export class ActorMemoryUpdateCoordinator {
  private readonly curator: ActorMemoryCurator;
  private readonly actors = new Map<string, ActorMemoryRuntime>();
  private running = false;
  private stopped = false;
  private task?: RuntimeTask;
  private dueAt?: number;
  private ready = false;
  private activeActorIds = new Set<string>();
  private activeAbort?: AbortController;
  private retryIndex = 0;

  constructor(private readonly options: ActorMemoryCoordinatorOptions) {
    this.curator = new ActorMemoryCurator(options.provider, options.policy);
    for (const actor of options.actors) {
      const restored = options.restored?.find((item) => item.actorId === actor.actorId);
      this.actors.set(actor.actorId, {
        ...actor,
        lastProcessedSequence: restored?.lastProcessedSequence ?? 0,
        pendingEventIds: [...(restored?.pendingEventIds ?? [])],
        candidateEventIds: [...(restored?.candidateEventIds ?? [])],
      });
    }
  }

  registerActor(input: {
    actorId: string;
    card: CharacterCard;
    restored?: ActorMemoryRuntimeSnapshot;
  }): void {
    if (this.actors.has(input.actorId)) {
      throw new Error(`Actor memory runtime already exists: ${input.actorId}`);
    }
    this.actors.set(input.actorId, {
      actorId: input.actorId,
      card: input.card,
      lastProcessedSequence: input.restored?.lastProcessedSequence ?? 0,
      pendingEventIds: [...(input.restored?.pendingEventIds ?? [])],
      candidateEventIds: [...(input.restored?.candidateEventIds ?? [])],
    });
    if (this.running && (input.restored?.candidateEventIds?.length ?? 0) > 0) {
      this.schedulePendingWork("registered");
    }
  }

  start(): void {
    if (!this.options.policy.enabled || this.stopped) return;
    this.running = true;
    // Only resume work opened by an explicit Beat boundary. Restored plain
    // observations stay dormant until the next consolidation.
    if (this.hasConsolidationCandidate()) {
      this.schedulePendingWork("restored");
    }
  }

  pause(): void {
    this.running = false;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.activeActorIds.clear();
    this.task?.cancel();
    this.task = undefined;
    this.dueAt = undefined;
    this.ready = false;
  }

  resume(): void {
    if (this.stopped) return;
    this.start();
  }

  stop(): void {
    this.pause();
    this.stopped = true;
  }

  observe(
    actorIds: readonly string[],
    event: WorldEvent,
    critical = false,
    candidate = critical,
  ): void {
    if (!this.options.policy.enabled || this.stopped) return;
    let observed = false;
    for (const actorId of actorIds) {
      const actor = this.actors.get(actorId);
      if (!actor || event.sequence <= actor.lastProcessedSequence) continue;
      if (!actor.pendingEventIds.includes(event.id)) {
        actor.pendingEventIds.push(event.id);
        trimOldest(actor.pendingEventIds, this.options.policy.maxEvidenceEvents * 4);
        actor.candidateEventIds = actor.candidateEventIds.filter((id) => (
          actor.pendingEventIds.includes(id)
        ));
        observed = true;
      }
    }
    // Collection only. Beat completion is the sole boundary that promotes
    // evidence and starts the background Curator.
    void observed;
    void critical;
    void candidate;
  }

  checkpoint(actorIds: readonly string[], reason = "context_checkpoint"): void {
    // Context suspension no longer starts memory work.
    void actorIds;
    void reason;
  }

  /**
   * A narrative boundary is an explicit consolidation point. Unlike the
   * context-suspend checkpoint it does not depend on the optional suspend
   * policy or the routine idle extraction window.
   */
  consolidate(actorIds: readonly string[], reason = "narrative_boundary"): void {
    if (!this.options.policy.enabled || this.stopped) return;
    const actors = actorIds
      .map((actorId) => this.actors.get(actorId))
      .filter((actor): actor is ActorMemoryRuntime => Boolean(actor?.pendingEventIds.length));
    if (!actors.length) return;
    this.promoteLatestPending(actors);
    this.schedule(this.options.policy.boundaryDebounceMs, reason);
  }

  snapshots(): ActorMemoryRuntimeSnapshot[] {
    return [...this.actors.values()].map((actor) => ({
      actorId: actor.actorId,
      lastProcessedSequence: actor.lastProcessedSequence,
      pendingEventIds: [...actor.pendingEventIds],
      candidateEventIds: [...actor.candidateEventIds],
    }));
  }

  debugSnapshots(): ActorMemoryDebugSnapshot[] {
    return [...this.actors.values()].map((actor) => ({
      actorId: actor.actorId,
      lastProcessedSequence: actor.lastProcessedSequence,
      pendingEventIds: [...actor.pendingEventIds],
      candidateEventIds: [...actor.candidateEventIds],
      revision: this.options.store.snapshot(actor.actorId).revision,
      status: this.activeActorIds.has(actor.actorId)
        ? "running"
        : actor.pendingEventIds.length > 0 && this.ready
          ? "ready"
          : actor.pendingEventIds.length > 0 && this.task && this.retryIndex > 0
            ? "retrying"
            : actor.pendingEventIds.length > 0 && this.task
              ? "scheduled"
              : "idle",
      dueAt: actor.pendingEventIds.length > 0 ? this.dueAt : undefined,
      retryIndex: actor.pendingEventIds.length > 0 ? this.retryIndex : 0,
      candidateEventCount: actor.candidateEventIds.length,
    }));
  }

  private schedule(delayMs: number, reason: string, replace = false): void {
    if (!this.running || this.stopped) return;
    const now = this.options.runtime.clock.now();
    const normalizedDelay = Math.max(0, delayMs);
    const dueAt = now + normalizedDelay;
    if (this.ready || (!replace && this.dueAt !== undefined && this.dueAt <= dueAt)) return;
    this.task?.cancel();
    this.dueAt = dueAt;
    this.options.notify("actor_memory.scheduled", {
      actorIds: this.pendingActorIds(),
      dueAt,
      delayMs: normalizedDelay,
      reason,
      pendingEvents: this.pendingUniqueEventCount(),
    });
    this.task = this.options.runtime.scheduler.schedule(normalizedDelay, () => {
      this.task = undefined;
      this.dueAt = undefined;
      if (reason === "idle") {
        this.promoteLatestPending([...this.actors.values()]);
      }
      this.ready = true;
      this.drain();
    });
  }

  private drain(): void {
    if (!this.running || this.stopped || this.activeAbort || !this.ready) return;
    this.ready = false;
    const batch = this.createBatch();
    if (batch.length === 0) return;
    this.activeActorIds = new Set(batch.map((entry) => entry.runtime.actorId));
    void this.run(batch);
  }

  private createBatch(): ActorMemoryBatchEntry[] {
    const batch: ActorMemoryBatchEntry[] = [];

    for (const runtime of this.actors.values()) {
      const anchor = runtime.candidateEventIds
        .map((eventId) => this.options.getEvent(eventId))
        .filter((event): event is WorldEvent => Boolean(event))
        .filter((event) => event.sequence > runtime.lastProcessedSequence)
        .sort((a, b) => a.sequence - b.sequence)
        .at(-1);
      if (!anchor) continue;
      const events = runtime.pendingEventIds
        .map((eventId) => this.options.getEvent(eventId))
        .filter((event): event is WorldEvent => Boolean(event))
        .filter((event) => event.sequence > runtime.lastProcessedSequence)
        .filter((event) => event.sequence <= anchor.sequence)
        .sort((a, b) => a.sequence - b.sequence)
        // Process the oldest evidence window first. Taking the newest window
        // and then replaying the leftover older events lets stale facts
        // overwrite a later correction in long-running worlds.
        .slice(0, this.options.policy.maxEvidenceEvents);
      const eventIds = events.map((event) => event.id);
      if (events.length === 0) {
        runtime.candidateEventIds = runtime.candidateEventIds.filter((id) => id !== anchor.id);
        continue;
      }
      const firstSequence = events[0]!.sequence;
      const lastSequence = events[events.length - 1]!.sequence;
      const memorySnapshot = this.options.store.snapshot(runtime.actorId);
      const activeNodeCount = memorySnapshot.nodes.filter(
        (node) => (node.status ?? "active") === "active",
      ).length;
      batch.push({
        runtime,
        eventIds,
        events,
        expectedRevision: memorySnapshot.revision,
        curatorInput: {
          actorId: runtime.actorId,
          card: runtime.card,
          events,
          recalled: this.options.recall(runtime.actorId, events),
          storedNodeCount: memorySnapshot.nodes.length,
          storedActiveNodeCount: activeNodeCount,
          storedNodeStatuses: new Map(memorySnapshot.nodes.map((node) => [
            node.id,
            node.status ?? "active",
          ])),
          memoryIndex: memorySnapshot.nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            semanticKey: node.semanticKey,
            title: node.title,
            status: node.status ?? "active",
            importance: node.importance ?? 0.5,
            updatedAt: node.updatedAt,
          })),
          anchorEventIds: runtime.candidateEventIds.filter((id) => eventIds.includes(id)),
          idempotencyKey: `actor-memory:${runtime.actorId}:${firstSequence}-${lastSequence}`,
        },
      });
    }
    return batch
      .sort((left, right) => (
        left.runtime.lastProcessedSequence - right.runtime.lastProcessedSequence
      ))
      .slice(0, MAX_ACTORS_PER_CURATOR_BATCH);
  }

  private async run(batch: ActorMemoryBatchEntry[]): Promise<void> {
    const controller = new AbortController();
    this.activeAbort = controller;
    const actorIds = batch.map((entry) => entry.runtime.actorId);
    const events = uniqueBatchEvents(batch);
    this.options.notify("actor_memory.started", {
      actorIds,
      fromSequence: events[0]?.sequence,
      throughSequence: events[events.length - 1]?.sequence,
      eventCount: events.length,
    });

    try {
      const patches = await this.curator.curate({
        actors: batch.map((entry) => entry.curatorInput),
      }, controller.signal, this.options.trace);
      if (controller.signal.aborted || !this.running || this.stopped) return;

      const patchByActor = new Map(
        patches.map((patch, index) => [batch[index]?.runtime.actorId, patch]),
      );
      for (const entry of batch) {
        const patch = patchByActor.get(entry.runtime.actorId);
        if (!patch) continue;
        let commit: ActorMemoryCommit | undefined;
        if (patch.operations.length > 0) {
          commit = this.options.store.applyTransaction(
            entry.runtime.actorId,
            patch,
            entry.expectedRevision,
          );
          this.options.onCommit(commit, entry.events);
        }
        this.settleActor(entry, patch.operations.length, commit);
      }
      this.retryIndex = 0;
      if (this.hasPendingEvidence()) this.schedulePendingWork("remaining_batch");
    } catch (error) {
      if (controller.signal.aborted || this.stopped || !this.running) return;
      if (this.options.onProviderError?.(providerFailureDetails(error))) {
        this.pause();
        return;
      }
      const retryMs = RETRY_DELAYS[
        Math.min(this.retryIndex, RETRY_DELAYS.length - 1)
      ] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]!;
      this.retryIndex++;
      this.options.notify("actor_memory.error", {
        actorIds,
        message: error instanceof Error ? error.message : String(error),
      });
      this.options.notify("actor_memory.retry_scheduled", {
        actorIds,
        retryMs,
      });
      this.schedule(retryMs, "retry");
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = undefined;
        this.activeActorIds.clear();
        this.drain();
      }
    }
  }

  private settleActor(
    entry: ActorMemoryBatchEntry,
    operationCount: number,
    commit: ActorMemoryCommit | undefined,
  ): void {
    const processedIds = new Set(entry.eventIds);
    const actor = entry.runtime;
    actor.pendingEventIds = actor.pendingEventIds.filter((id) => !processedIds.has(id));
    actor.candidateEventIds = actor.candidateEventIds.filter((id) => !processedIds.has(id));
    actor.lastProcessedSequence = Math.max(
      actor.lastProcessedSequence,
      entry.events[entry.events.length - 1]?.sequence ?? actor.lastProcessedSequence,
    );
    const cursor = actor.lastProcessedSequence;
    const isUnprocessed = (eventId: string): boolean => {
      const event = this.options.getEvent(eventId);
      return event !== undefined && event.sequence > cursor;
    };
    // Snapshots from before the cursor may still contain evidence that was
    // skipped by a capped batch. Retire it here instead of scheduling a
    // second, out-of-order curator pass.
    actor.pendingEventIds = actor.pendingEventIds.filter(isUnprocessed);
    actor.candidateEventIds = actor.candidateEventIds.filter(isUnprocessed);
    this.options.notify("actor_memory.completed", {
      actorId: actor.actorId,
      sharedBatch: true,
      throughSequence: actor.lastProcessedSequence,
      operationCount,
      applied: commit?.applied ?? false,
      candidateEventCount: actor.candidateEventIds.length,
    });
  }

  private pendingActorIds(): string[] {
    return [...this.actors.values()]
      .filter((actor) => actor.pendingEventIds.length > 0)
      .map((actor) => actor.actorId);
  }

  private pendingUniqueEventCount(): number {
    return new Set(
      [...this.actors.values()].flatMap((actor) => actor.pendingEventIds),
    ).size;
  }

  private hasConsolidationCandidate(): boolean {
    return [...this.actors.values()].some((actor) => actor.candidateEventIds.length > 0);
  }

  private hasPendingEvidence(): boolean {
    return [...this.actors.values()].some((actor) => actor.pendingEventIds.length > 0);
  }

  private promoteLatestPending(actors: readonly ActorMemoryRuntime[]): void {
    for (const actor of actors) {
      const latestId = actor.pendingEventIds.at(-1);
      if (latestId && !actor.candidateEventIds.includes(latestId)) {
        actor.candidateEventIds.push(latestId);
      }
    }
  }

  private schedulePendingWork(reason: string): void {
    if (this.hasConsolidationCandidate()) {
      this.schedule(this.options.policy.boundaryDebounceMs, reason);
    }
  }
}

function uniqueBatchEvents(batch: readonly ActorMemoryBatchEntry[]): WorldEvent[] {
  const events = new Map<string, WorldEvent>();
  for (const entry of batch) {
    for (const event of entry.events) events.set(event.id, event);
  }
  return [...events.values()].sort((a, b) => a.sequence - b.sequence);
}

function trimOldest(values: string[], maxSize: number): void {
  if (values.length > maxSize) values.splice(0, values.length - maxSize);
}
