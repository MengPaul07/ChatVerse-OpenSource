import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../contracts/provider.js";
import type { ResolvedWorldActorMemoryPolicy, WorldEvent } from "../../contracts/world.js";
import { ManualRuntimeHost } from "../../runtime/in-process.js";
import { ActorMemoryUpdateCoordinator } from "./coordinator.js";
import { InMemoryActorMemoryStore } from "./in-memory.js";

const policy: ResolvedWorldActorMemoryPolicy = {
  enabled: true,
  idleExtractionMs: 10_000,
  boundaryDebounceMs: 0,
  maxEvidenceEvents: 24,
  maxOperationsPerUpdate: 4,
  maxCreatedNotesPerUpdate: 1,
  maxNotesPerActor: 8,
  maxArchivedNotesPerActor: 4,
  checkpointOnContextSuspend: true,
};

function event(id: string, sequence: number): WorldEvent {
  return {
    id,
    sequence,
    worldId: "world",
    occurredAt: 1_000 + sequence,
    type: "world.event.emitted",
    payload: {
      message: `Observation ${sequence}`,
      contextIds: ["chat"],
      actorIds: ["alice"],
    },
  } as WorldEvent;
}

function curatorResponse(sourceEventId: string): string {
  return JSON.stringify({
    actorUpdates: [{
      actorId: "alice",
      operations: [{
        type: "create",
        kind: "belief",
        semanticKey: `belief:bridge-${sourceEventId}`,
        title: "Bridge instability",
        content: "Alice believes the bridge is unstable.",
        sourceEventIds: [sourceEventId],
      }],
    }],
  });
}

function createCoordinator(input: {
  runtime: ManualRuntimeHost;
  provider: ChatProvider;
  events: readonly WorldEvent[];
  policy?: Partial<ResolvedWorldActorMemoryPolicy>;
  notify?: (type: string) => void;
}) {
  const store = new InMemoryActorMemoryStore([{ actorId: "alice" }], input.runtime);
  const coordinator = new ActorMemoryUpdateCoordinator({
    actors: [{
      actorId: "alice",
      card: {
        name: "Alice",
        description: "A scout",
        personality: "Careful",
        scenario: "Watching the bridge",
        messageExample: "I will verify it.",
      },
    }],
    provider: input.provider,
    store,
    runtime: input.runtime,
    policy: { ...policy, ...input.policy },
    getEvent: (id) => input.events.find((item) => item.id === id),
    recall: (actorId) => ({ actorId, entries: [], estimatedTokens: 0 }),
    onCommit: () => undefined,
    notify: (type) => input.notify?.(type),
  });
  return { coordinator, store };
}

describe("ActorMemoryUpdateCoordinator", () => {
  it("processes only evidence admitted by an explicit Beat boundary", async () => {
    const runtime = new ManualRuntimeHost(1_000);
    const first = event("event-1", 1);
    const second = event("event-2", 2);
    let resolveFirst: ((value: string) => void) | undefined;
    let calls = 0;
    const provider: ChatProvider = {
      complete() {
        calls++;
        if (calls === 1) {
          return new Promise<string>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(curatorResponse(second.id));
      },
      async *stream() { yield ""; },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const { coordinator, store } = createCoordinator({
      runtime,
      provider,
      events: [first, second],
    });

    coordinator.start();
    coordinator.observe(["alice"], first, true, true);
    coordinator.consolidate(["alice"], "beat_completed:beat-1");
    runtime.advanceBy(0);
    expect(calls).toBe(1);

    coordinator.observe(["alice"], second, true, true);
    runtime.advanceBy(0);
    expect(calls).toBe(1);

    resolveFirst?.(curatorResponse(first.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(store.snapshot("alice").nodes).toHaveLength(1);
    expect(coordinator.snapshots()[0]?.pendingEventIds).toEqual([second.id]);

    coordinator.consolidate(["alice"], "beat_completed:beat-2");
    runtime.advanceBy(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    expect(store.snapshot("alice").nodes).toHaveLength(2);
    expect(coordinator.snapshots()[0]?.pendingEventIds).toEqual([]);
    coordinator.stop();
  });

  it("processes capped evidence windows in sequence order", async () => {
    const runtime = new ManualRuntimeHost(1_000);
    const events = [1, 2, 3, 4].map((sequence) => event(`event-${sequence}`, sequence));
    const anchors: string[] = [];
    let calls = 0;
    const provider: ChatProvider = {
      complete: async ({ userPrompt }) => {
        calls++;
        const anchor = userPrompt.match(/extractionAnchors:\n- \[\d+\] (event-\d+)/)?.[1] ?? "event-1";
        anchors.push(anchor);
        return curatorResponse(anchor);
      },
      async *stream() { yield ""; },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const { coordinator, store } = createCoordinator({
      runtime,
      provider,
      events,
      policy: { maxEvidenceEvents: 2 },
    });

    coordinator.start();
    for (const observation of events) {
      coordinator.observe(["alice"], observation, true, true);
    }
    coordinator.consolidate(["alice"], "beat_completed:beat-1");
    runtime.advanceBy(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.advanceBy(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(2);
    expect(anchors).toEqual(["event-1", "event-4"]);
    expect(coordinator.snapshots()[0]?.lastProcessedSequence).toBe(4);
    expect(coordinator.snapshots()[0]?.pendingEventIds).toEqual([]);
    expect(store.snapshot("alice").nodes.map((node) => node.sourceEventIds?.[0]))
      .toEqual(["event-1", "event-4"]);
    coordinator.stop();
  });

  it("cancels background work while the World is paused and resumes once", async () => {
    const runtime = new ManualRuntimeHost(1_000);
    const observation = event("event-1", 1);
    let calls = 0;
    const { coordinator } = createCoordinator({
      runtime,
      events: [observation],
      provider: {
        complete: async () => {
          calls++;
          return JSON.stringify({ actorUpdates: [{ actorId: "alice", operations: [] }] });
        },
        async *stream() { yield ""; },
        async chat() { return { content: "", toolCalls: [] }; },
      },
    });

    coordinator.start();
    coordinator.observe(["alice"], observation, true, true);
    coordinator.consolidate(["alice"], "beat_completed:beat-1");
    coordinator.pause();
    runtime.advanceBy(10_000);
    expect(calls).toBe(0);

    coordinator.resume();
    runtime.advanceBy(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(coordinator.snapshots()[0]?.pendingEventIds).toEqual([]);
    coordinator.stop();
  });

  it("does not curate routine or critical evidence before Beat completion", async () => {
    const runtime = new ManualRuntimeHost(1_000);
    const first = event("event-1", 1);
    const second = event("event-2", 2);
    let calls = 0;
    const { coordinator } = createCoordinator({
      runtime,
      events: [first, second],
      provider: {
        async complete() {
          calls++;
          return JSON.stringify({ actorUpdates: [] });
        },
        async *stream() { yield ""; },
        async chat() { return { content: "", toolCalls: [] }; },
      },
    });

    coordinator.start();
    coordinator.observe(["alice"], first, false, false);
    runtime.advanceBy(9_000);
    coordinator.observe(["alice"], second, true, true);
    runtime.advanceBy(60_000);
    expect(calls).toBe(0);

    coordinator.checkpoint(["alice"]);
    runtime.advanceBy(60_000);
    expect(calls).toBe(0);

    coordinator.consolidate(["alice"], "beat_completed:beat-1");
    runtime.advanceBy(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    expect(coordinator.snapshots()[0]?.pendingEventIds).toEqual([]);
    coordinator.stop();
  });
});
