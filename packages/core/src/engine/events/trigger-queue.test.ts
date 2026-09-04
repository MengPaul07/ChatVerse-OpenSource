import { describe, expect, it } from "vitest";
import { HarnessTriggerQueue } from "./trigger-queue.js";

function trigger(overrides: Partial<Parameters<HarnessTriggerQueue["enqueue"]>[0]> = {}) {
  return {
    type: "idle" as const,
    target: "Alice",
    priority: 10,
    enqueuedAt: 1,
    ...overrides,
  };
}

describe("HarnessTriggerQueue", () => {
  it("takes higher-priority triggers first while preserving equal-priority order", () => {
    const queue = new HarnessTriggerQueue();
    queue.enqueue(trigger({ target: "low", priority: 10 }), () => false);
    queue.enqueue(trigger({ target: "high", priority: 90 }), () => false);
    queue.enqueue(trigger({ target: "peer", priority: 10 }), () => false);

    expect(queue.takeNext(() => true)?.target).toBe("high");
    expect(queue.takeNext(() => true)?.target).toBe("low");
    expect(queue.takeNext(() => true)?.target).toBe("peer");
  });

  it("keeps deliberate player and Narrator work while busy, but skips ordinary triggers", () => {
    const queue = new HarnessTriggerQueue();

    expect(queue.enqueue(trigger({ type: "idle" }), () => true)).toBe("target_busy");
    expect(queue.enqueue(trigger({ type: "mention", messageId: "message-1" }), () => true)).toBe("enqueued");
    expect(queue.enqueue(trigger({
      type: "wake",
      target: "Bob",
      source: "narrator",
      turnId: "beat-1",
    }), () => true)).toBe("enqueued");
    expect(queue.length).toBe(2);
    expect(queue.takeNext(() => false)).toBeUndefined();
    expect(queue.takeNext(() => true)?.type).toBe("mention");
    expect(queue.takeNext(() => true)).toMatchObject({
      type: "wake",
      target: "Bob",
      source: "narrator",
    });
  });

  it("deduplicates idle triggers and duplicate direct mentions", () => {
    const queue = new HarnessTriggerQueue();
    expect(queue.enqueue(trigger({ type: "idle" }), () => false)).toBe("enqueued");
    expect(queue.enqueue(trigger({ type: "idle", enqueuedAt: 2 }), () => false)).toBe("duplicate");
    expect(queue.enqueue(trigger({ type: "mention", messageId: "m-1" }), () => false)).toBe("enqueued");
    expect(queue.enqueue(trigger({ type: "mention", messageId: "m-1", enqueuedAt: 3 }), () => false)).toBe("duplicate");
  });
});
