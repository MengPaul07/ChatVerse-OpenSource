import type { RuntimeHost, RuntimeTask } from "../runtime/types.js";

/**
 * Host-owned waiting and wake-up primitive used by the Session Actor executor.
 * Only one wait is active, which preserves serial execution.
 */
export class SessionRuntimeRunner {
  private activeWait: { task?: RuntimeTask; resolve: () => void } | undefined;
  private paused = false;
  private pauseResolve: (() => void) | undefined;

  constructor(private readonly host: RuntimeHost) {}

  async wait(delayMs: number, shouldWake: () => boolean): Promise<void> {
    if (shouldWake()) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.activeWait?.resolve === finish) this.activeWait = undefined;
        resolve();
      };
      const task = this.host.scheduler.schedule(delayMs, finish);
      if (!settled) this.activeWait = { task, resolve: finish };
      if (shouldWake()) this.wake();
    });
  }

  /** Wait only for explicit work. No timer or polling task is installed. */
  async waitUntilWoken(shouldWake: () => boolean): Promise<void> {
    if (shouldWake()) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.activeWait?.resolve === finish) this.activeWait = undefined;
        resolve();
      };
      this.activeWait = { resolve: finish };
      if (shouldWake()) this.wake();
    });
  }

  wake(): void {
    const active = this.activeWait;
    if (!active) return;
    active.task?.cancel();
    active.resolve();
  }

  pause(): void {
    this.paused = true;
    this.wake();
  }

  resume(): void {
    this.paused = false;
    this.pauseResolve?.();
    this.pauseResolve = undefined;
    this.wake();
  }

  stop(): void {
    this.paused = false;
    this.pauseResolve?.();
    this.pauseResolve = undefined;
    this.wake();
  }

  async waitIfPaused(isStopped: () => boolean): Promise<void> {
    if (!this.paused || isStopped()) return;
    await new Promise<void>((resolve) => { this.pauseResolve = resolve; });
  }
}
