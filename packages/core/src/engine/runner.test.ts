import { describe, expect, it } from "vitest";
import { ManualRuntimeHost } from "../runtime/in-process.js";
import { SessionRuntimeRunner } from "./runner.js";

describe("SessionRuntimeRunner", () => {
  it("can wait for explicit work without installing a polling timer", async () => {
    const host = new ManualRuntimeHost();
    const runner = new SessionRuntimeRunner(host);
    let completed = false;

    const waiting = runner.waitUntilWoken(() => false).then(() => {
      completed = true;
    });

    expect(host.pendingTaskCount()).toBe(0);
    host.advanceBy(60_000);
    await Promise.resolve();
    expect(completed).toBe(false);

    runner.wake();
    await waiting;
    expect(completed).toBe(true);
  });
});
