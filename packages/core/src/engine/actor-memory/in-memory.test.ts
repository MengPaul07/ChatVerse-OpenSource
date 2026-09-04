import { describe, expect, it } from "vitest";
import { ManualRuntimeHost } from "../../runtime/in-process.js";
import { InMemoryActorMemoryStore } from "./in-memory.js";

describe("InMemoryActorMemoryStore", () => {
  it("retrieves only a small relevant slice through graph links", () => {
    const runtime = new ManualRuntimeHost(1_000);
    const store = new InMemoryActorMemoryStore([{
      actorId: "homura",
      definition: {
        nodes: [
          {
            id: "self",
            kind: "self",
            semanticKey: "self:promise",
            title: "A promise",
            content: "Protect Madoka even when she refuses help.",
            importance: 0.9,
          },
          {
            id: "tower",
            kind: "episode",
            semanticKey: "episode:west-tower",
            title: "West tower",
            content: "Madoka was hurt at the west tower and tried to hide it.",
            importance: 0.8,
          },
          {
            id: "unrelated",
            kind: "preference",
            semanticKey: "preference:coffee",
            title: "Old cafe",
            content: "The coffee there is bitter.",
            importance: 0.2,
          },
        ],
        edges: [{
          id: "tower-madoka",
          fromNodeId: "tower",
          toId: "actor:madoka",
          type: "cares_about",
          weight: 1,
        }],
      },
    }], runtime);

    const slice = store.recall({
      actorId: "homura",
      query: "Madoka returned to the west tower.",
      relatedActorIds: ["actor:madoka"],
      maxNodes: 2,
      maxTokens: 80,
    });

    expect(slice.entries).toHaveLength(2);
    expect(slice.entries[0]?.node.id).toBe("tower");
    expect(slice.entries.map((entry) => entry.node.id)).not.toContain("unrelated");
    expect(slice.estimatedTokens).toBeLessThanOrEqual(80);
  });

  it("reserves recall capacity for a relevant directional relationship", () => {
    const runtime = new ManualRuntimeHost(1_500);
    const store = new InMemoryActorMemoryStore([{
      actorId: "alice",
      definition: {
        nodes: [
          {
            id: "important-place",
            kind: "knowledge",
            semanticKey: "knowledge:observatory",
            title: "The observatory",
            content: "The observatory controls the whole valley.",
            importance: 1,
          },
          {
            id: "bob-relation",
            kind: "relation",
            semanticKey: "relation:bob",
            title: "Bob",
            content: "Alice trusts Bob's judgment but dislikes his secrecy.",
            importance: 0.1,
          },
        ],
        edges: [{
          id: "alice-bob",
          fromNodeId: "bob-relation",
          toId: "actor:bob",
          type: "trusts",
          weight: 0.2,
        }],
      },
    }], runtime);

    const slice = store.recall({
      actorId: "alice",
      query: "observatory",
      relatedActorIds: ["actor:bob"],
      maxNodes: 1,
      maxRelationNodes: 1,
      maxTokens: 80,
    });

    expect(slice.entries.map((entry) => entry.node.id)).toEqual(["bob-relation"]);
  });

  it("keeps cold history out of Actor recall but available to maintenance", () => {
    const runtime = new ManualRuntimeHost(1_750);
    const store = new InMemoryActorMemoryStore([{
      actorId: "alice",
      definition: {
        nodes: [
          {
            id: "current",
            kind: "belief",
            semanticKey: "belief:route",
            title: "Current route",
            content: "Alice now uses the northern route.",
            status: "active",
            importance: 0.7,
          },
          {
            id: "old",
            kind: "episode",
            semanticKey: "episode:old-route",
            title: "Old route",
            content: "Alice once used the southern route.",
            status: "archived",
            importance: 1,
          },
        ],
      },
    }], runtime);

    expect(store.recall({
      actorId: "alice",
      query: "route",
      maxNodes: 4,
    }).entries.map((entry) => entry.node.id)).toEqual(["current"]);
    expect(store.recall({
      actorId: "alice",
      query: "southern route",
      maxNodes: 4,
      includeInactive: true,
    }).entries.map((entry) => entry.node.id)).toContain("old");
  });

  it("keeps runtime revisions and source provenance in snapshots", () => {
    const runtime = new ManualRuntimeHost(2_000);
    const store = new InMemoryActorMemoryStore([{ actorId: "alice" }], runtime);
    const node = store.record("alice", {
      kind: "belief",
      semanticKey: "belief:eastern-bridge",
      title: "The bridge is unsafe",
      content: "Alice believes the eastern bridge will fail again.",
      sourceEventIds: ["world-event-9"],
      links: [{ toId: "chapter:bridge", type: "continues", weight: 0.8 }],
    });
    runtime.advanceBy(1);
    store.revise("alice", { nodeId: node.id, confidence: 0.6 });

    const snapshot = store.snapshot("alice");
    expect(snapshot.revision).toBe(2);
    expect(snapshot.nodes[0]?.sourceEventIds).toEqual(["world-event-9"]);
    expect(snapshot.nodes[0]?.confidence).toBe(0.6);
    expect(snapshot.edges[0]?.toId).toBe("chapter:bridge");
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.documents[0]?.path).toMatch(/^memories\/notes\/belief-eastern-bridge-[a-z0-9]+\.md$/);
    expect(snapshot.documents[0]?.markdown).toContain("# The bridge is unsafe");
    expect(snapshot.documents[0]?.markdown).toContain("Alice believes the eastern bridge");
  });

  it("rebuilds the searchable index from Markdown documents", () => {
    const runtime = new ManualRuntimeHost(2_500);
    const source = new InMemoryActorMemoryStore([{ actorId: "alice" }], runtime);
    source.record("alice", {
      kind: "belief",
      semanticKey: "belief:harbor-signal",
      title: "Harbor signal",
      content: "Alice saw the harbor signal turn red.",
      sourceEventIds: ["event-1"],
    });
    const snapshot = source.snapshot("alice");
    snapshot.nodes[0]!.content = "This stale projection must not win.";

    const restored = new InMemoryActorMemoryStore([{
      actorId: "alice",
      snapshot,
    }], runtime);

    expect(restored.recall({
      actorId: "alice",
      query: "harbor signal",
      maxNodes: 1,
    }).entries[0]?.node.content).toBe("Alice saw the harbor signal turn red.");
  });

  it("indexes a directional relation even when the Curator omits links", () => {
    const runtime = new ManualRuntimeHost(2_750);
    const store = new InMemoryActorMemoryStore([{ actorId: "alice" }], runtime);
    store.record("alice", {
      kind: "relation",
      semanticKey: "relation:bob",
      title: "Bob",
      content: "Alice is cautious around Bob.",
      sourceEventIds: ["event-1"],
    });

    const snapshot = store.snapshot("alice");
    expect(snapshot.edges).toEqual([expect.objectContaining({ toId: "actor:bob" })]);
    expect(snapshot.documents[0]?.path).toMatch(/^memories\/relations\/relation-bob-[a-z0-9]+\.md$/);
    expect(store.recall({
      actorId: "alice",
      relatedActorIds: ["actor:bob"],
      maxNodes: 1,
    }).entries[0]?.node.kind).toBe("relation");
  });

  it("applies memory patches atomically and deduplicates retries", () => {
    const runtime = new ManualRuntimeHost(3_000);
    const store = new InMemoryActorMemoryStore([{ actorId: "alice" }], runtime);
    const patch = {
      idempotencyKey: "alice:events:1-2",
      sourceEventIds: ["event-1", "event-2"],
      operations: [{
        type: "create" as const,
        candidate: {
          kind: "relation" as const,
          semanticKey: "relation:bob",
          title: "A kept promise",
          content: "Bob returned when Alice asked for help.",
          sourceEventIds: ["event-2"],
          links: [{ toId: "actor:bob", type: "trusts" as const, weight: 0.8 }],
        },
      }],
    };

    const first = store.applyTransaction("alice", patch, 0);
    const duplicate = store.applyTransaction("alice", patch);
    const snapshot = store.snapshot("alice");

    expect(first.applied).toBe(true);
    expect(first.toRevision).toBe(1);
    expect(first.createdNodeIds).toHaveLength(1);
    expect(first.createdEdgeIds).toHaveLength(1);
    expect(duplicate.applied).toBe(false);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.appliedPatchIds).toContain("alice:events:1-2");
  });

  it("does not leave partial writes when one patch operation is invalid", () => {
    const runtime = new ManualRuntimeHost(4_000);
    const store = new InMemoryActorMemoryStore([{ actorId: "alice" }], runtime);

    expect(() => store.applyTransaction("alice", {
      idempotencyKey: "invalid-patch",
      sourceEventIds: ["event-1"],
      operations: [
        {
          type: "create",
          candidate: {
            kind: "belief",
            semanticKey: "belief:temporary",
            title: "Temporary",
            content: "This must be rolled back.",
            sourceEventIds: ["event-1"],
          },
        },
        {
          type: "revise",
          revision: {
            nodeId: "missing",
            content: "Invalid revision",
            sourceEventIds: ["event-1"],
          },
        },
      ],
    })).toThrow("Unknown actor memory node");

    expect(store.snapshot("alice").nodes).toHaveLength(0);
    expect(store.snapshot("alice").revision).toBe(0);
  });

  it("hard-deletes obsolete notes and their graph edges atomically", () => {
    const runtime = new ManualRuntimeHost(5_000);
    const store = new InMemoryActorMemoryStore([{ actorId: "alice" }], runtime);
    const node = store.record("alice", {
      kind: "relation",
      semanticKey: "relation:bob",
      title: "Outdated trust",
      content: "Alice still trusts Bob without reservation.",
      sourceEventIds: ["event-old"],
      links: [{ toId: "actor:bob", type: "trusts", weight: 1 }],
    });

    const commit = store.applyTransaction("alice", {
      idempotencyKey: "alice:delete-old-relation",
      sourceEventIds: ["event-new"],
      operations: [{
        type: "delete",
        deletion: {
          nodeId: node.id,
          sourceEventIds: ["event-new"],
          reason: "The belief was disproved and carries no durable value.",
        },
      }],
    }, 1);

    expect(commit.deletedNodeIds).toEqual([node.id]);
    expect(commit.deletedEdgeIds).toHaveLength(1);
    expect(store.snapshot("alice")).toMatchObject({ nodes: [], edges: [] });
  });
});
