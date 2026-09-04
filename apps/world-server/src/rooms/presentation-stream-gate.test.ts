import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@chatverse/core";
import { PresentationStreamGate } from "./presentation-stream-gate.js";

describe("PresentationStreamGate", () => {
  it("withholds presentation entries and releases them once in turn order", () => {
    const gate = new PresentationStreamGate();
    const first = event("entry-1", "第一句");
    const second = event("entry-2", "第二句");

    expect(gate.capture(first, true)).toBe(true);
    expect(gate.capture(second, true)).toBe(true);
    expect(gate.release(["entry-2", "entry-1"])).toEqual([second, first]);
    expect(gate.release(["entry-1", "entry-2"])).toEqual([]);
  });

  it("does not intercept ordinary world or non-entry events", () => {
    const gate = new PresentationStreamGate();
    const message = event("entry-1", "普通消息");
    const beat = {
      ...message,
      type: "narrative.beat.recorded",
      payload: {},
    } as WorldEvent;

    expect(gate.capture(message, false)).toBe(false);
    expect(gate.capture(beat, true)).toBe(false);
    expect(gate.release([message.id, beat.id])).toEqual([]);
  });

  it("publishes direct player messages immediately", () => {
    const gate = new PresentationStreamGate();
    const message = event("player-entry", "我来处理。");
    if (message.type === "context.message.committed") message.payload.message.source = "human";

    expect(gate.capture(message, true)).toBe(false);
    expect(gate.release([message.id])).toEqual([]);
  });
});

function event(id: string, message: string): WorldEvent {
  return {
    id,
    worldId: "world",
    type: "context.message.committed",
    sequence: 1,
    occurredAt: 1,
    contextId: "main",
    actorId: "actor",
    payload: {
      message: {
        id: `message:${id}`,
        characterName: "Actor",
        message,
        timestamp: 1,
        source: "character",
      },
    },
  };
}
