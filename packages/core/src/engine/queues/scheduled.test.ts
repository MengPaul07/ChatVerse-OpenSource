import { describe, expect, it } from "vitest";
import type { RuntimeHost } from "../../runtime/types.js";
import { ScheduledMessageQueue } from "./scheduled.js";

function createRuntime(now: number): RuntimeHost {
  return {
    clock: { now: () => now },
    scheduler: {
      schedule: () => ({ cancel() {} }),
    },
    idGenerator: { next: () => "id" },
    notifications: {
      publish() {},
      subscribe: () => () => {},
    },
  };
}

describe("ScheduledMessageQueue pacing", () => {
  it("rescales pending waits without changing their order", () => {
    const queue = new ScheduledMessageQueue(createRuntime(1_000));
    queue.schedule({ speaker: "甲", message: "一", outputKind: "message", sendAt: 2_000 });
    queue.schedule({ speaker: "乙", message: "二", outputKind: "message", sendAt: 4_000 });

    queue.rescaleRemaining(2, 1_000);

    expect(queue.pending.map((message) => message.sendAt)).toEqual([3_000, 7_000]);
  });

  it("can shorten an existing wait when pacing is accelerated", () => {
    const queue = new ScheduledMessageQueue(createRuntime(1_000));
    queue.schedule({ speaker: "甲", message: "一", outputKind: "message", sendAt: 5_000 });

    queue.rescaleRemaining(0.25, 1_000);

    expect(queue.pending[0]?.sendAt).toBe(2_000);
  });
});
