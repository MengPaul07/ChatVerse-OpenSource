import { GeneratingMessageQueue, ScheduledMessageQueue } from "../queues/index.js";
import type { SessionRuntimeRunner } from "../runner.js";
import type { SessionActorRuntime } from "./actor-runtime.js";

type SessionLifecycleStatus = "idle" | "running" | "paused" | "stopped";

export class SessionLifecycleRuntime {
  constructor(private readonly host: {
    runner: SessionRuntimeRunner;
    providerAbort: AbortController;
    actorRuntime: SessionActorRuntime;
    generatingQueue: GeneratingMessageQueue;
    scheduledQueue: ScheduledMessageQueue;
    getStatus(): SessionLifecycleStatus;
    setStatus(status: SessionLifecycleStatus): void;
  }) {}

  pause(): void {
    if (this.host.getStatus() !== "running") return;
    this.host.setStatus("paused");
    this.host.runner.pause();
  }

  resume(): void {
    if (this.host.getStatus() !== "paused") return;
    this.host.setStatus("running");
    this.host.runner.resume();
  }

  stop(): void {
    if (this.host.getStatus() === "stopped") return;
    this.host.setStatus("stopped");
    this.host.providerAbort.abort();
    this.host.actorRuntime.abortAll();
    this.host.runner.stop();
    this.host.generatingQueue.cancelAll();
    for (const scheduled of this.host.scheduledQueue.all) {
      this.host.scheduledQueue.cancel(scheduled.id);
    }
  }

  async waitIfPaused(): Promise<void> {
    if (this.host.getStatus() === "running" || this.host.getStatus() === "stopped") return;
    await this.host.runner.waitIfPaused(() => this.host.getStatus() === "stopped");
  }
}
