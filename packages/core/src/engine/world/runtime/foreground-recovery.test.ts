import { describe, expect, it } from "vitest";
import { ManualRuntimeHost } from "../../../runtime/in-process.js";
import { ForegroundRecoveryController } from "./foreground-recovery.js";

describe("ForegroundRecoveryController", () => {
  it("owns bounded retries and reports when the retry budget is exhausted", () => {
    const runtime = new ManualRuntimeHost();
    const executed: string[] = [];
    const controller = new ForegroundRecoveryController(runtime, {
      isRunning: () => true,
      notify: () => undefined,
      abort: () => undefined,
      execute: (contextId) => {
        executed.push(contextId);
        return true;
      },
      settleDismissedActor: () => undefined,
    }, [], 2);

    expect(controller.expect({
      contextId: "context:main",
      operation: "director",
      responsibility: "open_beat",
      intent: { operation: "director" },
    })).toBe(true);
    controller.start("context:main", "director");

    expect(controller.retryOrFail(
      "context:main",
      "director",
      "provider",
      "first failure",
      0,
    )).toBe(true);
    runtime.advanceBy(0);
    expect(executed).toEqual(["context:main"]);

    controller.start("context:main", "director");
    expect(controller.retryOrFail(
      "context:main",
      "director",
      "provider",
      "second failure",
      0,
    )).toBe(true);
    runtime.advanceBy(0);
    expect(executed).toEqual(["context:main", "context:main"]);

    controller.start("context:main", "director");
    expect(controller.retryOrFail(
      "context:main",
      "director",
      "provider",
      "third failure",
      0,
    )).toBe(false);
    expect(controller.get("context:main")?.status).toBe("failed");
  });
});
