import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../contracts/provider.js";
import type { ResolvedWorldActorMemoryPolicy, WorldEvent } from "../../contracts/world.js";
import { ActorMemoryCurator } from "./curator.js";

const policy: ResolvedWorldActorMemoryPolicy = {
  enabled: true,
  idleExtractionMs: 120_000,
  boundaryDebounceMs: 0,
  maxEvidenceEvents: 24,
  maxOperationsPerUpdate: 4,
  maxCreatedNotesPerUpdate: 1,
  maxNotesPerActor: 1,
  maxArchivedNotesPerActor: 4,
  checkpointOnContextSuspend: true,
};

describe("ActorMemoryCurator", () => {
  it("rejects the removed single-Actor operations envelope", async () => {
    const curator = new ActorMemoryCurator({
      async complete() { return JSON.stringify({ operations: [] }); },
      async *stream() { yield ""; },
      async chat() { return { content: "", toolCalls: [] }; },
    }, policy);
    await expect(curator.curate({
      actors: [{
        actorId: "alice",
        card: {
          name: "Alice",
          description: "A scout",
          personality: "Careful",
          scenario: "Choosing a route",
          messageExample: "I will verify it.",
        },
        events: [],
        recalled: { actorId: "alice", estimatedTokens: 0, entries: [] },
        storedNodeCount: 0,
        storedActiveNodeCount: 0,
        storedNodeStatuses: new Map(),
        memoryIndex: [],
        anchorEventIds: [],
        idempotencyKey: "alice:legacy-envelope",
      }],
    })).rejects.toThrow("requires actorUpdates");
  });
  it("disables reasoning for the compact JSON repair pass", async () => {
    const thinkingModes: Array<"enabled" | "disabled" | undefined> = [];
    let calls = 0;
    const provider: ChatProvider = {
      async complete({ thinking }) {
        thinkingModes.push(thinking);
        calls++;
        return calls === 1
          ? '{"actorUpdates":['
          : JSON.stringify({ actorUpdates: [] });
      },
      async *stream() { yield ""; },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const curator = new ActorMemoryCurator(provider, policy);
    const patches = await curator.curate({
      actors: [{
        actorId: "alice",
        card: {
          name: "Alice",
          description: "A scout",
          personality: "Careful",
          scenario: "Choosing a route",
          messageExample: "I will verify it.",
        },
        events: [],
        recalled: { actorId: "alice", estimatedTokens: 0, entries: [] },
        storedNodeCount: 0,
        storedActiveNodeCount: 0,
        storedNodeStatuses: new Map(),
        memoryIndex: [],
        anchorEventIds: [],
        idempotencyKey: "alice:repair",
      }],
    });

    expect(patches).toEqual([{
      idempotencyKey: "alice:repair",
      operations: [],
      sourceEventIds: [],
    }]);
    expect(thinkingModes).toEqual(["enabled", "disabled"]);
  });

  it("archives stale active memory before accepting a replacement", async () => {
    const provider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          actorUpdates: [{
            actorId: "alice",
            operations: [
              {
                type: "create",
                kind: "belief",
                semanticKey: "belief:northern-route",
                title: "Northern route",
                content: "Alice now believes the northern route is safe.",
                sourceEventIds: ["event-2"],
              },
              {
                type: "revise",
                nodeId: "old-route",
                status: "archived",
                sourceEventIds: ["event-2"],
              },
            ],
          }],
        });
      },
      async *stream() {
        yield "";
      },
      async chat() {
        return { content: "", toolCalls: [] };
      },
    };
    const event = {
      id: "event-2",
      sequence: 2,
      worldId: "world",
      occurredAt: 2,
      type: "world.event.emitted",
      payload: {
        message: "The northern route has reopened.",
        contextIds: ["chat"],
        actorIds: ["alice"],
      },
    } as WorldEvent;
    const curator = new ActorMemoryCurator(provider, policy);

    const [patch] = await curator.curate({
      actors: [{
        actorId: "alice",
        card: {
          name: "Alice",
          description: "A scout",
          personality: "Careful",
          scenario: "Choosing a route",
          messageExample: "I will verify it.",
        },
        events: [event],
        recalled: {
          actorId: "alice",
          estimatedTokens: 10,
          entries: [{
            score: 1,
            node: {
              id: "old-route",
              kind: "belief",
              semanticKey: "belief:southern-route",
              title: "Northern route closed",
              content: "Alice believes the northern route is blocked.",
              status: "active",
            },
          }],
        },
        storedNodeCount: 1,
        storedActiveNodeCount: 1,
        storedNodeStatuses: new Map([["old-route", "active"]]),
        memoryIndex: [{
          id: "old-route",
          kind: "belief",
          semanticKey: "belief:southern-route",
          title: "Northern route closed",
          status: "active",
          importance: 0.5,
        }],
        anchorEventIds: ["event-2"],
        idempotencyKey: "alice:2",
      }],
    });

    expect(patch?.operations.map((operation) => operation.type)).toEqual([
      "revise",
      "create",
    ]);
  });

  it("turns a duplicate semantic create into a revision", async () => {
    const event = {
      id: "event-3",
      sequence: 3,
      worldId: "world",
      occurredAt: 3,
      type: "world.event.emitted",
      payload: { message: "Bob kept his promise.", contextIds: ["chat"], actorIds: ["alice"] },
    } as WorldEvent;
    const curator = new ActorMemoryCurator({
      async complete() {
        return JSON.stringify({
          actorUpdates: [{
            actorId: "alice",
            operations: [{
              type: "create",
              kind: "relation",
              semanticKey: "relation:bob",
              title: "Trust in Bob",
              content: "Alice now trusts Bob to keep difficult promises.",
              sourceEventIds: [event.id],
            }],
          }],
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: "", toolCalls: [] }; },
    }, policy);

    const [patch] = await curator.curate({
      actors: [{
        actorId: "alice",
        card: {
          name: "Alice",
          description: "A scout",
          personality: "Careful",
          scenario: "Choosing allies",
          messageExample: "I will verify it.",
        },
        events: [event],
        recalled: { actorId: "alice", estimatedTokens: 0, entries: [] },
        storedNodeCount: 1,
        storedActiveNodeCount: 1,
        storedNodeStatuses: new Map([["relation-bob", "active"]]),
        memoryIndex: [{
          id: "relation-bob",
          kind: "relation",
          semanticKey: "relation:bob",
          title: "Doubts about Bob",
          status: "active",
          importance: 0.7,
        }],
        anchorEventIds: [event.id],
        idempotencyKey: "alice:3",
      }],
    });

    expect(patch?.operations).toEqual([
      expect.objectContaining({
        type: "revise",
        revision: expect.objectContaining({ nodeId: "relation-bob" }),
      }),
    ]);
  });
});
