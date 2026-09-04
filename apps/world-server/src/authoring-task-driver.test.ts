import { describe, expect, it, vi } from "vitest";
import { AuthoringTaskDriver } from "./authoring-task-driver.js";

describe("AuthoringTaskDriver", () => {
  it("coalesces repeated wake requests into one active run and one follow-up", async () => {
    const entered: number[] = [];
    const releases: Array<() => void> = [];
    const errors = vi.fn();
    const driver = new AuthoringTaskDriver(
      async () => {
        entered.push(entered.length + 1);
        await new Promise<void>((resolve) => releases.push(resolve));
      },
      errors,
    );

    const waitForRun = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (entered.length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(`Timed out waiting for run ${count}`);
    };

    driver.request();
    driver.request();
    await waitForRun(1);
    expect(entered).toHaveLength(1);

    driver.request();
    releases.shift()?.();
    await waitForRun(2);
    expect(entered).toHaveLength(2);

    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(driver.isRunning).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });
});
