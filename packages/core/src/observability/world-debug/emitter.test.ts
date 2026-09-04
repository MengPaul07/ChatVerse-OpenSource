import { describe, expect, it } from "vitest";
import { ManualRuntimeHost } from "../../runtime/in-process.js";
import { WorldDebugEmitter } from "./emitter.js";

describe("WorldDebugEmitter token accounting", () => {
  it("keeps lifetime token totals after the bounded event window is trimmed", () => {
    const runtime = new ManualRuntimeHost(1_000);
    const emitter = new WorldDebugEmitter(
      { enabled: true, maxEvents: 100 },
      "world",
      runtime,
    );

    emitter.emit({
      category: "provider",
      type: "provider.usage",
      level: "info",
      actorId: "alice",
      payload: {
        providerRole: "character",
        requestContext: {
          purpose: "actor_decision",
          actorId: "alice",
          turnId: "chain-1",
        },
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          cacheHitInputTokens: 80,
          cacheMissInputTokens: 40,
          reasoningTokens: 10,
          model: "test-model",
        },
      },
    });

    for (let index = 0; index < 120; index++) {
      emitter.emit({
        category: "world",
        type: "test.event",
        level: "trace",
        payload: { index },
      });
    }

    expect(emitter.events).toHaveLength(100);
    expect(emitter.events.some((event) => event.type === "provider.usage")).toBe(false);
    expect(emitter.droppedEventCount).toBe(21);
    expect(emitter.tokenUsage).toMatchObject({
      requestCount: 1,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cacheHitInputTokens: 80,
      cacheMissInputTokens: 40,
      reasoningTokens: 10,
      byRole: [{ key: "character", totalTokens: 150 }],
      byPurpose: [{ key: "actor_decision", totalTokens: 150 }],
      byActor: [{ key: "alice", totalTokens: 150 }],
      byModel: [{ key: "test-model", totalTokens: 150 }],
      byTurn: [{ key: "chain-1", totalTokens: 150 }],
    });
  });
});
