import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../contracts/provider.js";
import { Session } from "../engine/session.js";
import { InMemoryRuntimeNotificationBus, ManualRuntimeHost } from "./in-process.js";
import { SessionRuntimeRunner } from "../engine/runner.js";
import type { RuntimeHost } from "./types.js";

const provider: ChatProvider = {
  async complete() { return ""; },
  async *stream() { /* not used by runtime tests */ },
  async chat() { return { content: "", toolCalls: [] }; },
};

describe("SessionRuntimeRunner", () => {
  it("releases waits only after the injected clock advances", async () => {
    const host = new ManualRuntimeHost(1_000);
    const runner = new SessionRuntimeRunner(host);
    let complete = false;
    const waiting = runner.wait(500, () => false).then(() => { complete = true; });

    host.advanceBy(499);
    await Promise.resolve();
    expect(complete).toBe(false);

    host.advanceBy(1);
    await waiting;
    expect(complete).toBe(true);
  });

  it("wakes an in-flight host wait without advancing time", async () => {
    const host = new ManualRuntimeHost();
    const runner = new SessionRuntimeRunner(host);
    let complete = false;
    const waiting = runner.wait(60_000, () => false).then(() => { complete = true; });

    runner.wake();
    await waiting;
    expect(complete).toBe(true);
  });

  it("supports hosts that execute zero-delay tasks immediately", async () => {
    const immediateHost: RuntimeHost = {
      clock: { now: () => 0 },
      scheduler: {
        schedule: (_delayMs, task) => {
          task();
          return { cancel() {} };
        },
      },
      idGenerator: { next: () => "immediate" },
      notifications: new InMemoryRuntimeNotificationBus(),
    };
    await new SessionRuntimeRunner(immediateHost).wait(0, () => false);
  });
});

describe("runtime notifications", () => {
  it("uses deterministic host IDs and ordered, observer-safe notifications", async () => {
    const host = new ManualRuntimeHost(5_000);
    const notifications: Array<{ sequence: number; type: string; occurredAt: number }> = [];
    host.notifications.subscribe(() => { throw new Error("observer failure must be isolated"); });

    const session = new Session({
      characters: [],
      scene: { groupName: "Runtime test", topic: "test", atmosphere: "quiet" },
      relations: [],
    }, { character: provider }, host);
    session.onRuntimeNotification((event) => notifications.push(event));
    session.sendHumanMessage({ participantName: "Tester", message: "hello" });

    const iterator = session.start()[Symbol.asyncIterator]();
    const result = await iterator.next();
    session.stop();

    expect(result.value?.id).toBe("manual-2");
    expect(notifications.map((event) => event.type)).toEqual([
      "session.status_changed",
      "message.committed",
      "session.status_changed",
    ]);
    expect(notifications.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(notifications.every((event) => event.occurredAt === 5_000)).toBe(true);
  });
});
